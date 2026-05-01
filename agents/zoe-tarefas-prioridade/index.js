import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { createLogger, StateManager, schedule } from '../../core/index.js';
import { config } from '../../core/secrets.js';

const AGENT_ID = 'zoe-tarefas-prioridade';
const DISPLAY_NAME = 'Zoe Afazeres';
const log = createLogger(AGENT_ID);
const state = new StateManager(AGENT_ID);

const DEFAULT_OWNER_PHONE_FALLBACK = '553598183459';
const DEFAULT_SUMMARY_CRON = '*/10 * * * *';
const DEFAULT_QUIET_START_HOUR = 21;
const DEFAULT_QUIET_END_HOUR = 7;
const DEFAULT_OPENCLAW_ACCOUNT = 'default';
const DEFAULT_OPENCLAW_CHANNEL = 'whatsapp';
const MAX_TASK_TITLE_LENGTH = 280;
const OPENCLAW_SEND_TIMEOUT_MS = Number(process.env.WHATSAPP_TAREFAS_OPENCLAW_SEND_TIMEOUT_MS || 25000);
const EVOLUTION_SEND_TIMEOUT_MS = Number(process.env.WHATSAPP_TAREFAS_EVOLUTION_SEND_TIMEOUT_MS || 15000);

let schedulerStarted = false;

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function resolveConfiguredOwnerPhone() {
  return normalizePhone(
    process.env.WHATSAPP_TAREFAS_OWNER_PHONE ||
    process.env.WHATSAPP_AFAZERES_OWNER_PHONE ||
    process.env.WHATSAPP_LEMBRETES_OWNER_PHONE ||
    process.env.WHATSAPP_REMINDER_DEFAULT_PHONE ||
    DEFAULT_OWNER_PHONE_FALLBACK
  );
}

function resolveConfiguredCron() {
  return normalizeText(
    process.env.WHATSAPP_TAREFAS_CRON ||
    process.env.WHATSAPP_AFAZERES_CRON ||
    DEFAULT_SUMMARY_CRON
  ) || DEFAULT_SUMMARY_CRON;
}

function parseHour(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    log.warn(`${fieldName} invalido (${value}). Usando fallback ${fallback}.`);
    return fallback;
  }
  return parsed;
}

function resolveQuietStartHour() {
  return parseHour(
    process.env.WHATSAPP_TAREFAS_QUIET_START_HOUR || process.env.WHATSAPP_AFAZERES_QUIET_START_HOUR,
    DEFAULT_QUIET_START_HOUR,
    'WHATSAPP_TAREFAS_QUIET_START_HOUR'
  );
}

function resolveQuietEndHour() {
  return parseHour(
    process.env.WHATSAPP_TAREFAS_QUIET_END_HOUR || process.env.WHATSAPP_AFAZERES_QUIET_END_HOUR,
    DEFAULT_QUIET_END_HOUR,
    'WHATSAPP_TAREFAS_QUIET_END_HOUR'
  );
}

function getHourInTimezone(date, timezone) {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false
    }).format(date);
    const parsed = Number(formatted);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 23) return parsed;
  } catch (err) {
    log.warn(`Falha ao resolver hora no timezone ${timezone}: ${err.message}`);
  }
  return date.getHours();
}

function isQuietHour(activeHour, startHour, endHour) {
  if (startHour === endHour) return true;
  if (startHour < endHour) return activeHour >= startHour && activeHour < endHour;
  return activeHour >= startHour || activeHour < endHour;
}

function sanitizeTaskTitle(title) {
  const normalized = normalizeText(title);
  if (!normalized) throw new Error('titulo da tarefa e obrigatorio. Exemplo: /afazer-add pagar boleto');
  if (normalized.length > MAX_TASK_TITLE_LENGTH) {
    throw new Error(`titulo da tarefa muito longo (maximo ${MAX_TASK_TITLE_LENGTH} caracteres).`);
  }
  return normalized;
}

function createTaskId() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTask(title) {
  const now = nowIso();
  return {
    id: createTaskId(),
    title: sanitizeTaskTitle(title),
    createdAt: now,
    updatedAt: now
  };
}

