import { createLogger, StateManager, schedule } from '../../core/index.js';
import { config } from '../../core/secrets.js';
import fs from 'fs';
import path from 'path';

const log = createLogger('whatsapp-lembretes');
const state = new StateManager('whatsapp-lembretes');
const OWNER_PHONE_FALLBACK = '553598183459';

/**
 * Agente de Lembretes via WhatsApp
 *
 * Funcionalidades:
 * - CRUD de lembretes com data/hora
 * - CRUD de tarefas de produtividade
 * - Checklist diário
 * - Follow-up automático de tarefas
 * - Recorrência (diário, semanal, mensal, personalizado)
 * - Timezone handling (America/Sao_Paulo)
 * - Retry em caso de falha de envio
 * - Categorias e prioridades
 *
 * Requer: WhatsApp Business API ou Evolution API configurado no .env.
 *
 * Este agente unifica os recursos que antes estavam separados em:
 * - whatsapp-lembretes
 * - produtividade
 */

const MAX_RETRIES = 3;
const PRODUCTIVITY_MIGRATION_FLAG = 'mergedProductividadeStateAt';
const COMMANDS_REGISTRY_MIGRATION_FLAG = 'commandsRegistryMigratedAt';
const DEFAULT_DAILY_CHECKLIST = [
  { name: 'Revisar tarefas do dia', done: false },
  { name: 'Checar e-mails prioritarios', done: false },
  { name: 'Atualizar status dos projetos', done: false },
  { name: 'Planejar proximo dia (fim do expediente)', done: false }
];
const COMMANDS_REGISTRY_PATH = process.env.WHATSAPP_COMMANDS_MD_PATH || path.join(path.dirname(state.filePath), 'COMMANDS.md');
const LEGACY_COMMANDS_MD_CANDIDATES = [
  process.env.WHATSAPP_COMMANDS_MD_LEGACY_PATH,
  path.resolve('COMMANDS.md'),
  path.join(path.dirname(state.filePath), '..', 'COMMANDS.md'),
  '/home/bonette/.openclaw/workspace/COMMANDS.md'
].filter(Boolean);

// Estrutura de lembrete
function createReminder({ message, sendAt, phone, recurring = null, category = 'geral', priority = 'normal' }) {
  return {
    id: `rem-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    message,
    sendAt, // ISO string
    phone,
    recurring, // null, 'daily', 'weekly', 'monthly', ou cron expression
    category,
    priority, // low, normal, high
    status: 'scheduled', // scheduled, sent, failed, cancelled
    retries: 0,
    createdAt: new Date().toISOString(),
    lastAttempt: null,
    sentAt: null
  };
}

// Estrutura de tarefa
function createTask({ title, description = '', priority = 'medium', dueDate = null, recurring = null, tags = [] }) {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description,
    priority, // low, medium, high, urgent
    status: 'pending', // pending, in_progress, done, cancelled
    dueDate,
    recurring, // null, 'daily', 'weekly', 'monthly', cron expression
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
}

function createFollowUp({ taskId, message, dueDate, phone = '', category = 'tarefa', priority = 'normal' }) {
  return {
    id: `fu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId: taskId || null,
    message,
    dueDate,
    phone,
    category,
    priority,
    status: 'scheduled', // scheduled, sent, failed, cancelled
    retries: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sentAt: null,
    lastAttempt: null,
    error: null
  };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

const OWNER_PHONE = normalizePhone(
  process.env.WHATSAPP_LEMBRETES_OWNER_PHONE ||
  process.env.WHATSAPP_REMINDER_DEFAULT_PHONE ||
  process.env.WHATSAPP_DEFAULT_PHONE ||
  OWNER_PHONE_FALLBACK
);

function ensureOwnerPhone(value, context = 'telefone') {
  const normalized = normalizePhone(value);
  if (!normalized) throw new Error(`${context} é obrigatório.`);
  if (normalized !== OWNER_PHONE) {
    throw new Error(`phone não autorizado. Use apenas o número do dono (${OWNER_PHONE}).`);
  }
  return normalized;
}

function getDefaultReminderPhone() {
  return OWNER_PHONE || '';
}

function mergeUniqueById(target = [], source = []) {
  const map = new Map();
  for (const item of target) {
    if (item?.id) map.set(item.id, item);
  }
  for (const item of source) {
    if (item?.id && !map.has(item.id)) map.set(item.id, item);
  }
  return [...map.values()];
}

function migrateLegacyProductivityState() {
  if (state.get(PRODUCTIVITY_MIGRATION_FLAG)) return;

  const legacyPath = path.join(path.dirname(state.filePath), 'produtividade.json');
  if (!fs.existsSync(legacyPath)) {
    state.set(PRODUCTIVITY_MIGRATION_FLAG, new Date().toISOString());
    return;
  }

  try {
    const raw = fs.readFileSync(legacyPath, 'utf-8');
    const legacy = JSON.parse(raw);
    const currentTasks = state.get('tasks', []);
    const currentFollowUps = state.get('followUps', []);
    const currentRoutines = state.get('dailyRoutines', []);

    const mergedTasks = mergeUniqueById(currentTasks, legacy.tasks || []);
    const mergedFollowUps = mergeUniqueById(currentFollowUps, legacy.followUps || []);
    const mergedRoutines = currentRoutines.length > 0 ? currentRoutines : (legacy.dailyRoutines || DEFAULT_DAILY_CHECKLIST);

    state.set('tasks', mergedTasks);
    state.set('followUps', mergedFollowUps);
    state.set('dailyRoutines', mergedRoutines);
    state.set(PRODUCTIVITY_MIGRATION_FLAG, new Date().toISOString());

    log.info(`Migração concluída: produtividade.json -> whatsapp-lembretes.json (tarefas: ${mergedTasks.length}, follow-ups: ${mergedFollowUps.length})`);
  } catch (err) {
    log.error(`Falha ao migrar estado legado de produtividade: ${err.message}`);
    // Marca para evitar loop de erro em produção.
    state.set(PRODUCTIVITY_MIGRATION_FLAG, new Date().toISOString());
  }
}

// CRUD
export function addReminder(data) {
  if (!data?.message) throw new Error('message é obrigatório para lembrete.');
  if (!data?.sendAt) throw new Error('sendAt é obrigatório para lembrete.');

  const phone = ensureOwnerPhone(data?.phone || getDefaultReminderPhone(), 'phone');
  const reminder = createReminder({ ...data, phone });
  const reminders = state.get('reminders', []);
  reminders.push(reminder);
  state.set('reminders', reminders);
  log.info(`Lembrete agendado: "${reminder.message}" para ${reminder.sendAt}`);
  return reminder;
}

export function listReminders(filter = {}) {
  let reminders = state.get('reminders', []);
  if (filter.status) reminders = reminders.filter(r => r.status === filter.status);
  if (filter.category) reminders = reminders.filter(r => r.category === filter.category);
  return reminders;
}

export function cancelReminder(id) {
  const reminders = state.get('reminders', []);
  const idx = reminders.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Lembrete não encontrado: ${id}`);
  reminders[idx].status = 'cancelled';
  state.set('reminders', reminders);
  log.info(`Lembrete cancelado: ${id}`);
}

export function updateReminder(id, updates) {
  const reminders = state.get('reminders', []);
  const idx = reminders.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Lembrete não encontrado: ${id}`);
  reminders[idx] = { ...reminders[idx], ...updates };
  state.set('reminders', reminders);
  return reminders[idx];
}

// CRUD de tarefas (unificado)
export function addTask(taskData) {
  if (!taskData?.title) throw new Error('title é obrigatório para tarefa.');
  const task = createTask(taskData);
  const tasks = state.get('tasks', []);
  tasks.push(task);
  state.set('tasks', tasks);
  log.info(`Tarefa adicionada: [${task.priority}] ${task.title}`);
  return task;
}