function normalizeActiveTask(task) {
  const now = nowIso();
  const title = sanitizeTaskTitle(task?.title || '');
  const createdAt = task?.createdAt || now;

  return {
    id: task?.id || createTaskId(),
    title,
    createdAt,
    updatedAt: task?.updatedAt || createdAt
  };
}

function sortLegacyPriorityTasks(rawTasks) {
  return [...rawTasks].sort((a, b) => {
    const left = Number(a?.position || Number.MAX_SAFE_INTEGER);
    const right = Number(b?.position || Number.MAX_SAFE_INTEGER);
    if (left !== right) return left - right;
    return String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
  });
}

function parseStoredTasks() {
  const rawTasks = state.get('tasks', []);
  if (!Array.isArray(rawTasks)) return [];

  const schemaVersion = Number(state.get('schemaVersion') || 0);
  const hasLegacyPosition = rawTasks.some(task => Object.prototype.hasOwnProperty.call(task || {}, 'position'));
  const ordered = schemaVersion >= 2 && !hasLegacyPosition ? rawTasks : sortLegacyPriorityTasks(rawTasks);
  const normalized = [];

  for (const task of ordered.filter(Boolean)) {
    try {
      normalized.push(normalizeActiveTask(task));
    } catch (err) {
      log.warn(`Tarefa invalida ignorada durante migracao/leitura: ${err.message}`);
    }
  }

  return normalized;
}

function parseCompletedTasks() {
  const raw = state.get('completedTasks', []);
  return Array.isArray(raw) ? raw : [];
}

function resolveOpenClawBin() {
  const home = process.env.HOME || os.homedir() || '/home/bonette';
  const candidates = [
    process.env.OPENCLAW_BIN,
    path.join(home, 'bin/openclaw'),
    path.join(home, '.nvm/current/bin/openclaw'),
    path.join(home, '.local/openclaw-node22/current/bin/openclaw'),
    path.join(home, '.local/openclaw-node22/bin/openclaw'),
    '/home/bonette/bin/openclaw',
    '/home/bonette/.nvm/current/bin/openclaw'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (err) {
      log.warn(`Falha ao verificar OpenClaw bin em ${candidate}: ${err.message}`);
    }
  }

  return 'openclaw';
}

function resolveSettings() {
  const currentSettings = state.get('settings', {});
  const ownerPhone = normalizePhone(currentSettings?.ownerPhone || resolveConfiguredOwnerPhone());
  const summaryCron = normalizeText(currentSettings?.summaryCron || resolveConfiguredCron()) || DEFAULT_SUMMARY_CRON;
  const quietStartHour = parseHour(currentSettings?.quietStartHour, resolveQuietStartHour(), 'quietStartHour');
  const quietEndHour = parseHour(currentSettings?.quietEndHour, resolveQuietEndHour(), 'quietEndHour');
  const openclawBin = normalizeText(currentSettings?.openclawBin || process.env.OPENCLAW_BIN || resolveOpenClawBin());
  const openclawAccount = normalizeText(currentSettings?.openclawAccount || process.env.WHATSAPP_TAREFAS_OPENCLAW_ACCOUNT || DEFAULT_OPENCLAW_ACCOUNT);
  const openclawChannel = normalizeText(currentSettings?.openclawChannel || process.env.WHATSAPP_TAREFAS_OPENCLAW_CHANNEL || DEFAULT_OPENCLAW_CHANNEL);

  return {
    ownerPhone,
    summaryCron,
    quietStartHour,
    quietEndHour,
    openclawBin,
    openclawAccount,
    openclawChannel
  };
}

function ensureStateShape() {
  // Esse agente pode ser acessado por multiplos processos (ex.: scheduler rodando fixo e comandos via CLI).
  // Entao precisamos recarregar do disco antes de ler pra evitar "lista antiga" no lembrete.
  state.reload();

  const tasks = parseStoredTasks();
  const completedTasks = parseCompletedTasks();
  const settings = resolveSettings();
  const rawTasks = state.get('tasks', []);
  const schemaVersion = Number(state.get('schemaVersion') || 0);

  const shouldSave =
    schemaVersion !== 2 ||
    JSON.stringify(tasks) !== JSON.stringify(rawTasks) ||
    !Array.isArray(state.get('completedTasks')) ||
    JSON.stringify(settings) !== JSON.stringify(state.get('settings', {}));

  if (shouldSave) {
    state.setMany({
      schemaVersion: 2,
      migratedFromPriorityAt: state.get('migratedFromPriorityAt') || nowIso(),
      tasks,
      completedTasks,
      settings
    });
  }

  return { tasks, completedTasks, settings };
}

function getSettings() {
  return ensureStateShape().settings;
}

function ensureOwnerPhone(phone, context = 'phone') {
  const target = normalizePhone(phone);
  const owner = normalizePhone(getSettings().ownerPhone);

  if (!owner) throw new Error('telefone dono nao configurado. Defina WHATSAPP_TAREFAS_OWNER_PHONE ou WHATSAPP_LEMBRETES_OWNER_PHONE.');
  if (!target) throw new Error(`${context} e obrigatorio.`);
  if (target !== owner) {
    throw new Error(`phone nao autorizado. Use apenas o numero do dono (${owner}).`);
  }

  return target;
}

function requirePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} deve ser um numero inteiro maior que zero.`);
  }
  return parsed;
}

function requireExistingIndex(index, listLength, fieldName = 'numero') {
  const parsed = requirePositiveInteger(index, fieldName);
  if (parsed > listLength) {
    throw new Error(`${fieldName} invalido. A lista atual vai ate ${listLength}.`);
  }
  return parsed;
}

function saveTasks(tasks) {
  const normalized = [];
  for (const task of tasks.filter(Boolean)) normalized.push(normalizeActiveTask(task));
  state.set('tasks', normalized);
  return normalized;
}

function saveTasksAndCompleted(tasks, completedTasks) {
  const normalizedTasks = tasks.map(task => normalizeActiveTask(task));
  state.setMany({
    tasks: normalizedTasks,
    completedTasks
  });
  return normalizedTasks;
}

function listTasksInternal() {
  return ensureStateShape().tasks;
}

export function listTasks() {
  return listTasksInternal();
}

export function addTask(title) {
  ensureStateShape();

  const tasks = listTasksInternal();
  const task = createTask(title);
  tasks.push(task);
  saveTasks(tasks);

  log.info(`Tarefa adicionada no fim da lista: ${task.title}`);
  return { ...task, index: tasks.length };
}

export function addTaskAtPosition(_position, title) {
  return addTask(title);
}

export function completeTaskByPosition(position) {
  ensureStateShape();

  const tasks = listTasksInternal();
  if (tasks.length === 0) throw new Error('nao ha tarefas para concluir.');

  const index = requireExistingIndex(position, tasks.length, 'numero');
  const [completed] = tasks.splice(index - 1, 1);
  const completedEntry = {
    ...completed,
    completedAt: nowIso(),
    completedFromIndex: index,
    updatedAt: nowIso()
  };

  const completedTasks = parseCompletedTasks();
  completedTasks.push(completedEntry);

  saveTasksAndCompleted(tasks, completedTasks);
  log.info(`Tarefa concluida na posicao ${index}: ${completedEntry.title}`);

  return completedEntry;
}

export function removeTaskByPosition(position) {
  ensureStateShape();

  const tasks = listTasksInternal();
  if (tasks.length === 0) throw new Error('nao ha tarefas para remover.');

  const index = requireExistingIndex(position, tasks.length, 'numero');
  const [removed] = tasks.splice(index - 1, 1);
  saveTasks(tasks);

  log.info(`Tarefa removida da posicao ${index}: ${removed.title}`);
  return removed;
}

export function moveTaskPriority() {
  throw new Error('o comando de mover foi removido. A lista agora segue a ordem em que voce adiciona as tarefas.');
}

export function formatTaskListMessage(tasks = listTasksInternal()) {
  if (!tasks.length) return 'Sua lista de afazeres esta vazia.';

  return [
    'Sua lista de afazeres:',
    ...tasks.map((task, index) => `${index + 1}. ${task.title}`)
  ].join('\n');
}

function getHelpMessage() {
  return [
    'Comandos de afazeres:',
    '/afazer-ajuda',
    '/afazer-status',
    '/afazer-lista',
    '/afazer-add <tarefa>',
    '/afazer-feita <numero>',
    '/afazer-remover <numero>',
    '',
    'Exemplos:',
    '/afazer-add pagar boleto',
    '/afazer-add 9: Arrumar site (aceito, mas entra no fim)',
    '/afazer-feita 2',
    '',
    'Frases naturais:',
    'adiciona tarefa pagar boleto',
    'adiciona pagar boleto',
    'listar tarefas',
    'concluir tarefa 2',
    'remover tarefa 3'
  ].join('\n');
}

function formatHourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function getReminderStatusMessage() {
  const settings = getSettings();
  const timezone = config.general.timezone || 'America/Sao_Paulo';
  const quietStart = settings.quietStartHour;
  const quietEnd = settings.quietEndHour;
  const activeWindowLabel = quietStart === quietEnd ? 'nenhuma janela ativa' : `${formatHourLabel(quietEnd)} ate ${formatHourLabel(quietStart)}`;

  return [
    'Sim, Papai.',
    `Lembrete automatico ativo a cada 10 minutos (${settings.summaryCron}).`,
    `Janela de envio: ${activeWindowLabel}.`,
    `Silencio: ${formatHourLabel(quietStart)} ate ${formatHourLabel(quietEnd)} (${timezone}).`,
    `Envio principal: OpenClaw WhatsApp (${settings.openclawChannel}/${settings.openclawAccount}).`
  ].join('\n');
}

function buildSummaryMessage(tasks) {
  if (!tasks.length) return 'Lembrete de afazeres: sua lista esta vazia.';

  return [
    'Lembrete de afazeres:',
    ...tasks.map((task, index) => `${index + 1}. ${task.title}`)
  ].join('\n');
}

function parseSlashCommand(input) {
  if (input === '/afazer-ajuda') return { action: 'help' };
  if (input === '/afazer-status') return { action: 'status' };
  if (input === '/afazer-lista') return { action: 'list' };

  const addWithLegacyNumberMatch = input.match(/^\/afazer-add\s+\d+\s*:\s*(.+)$/i);
  if (addWithLegacyNumberMatch) {
    return { action: 'add', title: addWithLegacyNumberMatch[1].trim(), legacyNumberIgnored: true };
  }

  const addMatch = input.match(/^\/afazer-add\s+(.+)$/i);
  if (addMatch) return { action: 'add', title: addMatch[1].trim() };

  const doneMatch = input.match(/^\/afazer-feita\s+(\d+)$/i);
  if (doneMatch) return { action: 'complete', index: Number(doneMatch[1]) };

  const removeMatch = input.match(/^\/afazer-remover\s+(\d+)$/i);
  if (removeMatch) return { action: 'remove', index: Number(removeMatch[1]) };

  if (/^\/afazer-mover\b/i.test(input)) return { action: 'moveRemoved' };

  return null;
}

function normalizeForNaturalMatch(input) {
  return normalizeText(input).replace(/^(zoe(bot)?)[,:\-]?\s*/i, '').trim();
}

function parseNaturalCommand(rawInput) {
  const input = normalizeForNaturalMatch(rawInput);
  const comparable = normalizeForMatch(input);
  if (!input) return null;

  if (
    /^(listar|lista|mostrar|ver)\s+((minhas|meus)\s+)?(tarefas|afazeres)(\s+pendentes)?$/.test(comparable) ||
    /^(listar|lista|mostrar|ver)\s+lista\s+(de\s+)?(tarefas|afazeres)$/.test(comparable) ||
    /^quais\s+sao\s+((minhas|meus)\s+)?(tarefas|afazeres)(\s+pendentes)?$/.test(comparable)
  ) {
    return { action: 'list' };
  }

  if (/(lembrete|resumo).*(tarefa|afazeres?)/.test(comparable) && /(ativo|configurad[oa]|10\s*em\s*10)/.test(comparable)) {
    return { action: 'status' };
  }

  if (/10\s*em\s*10/.test(comparable) && /(tarefa|afazeres?|lembrete|resumo)/.test(comparable)) {
    return { action: 'status' };
  }

  const addWithTaskMatch = input.match(/^(?:adiciona|adicionar|inclui|incluir|cria|criar)\s+(?:a\s+)?tarefa\s+(.+)$/i);
  if (addWithTaskMatch) {
    const title = addWithTaskMatch[1].replace(/\s+prioridade\s+\d+$/i, '').trim();
    return { action: 'add', title };
  }

  const addDirectMatch = input.match(/^(?:adiciona|adicionar|inclui|incluir|cria|criar)\s+(.+)$/i);
  if (addDirectMatch && !/^(lembrete|resumo|status)\b/i.test(addDirectMatch[1])) {
    const title = addDirectMatch[1].replace(/\s+prioridade\s+\d+$/i, '').trim();
    return { action: 'add', title };
  }

  const completeMatch = comparable.match(/^(?:concluir|conclui|finalizar|finaliza|marcar)\s+(?:a\s+)?tarefa\s+(\d+)(?:\s+como\s+concluida)?$/)
    || comparable.match(/^tarefa\s+(\d+)\s+concluida$/);
  if (completeMatch) return { action: 'complete', index: Number(completeMatch[1]) };

  const removeMatch = comparable.match(/^(?:remover|remove|excluir|exclui|apagar|apaga)\s+(?:a\s+)?tarefa\s+(\d+)$/);
  if (removeMatch) return { action: 'remove', index: Number(removeMatch[1]) };

  if (/^(mover|move)\s+(a\s+)?tarefa\s+\d+\s+para\s+\d+$/.test(comparable)) return { action: 'moveRemoved' };

  return null;
}

function executeParsedCommand(parsed) {
  if (!parsed?.action) return 'Comando nao reconhecido.\n\n' + getHelpMessage();

  switch (parsed.action) {
    case 'help':
      return getHelpMessage();

    case 'status':
      return getReminderStatusMessage();

    case 'list':
      return formatTaskListMessage();

    case 'add': {
      const task = addTask(parsed.title);
      const firstLine = parsed.legacyNumberIgnored
        ? `Tarefa adicionada no fim da lista: ${task.title}`
        : `Tarefa adicionada: ${task.title}`;
      return [firstLine, '', formatTaskListMessage()].join('\n');
    }

    case 'complete': {
      const task = completeTaskByPosition(parsed.index);
      return [`Tarefa concluida: ${task.title}`, '', formatTaskListMessage()].join('\n');
    }

    case 'remove': {
      const task = removeTaskByPosition(parsed.index);
      return [`Tarefa removida: ${task.title}`, '', formatTaskListMessage()].join('\n');
    }

    case 'moveRemoved':
      return 'O comando de mover foi removido. Agora a lista segue a ordem em que voce adiciona as tarefas.';

    default:
      return 'Comando nao reconhecido.\n\n' + getHelpMessage();
  }
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function sendViaOpenClaw(phone, message) {
  const settings = getSettings();
  const safePhone = ensureOwnerPhone(phone, 'phone');
  const target = `+${safePhone}`;
  const args = [
    'message',
    'send',
    '--channel', settings.openclawChannel,
    '--account', settings.openclawAccount,
    '--target', target,
    '--message', message,
    '--json'
  ];

  const { stdout } = await execFileAsync(settings.openclawBin, args, {
    timeout: OPENCLAW_SEND_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    env: { ...process.env }
  });

  let parsed = null;
  try {
    parsed = JSON.parse(stdout || '{}');
  } catch (err) {
    log.warn(`OpenClaw enviou resposta nao JSON: ${err.message}`);
  }

  return {
    provider: 'openclaw',
    target,
    result: parsed || stdout.trim()
  };
}

async function sendViaEvolution(phone, message) {
  const apiUrl = config.whatsapp.apiUrl;
  const apiToken = config.whatsapp.apiToken;
  const instance = config.whatsapp.instance;
  const safePhone = ensureOwnerPhone(phone, 'phone');

  if (!apiUrl || !apiToken || !instance) {
    throw new Error('Evolution API nao configurada para fallback.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVOLUTION_SEND_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiUrl}/message/sendText/${instance}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: apiToken
      },
      body: JSON.stringify({ number: safePhone, text: message })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Evolution API erro ${response.status}: ${body}`);
    }

    return {
      provider: 'evolution',
      result: await response.json()
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sendWhatsAppMessage(phone, message) {
  try {
    return await sendViaOpenClaw(phone, message);
  } catch (openClawErr) {
    const fallbackEnabled = String(process.env.WHATSAPP_TAREFAS_ENABLE_EVOLUTION_FALLBACK || '').toLowerCase() === 'true';
    if (!fallbackEnabled) {
      throw new Error(`OpenClaw WhatsApp falhou: ${openClawErr.stderr || openClawErr.message}`.trim());
    }

    log.warn(`OpenClaw WhatsApp falhou; tentando fallback Evolution API: ${openClawErr.message}`);
    try {
      return await sendViaEvolution(phone, message);
    } catch (evolutionErr) {
      throw new Error(`OpenClaw falhou (${openClawErr.message}); Evolution falhou (${evolutionErr.message}).`);
    }
  }
}

export function handleTaskCommand({ text, phone }) {
  ensureStateShape();
  const input = normalizeText(text);
  const targetPhone = ensureOwnerPhone(phone || getSettings().ownerPhone, 'phone');

  if (!input) return getHelpMessage();

  // Compatibilidade: se o usuario mandar "afazer-feita 1" (sem a /), tratamos como comando slash.
  const parserInput = input.toLowerCase().startsWith('afazer-') ? `/${input}` : input;
  const parsed = parserInput.startsWith('/') ? parseSlashCommand(parserInput) : parseNaturalCommand(parserInput);
  const output = executeParsedCommand(parsed);

  log.info(`Comando de afazeres processado para ${targetPhone}: ${input}`);
  return output;
}

export function getTaskSummaryPreview() {
  ensureStateShape();
  return buildSummaryMessage(listTasksInternal());
}

export async function sendTaskSummaryNow(options = {}) {
  ensureStateShape();

  const settings = getSettings();
  const timezone = config.general.timezone || 'America/Sao_Paulo';
  const now = options.now instanceof Date ? options.now : new Date();
  const ignoreQuietHours = Boolean(options.ignoreQuietHours);
  const currentHour = getHourInTimezone(now, timezone);

  if (!ignoreQuietHours && isQuietHour(currentHour, settings.quietStartHour, settings.quietEndHour)) {
    const skippedAt = nowIso();
    state.set('lastSummarySkippedAt', skippedAt);
    log.info(
      `Resumo de afazeres ignorado (silencio ${String(settings.quietStartHour).padStart(2, '0')}:00-${String(settings.quietEndHour).padStart(2, '0')}:00, hora atual ${String(currentHour).padStart(2, '0')}:00 ${timezone}).`
    );
    return {
      skipped: true,
      reason: 'quiet-hours',
      quietStartHour: settings.quietStartHour,
      quietEndHour: settings.quietEndHour,
      currentHour,
      timezone,
      skippedAt
    };
  }

  const tasks = listTasksInternal();
  const message = buildSummaryMessage(tasks);
  const ownerPhone = ensureOwnerPhone(settings.ownerPhone, 'ownerPhone');

  try {
    const delivery = await sendWhatsAppMessage(ownerPhone, message);
    const sentAt = nowIso();
    state.setMany({
      lastSummarySentAt: sentAt,
      lastSummaryErrorAt: null,
      lastSummaryError: null
    });

    log.info(`Resumo de afazeres enviado para ${ownerPhone} via ${delivery.provider} (tarefas: ${tasks.length}).`);

    return {
      phone: ownerPhone,
      message,
      taskCount: tasks.length,
      sentAt,
      delivery
    };
  } catch (err) {
    const errorAt = nowIso();
    const errorMessage = err.message || String(err);
    state.setMany({
      lastSummaryErrorAt: errorAt,
      lastSummaryError: errorMessage
    });
    log.error(`Falha ao enviar resumo de afazeres: ${errorMessage}`);
    throw err;
  }
}

export function startScheduler() {
  if (schedulerStarted) return;

  const settings = getSettings();
  const cronExpression = settings.summaryCron || DEFAULT_SUMMARY_CRON;
  const timezone = config.general.timezone || 'America/Sao_Paulo';

  schedule('zoe-afazeres-summary', cronExpression, sendTaskSummaryNow, timezone);
  schedulerStarted = true;

  log.info(`Scheduler iniciado para ${DISPLAY_NAME}: ${cronExpression} (${timezone}).`);
}

if (process.argv[1]?.endsWith('zoe-tarefas-prioridade/index.js')) {
  log.info(`${DISPLAY_NAME} iniciado.`);
  startScheduler();
}