export function listTasks(filter = {}) {
  let tasks = state.get('tasks', []);
  if (filter.status) tasks = tasks.filter(t => t.status === filter.status);
  if (filter.priority) tasks = tasks.filter(t => t.priority === filter.priority);
  if (filter.tag) tasks = tasks.filter(t => t.tags.includes(filter.tag));
  return tasks;
}

export function updateTask(id, updates) {
  const tasks = state.get('tasks', []);
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) throw new Error(`Tarefa não encontrada: ${id}`);
  tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
  if (updates.status === 'done') tasks[idx].completedAt = new Date().toISOString();
  state.set('tasks', tasks);
  log.info(`Tarefa atualizada: ${tasks[idx].title} -> ${updates.status || 'editada'}`);
  return tasks[idx];
}

export function deleteTask(id) {
  const tasks = state.get('tasks', []);
  const filtered = tasks.filter(t => t.id !== id);
  state.set('tasks', filtered);
  log.info(`Tarefa removida: ${id}`);
}

// Rotinas diárias
export function getDailyChecklist() {
  return state.get('dailyRoutines', DEFAULT_DAILY_CHECKLIST);
}

export function setDailyRoutines(routines) {
  state.set('dailyRoutines', routines);
}

// Follow-ups de tarefas
export function addFollowUp(data) {
  if (!data?.message) throw new Error('message é obrigatório para follow-up.');
  if (!data?.dueDate) throw new Error('dueDate é obrigatório para follow-up.');

  const phone = ensureOwnerPhone(data?.phone || getDefaultReminderPhone(), 'phone');
  const followUp = createFollowUp({ ...data, phone });
  const followUps = state.get('followUps', []);
  followUps.push(followUp);
  state.set('followUps', followUps);
  log.info(`Follow-up agendado para ${followUp.dueDate}: ${followUp.message}`);
  return followUp;
}

export function listFollowUps(filter = {}) {
  let followUps = state.get('followUps', []);
  if (filter.status) followUps = followUps.filter(f => f.status === filter.status);
  if (filter.taskId) followUps = followUps.filter(f => f.taskId === filter.taskId);
  return followUps;
}

export function cancelFollowUp(id) {
  const followUps = state.get('followUps', []);
  const idx = followUps.findIndex(f => f.id === id);
  if (idx === -1) throw new Error(`Follow-up não encontrado: ${id}`);
  followUps[idx] = { ...followUps[idx], status: 'cancelled', updatedAt: new Date().toISOString() };
  state.set('followUps', followUps);
  log.info(`Follow-up cancelado: ${id}`);
}

export function getPendingFollowUps() {
  const now = new Date().toISOString();
  return state.get('followUps', []).filter(fu => fu.status === 'scheduled' && fu.dueDate <= now);
}

/**
 * Envia mensagem via WhatsApp API.
 * Compatível com Evolution API, Baileys, ou WhatsApp Business API.
 */
async function sendWhatsAppMessage(phone, message) {
  const apiUrl = config.whatsapp.apiUrl;
  const apiToken = config.whatsapp.apiToken;
  const instance = config.whatsapp.instance;
  const safePhone = ensureOwnerPhone(phone, 'phone');

  if (!apiUrl || !apiToken) {
    throw new Error('WhatsApp API não configurado. Defina WHATSAPP_API_URL e WHATSAPP_API_TOKEN no .env');
  }

  // Formato Evolution API
  const response = await fetch(`${apiUrl}/message/sendText/${instance}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiToken
    },
    body: JSON.stringify({
      number: safePhone,
      text: message
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp API erro ${response.status}: ${body}`);
  }

  return await response.json();
}

function createCommand({ name, content, description = '', tags = [] }) {
  return {
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || '').trim(),
    description: String(description || '').trim(),
    content: String(content || '').trim(),
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createSnippet({ title, content, type = 'texto', tags = [] }) {
  return {
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(title || '').trim(),
    content: String(content || '').trim(),
    type: String(type || 'texto').trim(),
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeTags(tags = []) {
  const values = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(values.map(tag => String(tag || '').trim()).filter(Boolean))];
}

function normalizeCommandEntry(entry = {}) {
  if (!entry?.name || !entry?.content) return null;
  return {
    id: entry.id || `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(entry.name).trim(),
    description: String(entry.description || '').trim(),
    content: String(entry.content || '').trim(),
    tags: normalizeTags(entry.tags || []),
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString()
  };
}

function normalizeSnippetEntry(entry = {}) {
  if (!entry?.title || !entry?.content) return null;
  return {
    id: entry.id || `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(entry.title).trim(),
    content: String(entry.content || '').trim(),
    type: String(entry.type || 'texto').trim(),
    tags: normalizeTags(entry.tags || []),
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString()
  };
}

function registryKey(kind, label) {
  return `${kind}:${String(label || '').trim().toLowerCase()}`;
}

function mergeRegistryEntries(entries = [], kind) {
  const map = new Map();

  for (const rawEntry of entries) {
    const normalized = kind === 'command'
      ? normalizeCommandEntry(rawEntry)
      : normalizeSnippetEntry(rawEntry);

    if (!normalized) continue;
    const key = registryKey(kind, kind === 'command' ? normalized.name : normalized.title);
    map.set(key, normalized);
  }

  return [...map.values()].sort((a, b) => {
    const left = kind === 'command' ? a.name : a.title;
    const right = kind === 'command' ? b.name : b.title;
    return left.localeCompare(right, 'pt-BR', { sensitivity: 'base' });
  });
}

function parseTags(rawValue) {
  return normalizeTags(String(rawValue || '').split(','));
}

function parseCommandsRegistryMarkdown(content = '') {
  const lines = String(content || '').split(/\r?\n/);
  const registry = { commands: [], snippets: [] };
  let section = 'commands';
  let entry = null;
  let inCodeBlock = false;
  let codeLines = [];

  function finalizeEntry() {
    if (!entry) return;

    const textContent = (entry.bodyLines || []).join('\n').trim();
    const payload = {
      ...entry,
      content: textContent
    };

    if (section === 'commands') {
      const normalized = normalizeCommandEntry({
        name: entry.title,
        description: entry.description,
        content: payload.content,
        tags: entry.tags
      });
      if (normalized) registry.commands.push(normalized);
    } else {
      const normalized = normalizeSnippetEntry({
        title: entry.title,
        content: payload.content,
        type: entry.type || 'texto',
        tags: entry.tags
      });
      if (normalized) registry.snippets.push(normalized);
    }

    entry = null;
    inCodeBlock = false;
    codeLines = [];
  }

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      finalizeEntry();
      const title = line.replace(/^##\s+/, '').trim().toLowerCase();
      section = title.includes('texto') || title.includes('snippet') ? 'snippets' : 'commands';
      continue;
    }

    if (/^###\s+/.test(line)) {
      finalizeEntry();
      entry = {
        title: line.replace(/^###\s+/, '').trim(),
        description: '',
        type: section === 'commands' ? 'comando' : 'texto',
        tags: [],
        bodyLines: []
      };
      continue;
    }

    if (!entry) continue;

    if (inCodeBlock) {
      if (/^```/.test(line)) {
        entry.bodyLines = codeLines.slice();
        inCodeBlock = false;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```/.test(line)) {
      inCodeBlock = true;
      codeLines = [];
      continue;
    }

    if (line.startsWith('- description:')) {
      entry.description = line.replace('- description:', '').trim();
      continue;
    }

    if (line.startsWith('- tags:')) {
      entry.tags = parseTags(line.replace('- tags:', '').trim());
      continue;
    }

    if (line.startsWith('- type:')) {
      entry.type = line.replace('- type:', '').trim() || entry.type;
      continue;
    }

    if (line.trim()) {
      entry.bodyLines.push(line);
    }
  }

  finalizeEntry();

  return {
    commands: mergeRegistryEntries(registry.commands, 'command'),
    snippets: mergeRegistryEntries(registry.snippets, 'snippet')
  };
}

function renderCommandsRegistryMarkdown(registry) {
  const commands = mergeRegistryEntries(registry.commands || [], 'command');
  const snippets = mergeRegistryEntries(registry.snippets || [], 'snippet');
  const lines = [
    '# COMMANDS',
    '',
    'Registro unico de comandos e textos usado pelo agente whatsapp-lembretes.',
    ''
  ];

  lines.push('## Comandos');
  lines.push('');

  for (const command of commands) {
    lines.push(`### ${command.name}`);
    if (command.description) lines.push(`- description: ${command.description}`);
    if (command.tags.length > 0) lines.push(`- tags: ${command.tags.join(', ')}`);
    lines.push('```bash');
    lines.push(command.content);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Textos');
  lines.push('');

  for (const snippet of snippets) {
    lines.push(`### ${snippet.title}`);
    lines.push(`- type: ${snippet.type}`);
    if (snippet.tags.length > 0) lines.push(`- tags: ${snippet.tags.join(', ')}`);
    lines.push('```text');
    lines.push(snippet.content);
    lines.push('```');
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

function readCommandsRegistryFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { commands: [], snippets: [] };
  }

  try {
    return parseCommandsRegistryMarkdown(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    log.error(`Falha ao ler COMMANDS.md em ${filePath}: ${err.message}`);
    return { commands: [], snippets: [] };
  }
}

function writeCommandsRegistryFile(registry) {
  fs.mkdirSync(path.dirname(COMMANDS_REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(COMMANDS_REGISTRY_PATH, renderCommandsRegistryMarkdown(registry), 'utf-8');
}

function clearLegacyCommandState() {
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(state.data, 'commands')) {
    delete state.data.commands;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(state.data, 'snippets')) {
    delete state.data.snippets;
    changed = true;
  }

  state.data.commandsRegistryPath = COMMANDS_REGISTRY_PATH;
  state.data[COMMANDS_REGISTRY_MIGRATION_FLAG] = new Date().toISOString();
  changed = true;

  if (changed) state.save();
}

function ensureCommandsRegistry() {
  const currentRegistry = readCommandsRegistryFile(COMMANDS_REGISTRY_PATH);
  const legacyFiles = LEGACY_COMMANDS_MD_CANDIDATES
    .map(filePath => path.resolve(filePath))
    .filter(filePath => filePath !== path.resolve(COMMANDS_REGISTRY_PATH) && fs.existsSync(filePath));
  const legacyStateCommands = state.get('commands', []);
  const legacyStateSnippets = state.get('snippets', []);

  const mergedRegistry = {
    commands: mergeRegistryEntries([
      ...legacyFiles.flatMap(filePath => readCommandsRegistryFile(filePath).commands),
      ...legacyStateCommands,
      ...currentRegistry.commands
    ], 'command'),
    snippets: mergeRegistryEntries([
      ...legacyFiles.flatMap(filePath => readCommandsRegistryFile(filePath).snippets),
      ...legacyStateSnippets,
      ...currentRegistry.snippets
    ], 'snippet')
  };

  const shouldWrite =
    !fs.existsSync(COMMANDS_REGISTRY_PATH) ||
    legacyFiles.length > 0 ||
    legacyStateCommands.length > 0 ||
    legacyStateSnippets.length > 0 ||
    !state.get(COMMANDS_REGISTRY_MIGRATION_FLAG);

  if (shouldWrite) {
    writeCommandsRegistryFile(mergedRegistry);
    clearLegacyCommandState();
    log.info(`Registro unico COMMANDS.md sincronizado em ${COMMANDS_REGISTRY_PATH}`);
  }

  return mergedRegistry;
}

export function addCommand(data) {
  if (!data?.name) throw new Error('name é obrigatório para comando.');
  if (!data?.content) throw new Error('content é obrigatório para comando.');

  const registry = ensureCommandsRegistry();
  const commands = registry.commands;
  const exists = commands.find(cmd => cmd.name.toLowerCase() === String(data.name).toLowerCase());
  if (exists) throw new Error(`Comando já existe: ${exists.name}`);

  const command = createCommand(data);
  registry.commands = [...commands, command];
  writeCommandsRegistryFile(registry);
  log.info(`Comando salvo: ${command.name}`);
  return command;
}

export function listCommands(filter = {}) {
  let commands = ensureCommandsRegistry().commands;
  if (filter.tag) commands = commands.filter(cmd => (cmd.tags || []).includes(filter.tag));
  return commands;
}

export function getCommand(key) {
  const commands = ensureCommandsRegistry().commands;
  const lookup = String(key || '').trim().toLowerCase();
  return commands.find(cmd => cmd.id === key || cmd.name.toLowerCase() === lookup);
}

export function updateCommand(key, updates = {}) {
  const registry = ensureCommandsRegistry();
  const commands = registry.commands;
  const lookup = String(key || '').trim().toLowerCase();
  const idx = commands.findIndex(cmd => cmd.id === key || cmd.name.toLowerCase() === lookup);
  if (idx === -1) throw new Error(`Comando não encontrado: ${key}`);

  commands[idx] = {
    ...commands[idx],
    ...updates,
    name: updates.name ? String(updates.name).trim() : commands[idx].name,
    content: updates.content ? String(updates.content).trim() : commands[idx].content,
    updatedAt: new Date().toISOString()
  };
  registry.commands = commands;
  writeCommandsRegistryFile(registry);
  return commands[idx];
}

export function deleteCommand(key) {
  const registry = ensureCommandsRegistry();
  const commands = registry.commands;
  const lookup = String(key || '').trim().toLowerCase();
  const filtered = commands.filter(cmd => cmd.id !== key && cmd.name.toLowerCase() !== lookup);
  if (filtered.length === commands.length) throw new Error(`Comando não encontrado: ${key}`);
  registry.commands = filtered;
  writeCommandsRegistryFile(registry);
}

export function addSnippet(data) {
  if (!data?.title) throw new Error('title é obrigatório para snippet.');
  if (!data?.content) throw new Error('content é obrigatório para snippet.');

  const registry = ensureCommandsRegistry();
  const snippets = registry.snippets;
  const snippet = createSnippet(data);
  registry.snippets = [...snippets, snippet];
  writeCommandsRegistryFile(registry);
  log.info(`Snippet salvo: ${snippet.title}`);
  return snippet;
}

export function listSnippets(filter = {}) {
  let snippets = ensureCommandsRegistry().snippets;
  if (filter.type) snippets = snippets.filter(s => s.type === filter.type);
  if (filter.tag) snippets = snippets.filter(s => (s.tags || []).includes(filter.tag));
  return snippets;
}

export function getSnippet(key) {
  const snippets = ensureCommandsRegistry().snippets;
  const lookup = String(key || '').trim().toLowerCase();
  return snippets.find(s => s.id === key || s.title.toLowerCase() === lookup);
}

export function updateSnippet(key, updates = {}) {
  const registry = ensureCommandsRegistry();
  const snippets = registry.snippets;
  const lookup = String(key || '').trim().toLowerCase();
  const idx = snippets.findIndex(s => s.id === key || s.title.toLowerCase() === lookup);
  if (idx === -1) throw new Error(`Snippet não encontrado: ${key}`);

  snippets[idx] = {
    ...snippets[idx],
    ...updates,
    title: updates.title ? String(updates.title).trim() : snippets[idx].title,
    content: updates.content ? String(updates.content).trim() : snippets[idx].content,
    type: updates.type ? String(updates.type).trim() : snippets[idx].type,
    updatedAt: new Date().toISOString()
  };
  registry.snippets = snippets;
  writeCommandsRegistryFile(registry);
  return snippets[idx];
}

export function deleteSnippet(key) {
  const registry = ensureCommandsRegistry();
  const snippets = registry.snippets;
  const lookup = String(key || '').trim().toLowerCase();
  const filtered = snippets.filter(s => s.id !== key && s.title.toLowerCase() !== lookup);
  if (filtered.length === snippets.length) throw new Error(`Snippet não encontrado: ${key}`);
  registry.snippets = filtered;
  writeCommandsRegistryFile(registry);
}

function splitNameAndContent(raw) {
  const text = String(raw || '').trim();
  if (!text) return { name: '', content: '' };
  const separators = ['::', '=>', ':'];
  for (const separator of separators) {
    const idx = text.indexOf(separator);
    if (idx > 0) {
      return {
        name: text.slice(0, idx).trim(),
        content: text.slice(idx + separator.length).trim()
      };
    }
  }
  return { name: text.trim(), content: '' };
}

export function handleSlashCommand({ text, phone }) {
  ensureOwnerPhone(phone || getDefaultReminderPhone(), 'phone');
  const input = String(text || '').trim();
  if (!input.startsWith('/')) return null;

  if (input === '/comandos') {
    const commands = listCommands();
    if (commands.length === 0) return 'Nao ha comandos salvos ainda.';
    return [
      'Comandos salvos:',
      ...commands.map(cmd => `- ${cmd.name}${cmd.description ? `: ${cmd.description}` : ''}`),
      '',
      'Uso rapido:',
      '/salvar-comando NOME: comando',
      '/ver-comando NOME',
      '/apagar-comando NOME'
    ].join('\n');
  }

  if (input === '/textos') {
    const snippets = listSnippets();
    if (snippets.length === 0) return 'Nao ha textos salvos ainda.';
    return ['Textos salvos:', ...snippets.map(s => `- ${s.title} (${s.type})`)].join('\n');
  }

  if (input.startsWith('/salvar-comando ')) {
    const payload = input.replace('/salvar-comando ', '').trim();
    const { name, content } = splitNameAndContent(payload);
    if (!name || !content) return 'Formato invalido. Use: /salvar-comando NOME: comando';
    addCommand({ name, content, tags: ['manual'] });
    return `Comando salvo: ${name}`;
  }

  if (input.startsWith('/ver-comando ')) {
    const key = input.replace('/ver-comando ', '').trim();
    const command = getCommand(key);
    if (!command) return `Comando nao encontrado: ${key}`;
    return [`${command.name}:`, '```bash', command.content, '```'].join('\n');
  }

  if (input.startsWith('/apagar-comando ')) {
    const key = input.replace('/apagar-comando ', '').trim();
    deleteCommand(key);
    return `Comando removido: ${key}`;
  }

  if (input.startsWith('/salvar-texto ')) {
    const payload = input.replace('/salvar-texto ', '').trim();
    const { name, content } = splitNameAndContent(payload);
    if (!name || !content) return 'Formato invalido. Use: /salvar-texto TITULO: conteudo';
    addSnippet({ title: name, content, type: 'texto', tags: ['manual'] });
    return `Texto salvo: ${name}`;
  }

  if (input.startsWith('/ver-texto ')) {
    const key = input.replace('/ver-texto ', '').trim();
    const snippet = getSnippet(key);
    if (!snippet) return `Texto nao encontrado: ${key}`;
    return [`${snippet.title}:`, snippet.content].join('\n');
  }

  if (input.startsWith('/apagar-texto ')) {
    const key = input.replace('/apagar-texto ', '').trim();
    deleteSnippet(key);
    return `Texto removido: ${key}`;
  }

  return 'Comando nao reconhecido. Use /comandos para ver os comandos disponiveis.';
}

async function processTaskFollowUps() {
  const now = new Date().toISOString();
  const followUps = state.get('followUps', []);
  let updated = false;

  for (const followUp of followUps) {
    if (followUp.status !== 'scheduled') continue;
    if (followUp.dueDate > now) continue;

    followUp.lastAttempt = now;
    const targetPhone = followUp.phone || getDefaultReminderPhone();

    if (!targetPhone) {
      followUp.status = 'failed';
      followUp.error = 'missing-phone';
      followUp.updatedAt = new Date().toISOString();
      updated = true;
      log.error(`Follow-up ${followUp.id} sem telefone. Defina phone no follow-up ou WHATSAPP_REMINDER_DEFAULT_PHONE.`);
      continue;
    }

    try {
      await sendWhatsAppMessage(targetPhone, followUp.message);
      followUp.status = 'sent';
      followUp.sentAt = now;
      followUp.updatedAt = new Date().toISOString();
      followUp.error = null;
      updated = true;
      log.info(`Follow-up enviado com sucesso: ${followUp.id}`);
    } catch (err) {
      followUp.retries = (followUp.retries || 0) + 1;
      followUp.error = err.message;
      followUp.updatedAt = new Date().toISOString();

      if (followUp.retries >= MAX_RETRIES) {
        followUp.status = 'failed';
        log.error(`Follow-up ${followUp.id} falhou após ${MAX_RETRIES} tentativas.`);
      } else {
        log.error(`Falha ao enviar follow-up ${followUp.id} (tentativa ${followUp.retries}): ${err.message}`);
      }

      updated = true;
    }
  }

  if (updated) state.set('followUps', followUps);
}

async function sendDailyChecklistSummary() {
  const targetPhone = getDefaultReminderPhone();
  const pending = listTasks({ status: 'pending' });

  if (!targetPhone) {
    log.info(`Checklist diário: ${pending.length} tarefas pendentes (sem envio: WHATSAPP_REMINDER_DEFAULT_PHONE não definido).`);
    return;
  }

  const message = [
    'Checklist diario:',
    `Tarefas pendentes: ${pending.length}`,
    pending.length > 0 ? `Primeira pendente: ${pending[0].title}` : 'Sem tarefas pendentes.'
  ].join('\n');

  try {
    await sendWhatsAppMessage(targetPhone, message);
    log.info(`Resumo do checklist diário enviado para ${targetPhone}.`);
  } catch (err) {
    log.error(`Falha ao enviar checklist diário: ${err.message}`);
  }
}

/**
 * Processa lembretes pendentes — chamado pelo scheduler.
 */
async function processReminders() {
  const now = new Date().toISOString();
  const reminders = state.get('reminders', []);
  let updated = false;

  for (const reminder of reminders) {
    if (reminder.status !== 'scheduled') continue;
    if (reminder.sendAt > now) continue;

    log.info(`Enviando lembrete: "${reminder.message}" para ${reminder.phone}`);
    reminder.lastAttempt = now;

    try {
      await sendWhatsAppMessage(reminder.phone, reminder.message);
      reminder.status = 'sent';
      reminder.sentAt = now;
      log.info(`Lembrete enviado com sucesso: ${reminder.id}`);

      // Se recorrente, criar próximo
      if (reminder.recurring) {
        const next = calculateNextOccurrence(reminder.sendAt, reminder.recurring);
        if (next) {
          addReminder({
            ...reminder,
            sendAt: next,
            id: undefined,
            status: undefined,
            retries: undefined,
            createdAt: undefined
          });
          log.info(`Próxima ocorrência agendada: ${next}`);
        }
      }
    } catch (err) {
      reminder.retries++;
      log.error(`Falha ao enviar lembrete ${reminder.id} (tentativa ${reminder.retries}):`, err.message);

      if (reminder.retries >= MAX_RETRIES) {
        reminder.status = 'failed';
        log.error(`Lembrete ${reminder.id} marcado como falha após ${MAX_RETRIES} tentativas.`);
      }
    }

    updated = true;
  }

  if (updated) state.set('reminders', reminders);
}

/**
 * Calcula a próxima ocorrência de um lembrete recorrente.
 */
function calculateNextOccurrence(currentDate, recurring) {
  const date = new Date(currentDate);

  switch (recurring) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    default:
      return null; // Cron expression handled separately
  }

  return date.toISOString();
}

// Scheduler: verificar lembretes a cada minuto
export function startScheduler() {
  migrateLegacyProductivityState();

  schedule('whatsapp-reminders', '* * * * *', processReminders);
  schedule('productivity-followups', '* * * * *', processTaskFollowUps);
  schedule('productivity-daily-checklist', '0 8 * * *', sendDailyChecklistSummary);
  log.info('Scheduler unificado iniciado: lembretes + tarefas + follow-ups.');
}

if (process.argv[1]?.endsWith('whatsapp-lembretes/index.js')) {
  log.info('Agente de Lembretes WhatsApp iniciado.');
  startScheduler();
}
