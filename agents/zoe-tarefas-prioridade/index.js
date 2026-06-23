import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { createLogger, StateManager, schedule } from '../../core/index.js';
import { config } from '../../core/secrets.js';
import {
  handleTdahRouting,
  processTdahFocusSessions,
  buildTdahReminderBlock
} from './tdah-foco.js';
import { startScheduler as startIdeiasScheduler } from '../ideias/index.js';

const AGENT_ID = 'zoe-tarefas-prioridade';
const DISPLAY_NAME = 'Zoe Afazeres';
const log = createLogger(AGENT_ID);
const state = new StateManager(AGENT_ID);

const DEFAULT_OWNER_PHONE_FALLBACK = '553598183459';
const DEFAULT_ALLOWED_OWNER_PHONES = ['5535998183459', '553598183459'];
const DEFAULT_SUMMARY_CRON = '0 * * * *';
const DEFAULT_QUIET_START_HOUR = 21;
const DEFAULT_QUIET_END_HOUR = 7;
const DEFAULT_OPENCLAW_ACCOUNT = 'default';
const DEFAULT_OPENCLAW_CHANNEL = 'whatsapp';
const MAX_TASK_TITLE_LENGTH = 280;
const OPENCLAW_SEND_TIMEOUT_MS = Number(process.env.WHATSAPP_TAREFAS_OPENCLAW_SEND_TIMEOUT_MS || 25000);
const EVOLUTION_SEND_TIMEOUT_MS = Number(process.env.WHATSAPP_TAREFAS_EVOLUTION_SEND_TIMEOUT_MS || 15000);

const EMPTY_LIST_MESSAGE = '✅ Você não tem afazeres pendentes no momento.';
const SCHEMA_VERSION = 3;

const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3', 'P4'];
const PRIORITIES = {
  P0: {
    emoji: '🔴',
    title: 'Fazer hoje',
    sectionDescription: 'Tarefas urgentes, com prazo, dinheiro, documento, família ou risco.'
  },
  P1: {
    emoji: '🟠',
    title: 'Fazer em breve',
    sectionDescription: 'Tarefas importantes para fazer em até 3 dias.'
  },
  P2: {
    emoji: '🟡',
    title: 'Fazer esta semana',
    sectionDescription: 'Tarefas importantes, mas sem urgência imediata.'
  },
  P3: {
    emoji: '🔵',
    title: 'Quando sobrar tempo',
    sectionDescription: 'Tarefas úteis, mas sem prazo ou consequência grave.'
  },
  P4: {
    emoji: '🟣',
    title: 'Ideias futuras',
    sectionDescription: 'Ideias boas, mas que não precisam virar ação agora.'
  }
};

const LABEL_ORDER = [
  'financeira',
  'familiar',
  'profissional',
  'burocratica',
  'depende_pessoa',
  'destrava',
  'foco_pesado',
  'rapida'
];

const LABELS = {
  rapida: { emoji: '⚡', name: 'Rápida' },
  destrava: { emoji: '🔓', name: 'Destrava' },
  financeira: { emoji: '💰', name: 'Financeira' },
  familiar: { emoji: '👨‍👩‍👧', name: 'Familiar' },
  profissional: { emoji: '💼', name: 'Profissional' },
  foco_pesado: { emoji: '🧠', name: 'Foco pesado' },
  burocratica: { emoji: '📄', name: 'Burocrática' },
  depende_pessoa: { emoji: '📞', name: 'Depende de pessoa' }
};

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

function userError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
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

function resolveAllowedOwnerPhones(settingsOwnerPhone = null) {
  const fromEnv = String(
    process.env.WHATSAPP_TAREFAS_ALLOWED_PHONES ||
    process.env.WHATSAPP_AFAZERES_ALLOWED_PHONES ||
    ''
  )
    .split(',')
    .map(item => normalizePhone(item))
    .filter(Boolean);

  const fromDefaults = DEFAULT_ALLOWED_OWNER_PHONES
    .map(item => normalizePhone(item))
    .filter(Boolean);

  const fromSettingsOwner = normalizePhone(settingsOwnerPhone);
  const fromConfiguredOwner = normalizePhone(resolveConfiguredOwnerPhone());

  const unique = new Set([
    ...fromEnv,
    ...fromDefaults,
    fromSettingsOwner,
    fromConfiguredOwner
  ].filter(Boolean));

  return [...unique];
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
  if (!normalized) throw userError('EMPTY_TASK', 'titulo da tarefa e obrigatorio.');
  if (normalized.length > MAX_TASK_TITLE_LENGTH) {
    throw userError('TASK_TOO_LONG', `titulo da tarefa muito longo (maximo ${MAX_TASK_TITLE_LENGTH} caracteres).`);
  }
  return normalized;
}

function createTaskId() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidPriority(priority) {
  return /^P[0-4]$/i.test(String(priority || '').trim());
}

function normalizePriority(priority) {
  const normalized = String(priority || '').trim().toUpperCase();
  return isValidPriority(normalized) ? normalized : null;
}

function hasAny(comparable, patterns) {
  return patterns.some(pattern => pattern.test(comparable));
}

function addLabel(labels, label) {
  if (LABELS[label] && !labels.includes(label)) labels.push(label);
}

function normalizeLabelList(rawLabels) {
  const labels = Array.isArray(rawLabels) ? rawLabels : [];
  const normalized = [];
  for (const label of labels) {
    if (LABELS[label]) addLabel(normalized, label);
  }
  return LABEL_ORDER.filter(label => normalized.includes(label));
}

function extractDueInfo(title, existingDueText = null) {
  const fallbackDueText = normalizeText(existingDueText || '');
  if (fallbackDueText) {
    return {
      cleanedTitle: sanitizeTaskTitle(title),
      dueText: fallbackDueText,
      dueKind: classifyDueKind(fallbackDueText)
    };
  }

  let cleanedTitle = sanitizeTaskTitle(title);
  let dueText = null;
  const deadlineMatch = cleanedTitle.match(/\bprazo\s+(hoje|amanh[ãa]|segunda(?:-feira)?|ter[cç]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado|sabado|domingo|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);

  if (deadlineMatch) {
    dueText = normalizeText(deadlineMatch[1]);
    cleanedTitle = normalizeText(cleanedTitle.replace(deadlineMatch[0], ''));
  } else {
    const comparable = normalizeForMatch(cleanedTitle);
    if (/\bhoje\b/.test(comparable)) dueText = 'hoje';
    if (/\bamanha\b/.test(comparable)) dueText = 'amanhã';
  }

  return {
    cleanedTitle: sanitizeTaskTitle(cleanedTitle),
    dueText,
    dueKind: classifyDueKind(dueText)
  };
}

function classifyDueKind(dueText) {
  const comparable = normalizeForMatch(dueText || '');
  if (!comparable) return null;
  if (comparable === 'hoje') return 'today';
  if (comparable === 'amanha') return 'tomorrow';
  if (/^(segunda|terca|quarta|quinta|sexta|sabado|domingo)/.test(comparable)) return 'week';
  if (/^\d{1,2}\/\d{1,2}/.test(comparable)) return 'date';
  return 'date';
}

function parseTaskInput(rawTitle) {
  let text = sanitizeTaskTitle(rawTitle);
  let manualPriority = null;

  const prefixMatch = text.match(/^(P\d+)\s+(.+)$/i);
  if (prefixMatch) {
    const priority = normalizePriority(prefixMatch[1]);
    if (!priority) throw userError('INVALID_PRIORITY', 'prioridade invalida.');
    manualPriority = priority;
    text = sanitizeTaskTitle(prefixMatch[2]);
  }

  const suffixMatch = text.match(/\s+prioridade\s+(P\d+)\s*$/i);
  if (suffixMatch) {
    const priority = normalizePriority(suffixMatch[1]);
    if (!priority) throw userError('INVALID_PRIORITY', 'prioridade invalida.');
    manualPriority = priority;
    text = sanitizeTaskTitle(text.replace(suffixMatch[0], ''));
  }

  const dueInfo = extractDueInfo(text);
  return {
    title: dueInfo.cleanedTitle,
    manualPriority,
    dueText: dueInfo.dueText,
    dueKind: dueInfo.dueKind
  };
}

function buildLabels(title) {
  const comparable = normalizeForMatch(title);
  const labels = [];

  if (hasAny(comparable, [
    /\bfgts\b/,
    /\bseguro desemprego\b/,
    /\bimposto\b/,
    /\bimposto de renda\b/,
    /\borcamento\b/,
    /\bcobranca\b/,
    /\bfatura\b/,
    /\bmulta\b/,
    /\brenda\b/,
    /\bairbnb\b/,
    /\bcontrole financeiro\b/,
    /\breceita federal\b/,
    /\bpagamento\b/,
    /\bboleto\b/,
    /\bdinheiro\b/,
    /\bbeneficio\b/
  ])) addLabel(labels, 'financeira');

  if (hasAny(comparable, [
    /\bpai\b/,
    /\bmae\b/,
    /\blara\b/,
    /\bfamilia\b/,
    /\bnamorada\b/,
    /\btio\b/,
    /\bavo\b/,
    /\bavó\b/
  ])) addLabel(labels, 'familiar');

  if (hasAny(comparable, [
    /\bportfolio\b/,
    /\blinkedin\b/,
    /\bamazon\b/,
    /\bopenclaw\b/,
    /\bagente\b/,
    /\bautomacao\b/,
    /\bn8n\b/,
    /\bprojeto\b/,
    /\bsite\b/,
    /\bcliente\b/,
    /\btrabalho\b/
  ])) addLabel(labels, 'profissional');

  if (hasAny(comparable, [
    /\bdocumento/,
    /\bassinar\b/,
    /\bgov\.?br\b/,
    /\bimposto\b/,
    /\bimposto de renda\b/,
    /\bbeneficio\b/,
    /\brequerimento\b/,
    /\bcontrato\b/,
    /\breceita federal\b/,
    /\bfgts\b/,
    /\bseguro desemprego\b/,
    /\btributar/,
    /\bfiscal/
  ])) addLabel(labels, 'burocratica');

  if (hasAny(comparable, [
    /\bconversar\b/,
    /\bligar\b/,
    /\bmandar mensagem\b/,
    /\bpsicolog/,
    /\batendimento\b/,
    /\bvivo\b/,
    /\bfalar com\b/,
    /\bperguntar\b/,
    /\bpedir\b/,
    /\bcombinar\b/
  ])) addLabel(labels, 'depende_pessoa');

  if (hasAny(comparable, [
    /\bdestravar\b/,
    /\bdestrava\b/,
    /\borcamento\b/,
    /\blinkedin\b/,
    /\bopenclaw\b/,
    /\bagente\b/,
    /\bconfigurar\b/,
    /\btributar/,
    /\bfiscal/,
    /\bantes de\b/,
    /\bautomatizar\b/,
    /\bautomacao\b/
  ])) addLabel(labels, 'destrava');

  if (hasAny(comparable, [
    /\bestudar\b/,
    /\bn8n\b/,
    /\bcriar\b.*\bsite\b/,
    /\borganizar\b.*\bmetodo\b/,
    /\bcontrole financeiro\b/,
    /\btributar/,
    /\bfiscal/,
    /\bconfigurar\b.*\bagente\b/,
    /\bautomacao complexa\b/,
    /\bplanejar\b/
  ])) addLabel(labels, 'foco_pesado');

  if (hasAny(comparable, [
    /\bfgts\b/,
    /\bassinar\b/,
    /\bconferir status\b/,
    /\brequerimento\b/,
    /\bmandar mensagem curta\b/,
    /\bcolocar no portfolio\b/
  ])) addLabel(labels, 'rapida');

  if (
    !labels.includes('rapida') &&
    /^ver\b/.test(comparable) &&
    !/\bvivo\b/.test(comparable) &&
    normalizeText(title).split(' ').length <= 6
  ) {
    addLabel(labels, 'rapida');
  }

  return LABEL_ORDER.filter(label => labels.includes(label));
}

function isFutureIdea(comparable) {
  return hasAny(comparable, [
    /\bideia\b/,
    /\btalvez\b/,
    /\bfuturo\b/,
    /\balgum dia\b/,
    /\bpensar em\b/,
    /\bpossibilidade\b/
  ]);
}

function isLowPriorityResearch(comparable) {
  return hasAny(comparable, [
    /\bachar\b.*\bvideo\b/,
    /\bbaixar\b.*\bvideo\b/,
    /\bpesquisar\b.*\bcomplementar\b/,
    /\bver depois\b/,
    /\bquando der\b/,
    /\bsem pressa\b/
  ]);
}

function isExpectedP2Work(comparable) {
  return hasAny(comparable, [
    /\bestudar\b/,
    /\bn8n\b/,
    /\bmelhorar\b/,
    /\bcriar\b.*\bsite\b/,
    /\bsite\b.*\bportfolio\b/,
    /\bcolocar no portfolio\b/,
    /\borganizar\b.*\bmetodo\b/,
    /\bcontrole financeiro\b/,
    /\baprender\b/,
    /\bconteudo\b/,
    /\bprojeto sem prazo\b/
  ]);
}

function isP0Task(comparable) {
  if (hasAny(comparable, [
    /\bfgts\b/,
    /\bseguro desemprego\b/,
    /\brequerimento\b/,
    /\bimposto\b/,
    /\bimposto de renda\b/,
    /\bdocumento/,
    /\bassinar\b/,
    /\bprazo\b/,
    /\bgov\.?br\b/,
    /\bbeneficio\b/,
    /\bdinheiro\b/,
    /\bcobranca\b/,
    /\bfatura\b/,
    /\bmulta\b/,
    /\breceita federal\b/,
    /\bpagamento\b/,
    /\bboleto\b/,
    /\btributar/,
    /\bfiscal/,
    /\bsaude\b/,
    /\burgente\b/
  ])) return true;

  if (/\blara\b/.test(comparable) && /\bpsicolog/.test(comparable)) return true;
  if (/\bpai\b/.test(comparable) && /\bimposto\b/.test(comparable)) return true;
  if (/\bmae\b/.test(comparable) && /\bimposto\b/.test(comparable)) return true;
  return false;
}

function isP1Task(comparable) {
  if (hasAny(comparable, [
    /\bopenclaw\b/,
    /\bagente\b/,
    /\bamazon\b/,
    /\bairbnb\b/,
    /\borcamento\b/,
    /\bvivo\b/,
    /\blinkedin\b/,
    /\bresolver problema/,
    /\bconfigurar\b/,
    /\bdestravar\b/,
    /\bconversar\b/,
    /\bligar\b/,
    /\batendimento\b/
  ])) return true;

  if (/\b(levar|entregar|buscar)\b/.test(comparable) && /\blara\b|\bmae\b|\bpai\b/.test(comparable)) return true;
  return false;
}

function choosePriority(title, labels, dueKind, manualPriority = null) {
  if (manualPriority) return manualPriority;

  const comparable = normalizeForMatch(title);
  if (dueKind === 'today' || dueKind === 'tomorrow') return 'P0';
  if (isFutureIdea(comparable)) return 'P4';
  if (isLowPriorityResearch(comparable)) return 'P3';
  if (isExpectedP2Work(comparable)) return 'P2';
  if (isP0Task(comparable)) return 'P0';
  if (isP1Task(comparable)) return 'P1';
  if (labels.includes('profissional') || labels.includes('foco_pesado')) return 'P2';
  if (dueKind === 'week' || dueKind === 'date') return 'P2';
  return 'P2';
}

function buildPriorityReason(title, priority, labels, dueText, manualPriority = null) {
  const comparable = normalizeForMatch(title);
  if (manualPriority) return 'Prioridade definida manualmente. Mantive essa escolha e atualizei etiquetas e próxima ação.';
  if (dueText && (classifyDueKind(dueText) === 'today' || classifyDueKind(dueText) === 'tomorrow')) {
    return `Tem prazo ${dueText}, então precisa ficar no topo da lista.`;
  }
  if (/\bfgts\b/.test(comparable)) return 'Pode envolver dinheiro disponível e é rápido de verificar.';
  if (/\bseguro desemprego\b|\brequerimento\b/.test(comparable)) return 'Envolve benefício financeiro e possível prazo.';
  if (/\bpsicolog/.test(comparable) && /\blara\b/.test(comparable)) {
    return 'Envolve cuidado familiar e depende da agenda de outras pessoas.';
  }
  if (/\btributar|\bfiscal|\bimposto\b/.test(comparable) && /\bairbnb\b|\bapt\b|\bapartamento\b|\bcabo frio\b/.test(comparable)) {
    return 'Envolve dinheiro, documentos e possível risco fiscal.';
  }
  if (/\bimposto\b/.test(comparable) && /\bpai\b/.test(comparable)) {
    return 'Envolve família, dinheiro e obrigação burocrática.';
  }
  if (/\bassinar\b|\bdocumento/.test(comparable)) return 'É uma pendência burocrática rápida que pode destravar outras coisas.';
  if (/\bvivo\b/.test(comparable)) return 'Depende de atendimento e pode envolver cobrança, fatura ou serviço.';
  if (/\blinkedin\b/.test(comparable)) return 'Melhora sua imagem profissional e pode destravar oportunidades.';
  if (/\borcamento\b/.test(comparable)) return 'Ajuda a decidir gastos e destrava compras ou próximos passos.';
  if (/\bn8n\b|\bestudar\b/.test(comparable)) return 'É importante para aprendizado e automação, mas sem urgência imediata.';
  if (/\bportfolio\b/.test(comparable)) return 'Ajuda seu posicionamento profissional, mas pode ser planejado durante a semana.';
  if (/\bcontrole financeiro\b/.test(comparable)) return 'Melhora organização de dinheiro, mas precisa de foco e planejamento.';
  if (/\bachar\b.*\bvideo\b|\bbaixar\b.*\bvideo\b/.test(comparable)) return 'É útil, mas não é a ação principal agora.';
  if (priority === 'P0') return 'Pode gerar prejuízo, atraso ou consequência importante se ficar para depois.';
  if (priority === 'P1') return 'É importante e ajuda a destravar próximos passos em breve.';
  if (priority === 'P2') return 'É importante para a semana, mas não parece urgente agora.';
  if (priority === 'P3') return 'É útil, mas pode esperar as tarefas principais avançarem.';
  return 'É uma boa ideia para guardar e avaliar depois.';
}

function buildNextAction(title) {
  const comparable = normalizeForMatch(title);
  if (/\bfgts\b/.test(comparable)) return 'Entrar no app FGTS ou Caixa e verificar saldo e saque disponível.';
  if (/\bseguro desemprego\b|\brequerimento\b/.test(comparable)) return 'Consultar o requerimento no gov.br ou no app Carteira de Trabalho Digital.';
  if (/\bpsicolog/.test(comparable) && /\blara\b/.test(comparable)) {
    return 'Mandar mensagem perguntando disponibilidade, valor e forma de atendimento.';
  }
  if (/\blinkedin\b/.test(comparable)) return 'Atualizar título, resumo, experiências, projetos e foto/banner.';
  if (/\bn8n\b/.test(comparable)) return 'Criar um fluxo simples e útil para praticar.';
  if (/\btributar|\bfiscal/.test(comparable) && /\bairbnb\b|\bapt\b|\bapartamento\b|\bcabo frio\b/.test(comparable)) {
    return 'Separar dúvidas, despesas, responsáveis, documentos e possíveis obrigações fiscais.';
  }
  if (/\borcamento\b/.test(comparable) && /\bcabo frio\b|\bapt\b|\bapartamento\b/.test(comparable)) {
    return 'Separar a lista por categorias: cama, banho, cozinha, limpeza e manutenção.';
  }
  if (/\bvivo\b/.test(comparable) && /\blara\b/.test(comparable)) {
    return 'Separar fatura, protocolo, prints e abrir atendimento ou reclamação.';
  }
  if (/\bvivo\b/.test(comparable)) return 'Levantar protocolos, faturas e definir o problema antes de falar com a Vivo.';
  if (/\bcriar\b.*\bsite\b|\bsite\b.*\bportfolio\b/.test(comparable)) {
    return 'Dividir o projeto em estrutura, textos, design, projetos e publicação.';
  }
  if (/\bcolocar no portfolio\b.*\bautomacao\b/.test(comparable)) {
    return 'Criar uma frase forte e listar exemplos de automações já feitas.';
  }
  if (/\bcolocar no portfolio\b/.test(comparable)) {
    return 'Escrever uma frase curta para a seção "Sobre mim" ou "Diferenciais".';
  }
  if (/\bassinar\b|\bdocumento/.test(comparable)) return 'Abrir, conferir e assinar os documentos pendentes.';
  if (/\blevar\b.*\bcaixa\b.*\blara\b/.test(comparable)) return 'Separar a caixa e definir horário/local para entregar.';
  if (/\bcontrole financeiro\b/.test(comparable)) {
    return 'Começar com uma planilha simples de entradas, saídas, saldo e categorias.';
  }
  if (/\bopenclaw\b|\bagente\b|\bamazon\b/.test(comparable)) {
    return 'Definir critérios de busca: categoria, preço, margem, ranking e concorrência.';
  }
  if (/\bimposto\b/.test(comparable) && /\bpai\b/.test(comparable)) {
    return 'Verificar se ele precisa declarar e reunir documentos básicos.';
  }
  if (/\bachar\b.*\bvideo\b|\bbaixar\b.*\bvideo\b/.test(comparable)) {
    return 'Procurar o vídeo depois que as tarefas principais estiverem encaminhadas.';
  }
  if (isFutureIdea(comparable)) return 'Guardar a ideia para avaliar depois.';
  if (/\bconversar\b|\bligar\b|\bmandar mensagem\b|\bfalar com\b/.test(comparable)) {
    return 'Mandar a primeira mensagem ou ligação e registrar a resposta.';
  }
  return 'Dar o primeiro passo simples para tirar isso da lista.';
}

function analyzeTask(title, options = {}) {
  const safeTitle = sanitizeTaskTitle(title);
  const labels = buildLabels(safeTitle);
  const dueText = normalizeText(options.dueText || '') || null;
  const dueKind = options.dueKind || classifyDueKind(dueText);
  const manualPriority = normalizePriority(options.manualPriority);
  const priority = choosePriority(safeTitle, labels, dueKind, manualPriority);

  return {
    priority,
    labels,
    priorityReason: buildPriorityReason(safeTitle, priority, labels, dueText, manualPriority),
    nextAction: buildNextAction(safeTitle),
    dueText,
    dueKind
  };
}

function createTaskFromInput(input, origin = 'comando') {
  const now = nowIso();
  const analysis = analyzeTask(input.title, {
    manualPriority: input.manualPriority,
    dueText: input.dueText,
    dueKind: input.dueKind
  });

  return {
    id: createTaskId(),
    title: input.title,
    priority: analysis.priority,
    labels: analysis.labels,
    priorityReason: analysis.priorityReason,
    nextAction: analysis.nextAction,
    dueText: analysis.dueText,
    dueKind: analysis.dueKind,
    status: 'pendente',
    origin,
    manualPriority: Boolean(input.manualPriority),
    createdAt: now,
    updatedAt: now
  };
}

function normalizeActiveTask(task) {
  const now = nowIso();
  const title = sanitizeTaskTitle(task?.title || '');
  const createdAt = task?.createdAt || now;
  const manualPriority = Boolean(task?.manualPriority && normalizePriority(task?.priority));
  const analysis = analyzeTask(title, {
    manualPriority: manualPriority ? task.priority : null,
    dueText: task?.dueText || null,
    dueKind: task?.dueKind || null
  });

  return {
    id: task?.id || createTaskId(),
    title,
    priority: analysis.priority,
    labels: normalizeLabelList(analysis.labels),
    priorityReason: analysis.priorityReason,
    nextAction: analysis.nextAction,
    dueText: analysis.dueText,
    dueKind: analysis.dueKind,
    status: task?.status === 'feita' ? 'feita' : 'pendente',
    origin: task?.origin || 'comando',
    manualPriority,
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
      const normalizedTask = normalizeActiveTask(task);
      if (normalizedTask.status !== 'feita') normalized.push(normalizedTask);
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
  state.reload();

  const tasks = parseStoredTasks();
  const completedTasks = parseCompletedTasks();
  const settings = resolveSettings();
  const rawTasks = state.get('tasks', []);
  const schemaVersion = Number(state.get('schemaVersion') || 0);

  const shouldSave =
    schemaVersion !== SCHEMA_VERSION ||
    JSON.stringify(tasks) !== JSON.stringify(rawTasks) ||
    !Array.isArray(state.get('completedTasks')) ||
    JSON.stringify(settings) !== JSON.stringify(state.get('settings', {}));

  if (shouldSave) {
    state.setMany({
      schemaVersion: SCHEMA_VERSION,
      migratedFromPriorityAt: state.get('migratedFromPriorityAt') || nowIso(),
      migratedToSmartAfazeresAt: state.get('migratedToSmartAfazeresAt') || nowIso(),
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
  const allowedPhones = resolveAllowedOwnerPhones(owner);

  if (!owner) throw new Error('telefone dono nao configurado. Defina WHATSAPP_TAREFAS_OWNER_PHONE ou WHATSAPP_LEMBRETES_OWNER_PHONE.');
  if (!target) throw new Error(`${context} e obrigatorio.`);
  if (!allowedPhones.includes(target)) {
    throw new Error(`phone nao autorizado. Use apenas os numeros permitidos (${allowedPhones.join(', ')}).`);
  }

  return target;
}

function requirePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw userError('INVALID_POSITION', `${fieldName} deve ser um numero inteiro maior que zero.`);
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

function getDisplayEntries(tasks = listTasksInternal()) {
  return tasks
    .map((task, storageIndex) => ({ task: normalizeActiveTask(task), storageIndex }))
    .filter(entry => entry.task.status !== 'feita')
    .sort((a, b) => {
      const leftPriority = PRIORITY_ORDER.indexOf(a.task.priority);
      const rightPriority = PRIORITY_ORDER.indexOf(b.task.priority);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return a.storageIndex - b.storageIndex;
    })
    .map((entry, index) => ({ ...entry, position: index + 1 }));
}

function resolveDisplayEntry(position, emptyCode = 'EMPTY_LIST') {
  const entries = getDisplayEntries();
  if (!entries.length) throw userError(emptyCode, 'nao ha tarefas pendentes.');

  const index = requirePositiveInteger(position, 'numero');
  const entry = entries[index - 1];
  if (!entry) throw userError('POSITION_NOT_FOUND', 'posicao nao encontrada.');
  return entry;
}

function resolveDisplayEntries(positions, emptyCode = 'EMPTY_LIST') {
  const entries = getDisplayEntries();
  if (!entries.length) throw userError(emptyCode, 'nao ha tarefas pendentes.');

  if (!Array.isArray(positions) || !positions.length) {
    throw userError('INVALID_POSITION', 'informe ao menos uma posicao.');
  }

  return positions.map(position => {
    const index = requirePositiveInteger(position, 'numero');
    const entry = entries[index - 1];
    if (!entry) throw userError('POSITION_NOT_FOUND', `posicao ${index} nao encontrada.`);
    return entry;
  });
}

export function listTasks() {
  return listTasksInternal();
}

export function addTask(title, options = {}) {
  ensureStateShape();

  const tasks = listTasksInternal();
  const input = parseTaskInput(title);
  const task = createTaskFromInput(input, options.origin || 'comando');
  tasks.push(task);
  const savedTasks = saveTasks(tasks);
  const savedEntry = getDisplayEntries(savedTasks).find(entry => entry.task.id === task.id);

  log.info(`Tarefa adicionada: ${task.title} (${task.priority}).`);
  return { ...task, index: savedEntry?.position || savedTasks.length };
}

export function addTaskAtPosition(_position, title) {
  return addTask(title);
}

export function completeTasksByPositions(positions) {
  ensureStateShape();

  const entries = resolveDisplayEntries(positions);
  const tasks = listTasksInternal();
  const completedTasks = parseCompletedTasks();
  const completedByPosition = new Map();
  const completedAt = nowIso();

  for (const entry of [...entries].sort((a, b) => b.storageIndex - a.storageIndex)) {
    const [completed] = tasks.splice(entry.storageIndex, 1);
    const completedEntry = {
      ...completed,
      status: 'feita',
      completedAt,
      completedFromIndex: entry.position,
      updatedAt: completedAt
    };

    completedTasks.push(completedEntry);
    completedByPosition.set(entry.position, { ...completedEntry, index: entry.position });
  }

  saveTasksAndCompleted(tasks, completedTasks);

  const orderedCompleted = entries
    .map(entry => completedByPosition.get(entry.position))
    .filter(Boolean);

  log.info(`Tarefas concluidas: ${orderedCompleted.map(task => task.index).join(', ')}`);
  return orderedCompleted;
}

export function completeTaskByPosition(position) {
  const [completed] = completeTasksByPositions([position]);
  return completed;
}

export function removeTasksByPositions(positions) {
  ensureStateShape();

  const entries = resolveDisplayEntries(positions);
  const tasks = listTasksInternal();
  const removedByPosition = new Map();

  for (const entry of [...entries].sort((a, b) => b.storageIndex - a.storageIndex)) {
    const [removed] = tasks.splice(entry.storageIndex, 1);
    removedByPosition.set(entry.position, { ...removed, index: entry.position });
  }

  saveTasks(tasks);

  const orderedRemoved = entries
    .map(entry => removedByPosition.get(entry.position))
    .filter(Boolean);

  log.info(`Tarefas removidas: ${orderedRemoved.map(task => task.index).join(', ')}`);
  return orderedRemoved;
}

export function removeTaskByPosition(position) {
  const [removed] = removeTasksByPositions([position]);
  return removed;
}

export function moveTaskPriority() {
  throw new Error('o comando de mover foi removido. A lista agora e organizada automaticamente por prioridade.');
}

export function updateTaskPriorityByPosition(position, priority) {
  ensureStateShape();

  const normalizedPriority = normalizePriority(priority);
  if (!normalizedPriority) throw userError('INVALID_PRIORITY', 'prioridade invalida.');

  const tasks = listTasksInternal();
  const entry = resolveDisplayEntry(position);
  const currentTask = tasks[entry.storageIndex];
  const analysis = analyzeTask(currentTask.title, {
    manualPriority: normalizedPriority,
    dueText: currentTask.dueText,
    dueKind: currentTask.dueKind
  });
  const updatedTask = {
    ...currentTask,
    ...analysis,
    manualPriority: true,
    updatedAt: nowIso()
  };

  tasks[entry.storageIndex] = updatedTask;
  const savedTasks = saveTasks(tasks);
  const savedEntry = getDisplayEntries(savedTasks).find(item => item.task.id === updatedTask.id);

  log.info(`Prioridade atualizada para ${normalizedPriority}: ${updatedTask.title}`);
  return { ...updatedTask, index: savedEntry?.position || entry.position };
}

export function editTaskByPosition(position, newTitle) {
  ensureStateShape();

  const input = parseTaskInput(newTitle);
  const tasks = listTasksInternal();
  const entry = resolveDisplayEntry(position);
  const currentTask = tasks[entry.storageIndex];
  const analysis = analyzeTask(input.title, {
    manualPriority: input.manualPriority,
    dueText: input.dueText,
    dueKind: input.dueKind
  });
  const updatedTask = {
    ...currentTask,
    title: input.title,
    ...analysis,
    manualPriority: Boolean(input.manualPriority),
    updatedAt: nowIso()
  };

  tasks[entry.storageIndex] = updatedTask;
  const savedTasks = saveTasks(tasks);
  const savedEntry = getDisplayEntries(savedTasks).find(item => item.task.id === updatedTask.id);

  log.info(`Tarefa editada na posicao ${entry.position}: ${updatedTask.title}`);
  return { ...updatedTask, index: savedEntry?.position || entry.position };
}

export function getTaskDetailsByPosition(position) {
  ensureStateShape();
  const entry = resolveDisplayEntry(position);
  return { ...entry.task, index: entry.position };
}

export function reorganizeTasks() {
  ensureStateShape();

  const tasks = listTasksInternal().map(task => {
    const analysis = analyzeTask(task.title, {
      manualPriority: task.manualPriority ? task.priority : null,
      dueText: task.dueText,
      dueKind: task.dueKind
    });
    return {
      ...task,
      ...analysis,
      updatedAt: nowIso()
    };
  });

  saveTasks(tasks);
  log.info(`Afazeres reorganizados automaticamente (tarefas: ${tasks.length}).`);
  return tasks;
}

export function clearCompletedTasks() {
  ensureStateShape();
  const completedTasks = parseCompletedTasks();
  if (!completedTasks.length) return 0;
  state.set('completedTasks', []);
  log.info(`Afazeres concluidos limpos: ${completedTasks.length}.`);
  return completedTasks.length;
}

function formatPriorityLine(priority) {
  const meta = PRIORITIES[priority] || PRIORITIES.P2;
  return `${meta.emoji} ${priority} | ${meta.title}`;
}

function formatTaskAddedMessage(task, title = '✅ Afazer adicionado') {
  return [
    title,
    '',
    `${task.index}. ${task.title}`,
    '',
    'Prioridade:',
    formatPriorityLine(task.priority),
    '',
    'Motivo:',
    task.priorityReason,
    '',
    'Próxima ação:',
    task.nextAction
  ].join('\n');
}

function formatTaskUpdatedMessage(task) {
  return [
    '✅ Afazer atualizado',
    '',
    `${task.index}. ${task.title}`,
    '',
    'Prioridade:',
    formatPriorityLine(task.priority),
    '',
    'Próxima ação:',
    task.nextAction
  ].join('\n');
}

function formatTaskDetails(task) {
  return [
    '📌 Detalhes do afazer',
    '',
    'Tarefa:',
    task.title,
    '',
    'Prioridade:',
    formatPriorityLine(task.priority),
    '',
    'Motivo:',
    task.priorityReason,
    '',
    'Próxima ação:',
    task.nextAction,
    '',
    'Prazo:',
    task.dueText || 'Não informado',
    '',
    'Status:',
    task.status === 'feita' ? 'Feita' : 'Pendente',
    '',
    'Criada em:',
    task.createdAt
  ].join('\n');
}

function formatPrioritySection(entries, priority) {
  const meta = PRIORITIES[priority];
  const sectionEntries = entries.filter(entry => entry.task.priority === priority);
  if (!sectionEntries.length) return null;

  const lines = [
    `*${meta.emoji} ${priority} | ${meta.title}*`
  ];

  for (const entry of sectionEntries) {
    lines.push(`*${entry.position}.* ${entry.task.title}`);
  }

  return lines.join('\n');
}

export function formatTaskListMessage(tasks = listTasksInternal()) {
  const entries = getDisplayEntries(tasks);
  if (!entries.length) return EMPTY_LIST_MESSAGE;

  const sections = PRIORITY_ORDER
    .map(priority => formatPrioritySection(entries, priority))
    .filter(Boolean);

  return [
    '*📋 Zoe Afazeres*',
    '',
    sections.join('\n\n')
  ].join('\n').trim();
}

function selectMissionEntries(entries) {
  const selected = [];
  const addFirst = predicate => {
    const found = entries.find(entry => predicate(entry) && !selected.some(item => item.task.id === entry.task.id));
    if (found) selected.push(found);
  };

  addFirst(entry => entry.task.priority === 'P0');
  addFirst(entry => entry.task.priority === 'P1' || entry.task.priority === 'P2');
  addFirst(entry => normalizeLabelList(entry.task.labels).includes('rapida'));

  for (const entry of entries) {
    if (selected.length >= 3) break;
    if (!selected.some(item => item.task.id === entry.task.id)) selected.push(entry);
  }

  return selected.slice(0, 3);
}

function formatMissionMessage({ interactive = false } = {}) {
  const entries = getDisplayEntries();
  if (!entries.length) return EMPTY_LIST_MESSAGE;

  const missionEntries = selectMissionEntries(entries);
  const lines = [];

  if (interactive) {
    lines.push('Hoje você não precisa fazer tudo.');
    lines.push('Você precisa fazer o que mais muda sua vida agora.');
    lines.push('');
  }

  lines.push('🔥 Missão de hoje');
  lines.push('');

  for (const entry of missionEntries) {
    const task = entry.task;
    const marker = normalizeLabelList(task.labels).includes('rapida') ? LABELS.rapida.emoji : (PRIORITIES[task.priority]?.emoji || '');
    lines.push(`${entry.position}. ${marker} ${task.title}`);
    lines.push(`Motivo: ${task.priorityReason}`);
    lines.push('');
  }

  if (interactive) {
    lines.push('Depois disso, o resto é bônus.');
    lines.push('');
    lines.push('Para ver tudo:');
    lines.push('/afazer-lista');
    lines.push('');
    lines.push('Para concluir:');
    lines.push('/afazer-feita <posição>');
  }

  return lines.join('\n').trim();
}

function getHelpMessage() {
  return [
    '📌 Zoe Afazeres',
    '',
    'Adicionar:',
    ' /afazer-add <tarefa>',
    '',
    'Exemplo:',
    ' /afazer-add Ver meu FGTS',
    '',
    'Adicionar com prioridade:',
    ' /afazer-add P0 Assinar documentos',
    ' /afazer-add P1 Organizar LinkedIn',
    ' /afazer-add P2 Estudar n8n',
    '',
    'Listar:',
    ' /afazer-lista',
    '',
    'Concluir:',
    ' /afazer-feita <posição>',
    ' /afazer-feita <posição>, <posição> e <posição>',
    '',
    'Exemplo:',
    ' /afazer-feita 2',
    ' /afazer-feita 1, 2 e 3',
    '',
    'Remover:',
    ' /afazer-remover <posição>',
    ' /afazer-remover <posição>, <posição> e <posição>',
    '',
    'Detalhes:',
    ' /afazer-detalhes <posição>',
    '',
    'Editar:',
    ' /afazer-editar <posição> <novo texto>',
    '',
    'Mudar prioridade:',
    ' /afazer-prioridade <posição> P0',
    '',
    'Missão do dia:',
    ' /afazer-hoje',
    '',
    'Reorganizar prioridades:',
    ' /afazer-reorganizar',
    '',
    'Status dos lembretes:',
    ' /afazer-status',
    '',
    'Limpar tarefas feitas:',
    ' /afazer-limpar-feitas',
    '',
    'Frases naturais:',
    ' adiciona tarefa pagar boleto',
    ' listar tarefas',
    ' concluir tarefa 2',
    ' remover tarefa 3',
    ' me organiza agora',
    ' missão do dia',
    '',
    'Prioridades:',
    ' 🔴 P0 Fazer hoje',
    ' 🟠 P1 Fazer em breve',
    ' 🟡 P2 Fazer esta semana',
    ' 🔵 P3 Quando sobrar tempo',
    ' 🟣 P4 Ideia futura'
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
  const activeWindowLabel = quietStart === quietEnd ? 'nenhuma janela ativa' : `${formatHourLabel(quietEnd)} até ${formatHourLabel(quietStart)}`;

  return [
    'Sim, Papai.',
    `Lembrete automático ativo com agendamento (${settings.summaryCron}).`,
    `Janela de envio: ${activeWindowLabel}.`,
    `Silêncio: ${formatHourLabel(quietStart)} até ${formatHourLabel(quietEnd)} (${timezone}).`,
    `Envio principal: OpenClaw WhatsApp (${settings.openclawChannel}/${settings.openclawAccount}).`
  ].join('\n');
}

function countByPriority(entries) {
  return PRIORITY_ORDER.reduce((acc, priority) => {
    acc[priority] = entries.filter(entry => entry.task.priority === priority).length;
    return acc;
  }, {});
}

function buildSummaryMessage(tasks) {
  const tdahBlock = buildTdahReminderBlock({ tasks, state, log });
  const lines = [
    '*🚨🚨 Lembrete Zoe Afazeres 🚨🚨*',
    '',
    formatTaskListMessage(tasks)
  ];

  if (tdahBlock) {
    lines.push('', tdahBlock);
  }

  return lines.join('\n');
}

function parsePositionList(rawInput) {
  const normalized = normalizeText(rawInput)
    .replace(/\be\b/gi, ',')
    .replace(/;/g, ',');

  if (!normalized) return null;
  if (/[^0-9,\s]/.test(normalized)) return null;

  const positions = [];
  const seen = new Set();

  for (const token of normalized.split(/[,\s]+/).filter(Boolean)) {
    const position = Number(token);
    if (!Number.isInteger(position) || position <= 0) return null;
    if (!seen.has(position)) {
      seen.add(position);
      positions.push(position);
    }
  }

  return positions.length ? positions : null;
}

function parseSlashCommand(input) {
  if (input === '/afazer-ajuda') return { action: 'help' };
  if (input === '/afazer-status') return { action: 'status' };
  if (input === '/afazer-lista') return { action: 'list' };
  if (input === '/afazer-hoje') return { action: 'today' };
  if (input === '/afazer-reorganizar') return { action: 'reorganize' };
  if (input === '/afazer-limpar-feitas') return { action: 'clearCompleted' };

  if (/^\/afazer-add\s*$/i.test(input)) return { action: 'add', title: '' };

  const addWithLegacyNumberMatch = input.match(/^\/afazer-add\s+\d+\s*:\s*(.+)$/i);
  if (addWithLegacyNumberMatch) {
    return { action: 'add', title: addWithLegacyNumberMatch[1].trim(), legacyNumberIgnored: true, origin: 'comando' };
  }

  const addMatch = input.match(/^\/afazer-add\s+(.+)$/i);
  if (addMatch) return { action: 'add', title: addMatch[1].trim(), origin: 'comando' };

  const doneMatch = input.match(/^\/afazer-feita\s+(.+)$/i);
  if (doneMatch) {
    const positions = parsePositionList(doneMatch[1]);
    if (!positions) return { action: 'completeInvalidFormat' };
    return { action: 'complete', positions };
  }
  if (/^\/afazer-feita\b/i.test(input)) return { action: 'completeInvalidFormat' };

  const removeMatch = input.match(/^\/afazer-remover\s+(.+)$/i);
  if (removeMatch) {
    const positions = parsePositionList(removeMatch[1]);
    if (!positions) return { action: 'removeInvalidFormat' };
    return { action: 'remove', positions };
  }
  if (/^\/afazer-remover\b/i.test(input)) return { action: 'removeInvalidFormat' };

  const detailsMatch = input.match(/^\/afazer-detalhes\s+(\d+)$/i);
  if (detailsMatch) return { action: 'details', index: Number(detailsMatch[1]) };

  const priorityMatch = input.match(/^\/afazer-prioridade\s+(\d+)\s+(\S+)$/i);
  if (priorityMatch) return { action: 'priority', index: Number(priorityMatch[1]), priority: priorityMatch[2] };
  if (/^\/afazer-prioridade\b/i.test(input)) return { action: 'priorityIncomplete' };

  const editMatch = input.match(/^\/afazer-editar\s+(\d+)\s*(.*)$/i);
  if (editMatch) return { action: 'edit', index: Number(editMatch[1]), title: editMatch[2].trim() };

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
    /^me\s+mostra\s+minhas\s+tarefas$/.test(comparable) ||
    /^mostra\s+minha\s+lista$/.test(comparable) ||
    /^quais\s+sao\s+((minhas|meus)\s+)?(tarefas|afazeres)(\s+pendentes)?$/.test(comparable)
  ) {
    return { action: 'list' };
  }

  if (
    /^(me ajuda a priorizar|me organiza agora|organizar tarefas|prioriza minha lista|missao do dia|o que eu tenho que fazer hoje|o que eu faco agora|qual tarefa eu faco primeiro)$/.test(comparable)
  ) {
    return { action: 'interactiveToday' };
  }

  if (/(lembrete|resumo).*(tarefa|afazeres?)/.test(comparable) && /(ativo|configurad[oa]|10\s*em\s*10)/.test(comparable)) {
    return { action: 'status' };
  }

  if (/10\s*em\s*10/.test(comparable) && /(tarefa|afazeres?|lembrete|resumo)/.test(comparable)) {
    return { action: 'status' };
  }

  const addSpecificMatch = input.match(/^(?:adiciona|adicionar)\s+(?:nos?\s+)?afazeres?\s+(.+)$/i)
    || input.match(/^(?:coloca|colocar)\s+na\s+lista\s+(.+)$/i)
    || input.match(/^(?:nova\s+tarefa|anotar|criar\s+afazer)\s+(.+)$/i)
    || input.match(/^(?:adiciona|adicionar|inclui|incluir|cria|criar)\s+(?:a\s+)?tarefa\s+(.+)$/i);
  if (addSpecificMatch) return { action: 'add', title: addSpecificMatch[1].trim(), origin: 'frase natural' };

  const addDirectMatch = input.match(/^(?:adiciona|adicionar|inclui|incluir|cria|criar)\s+(.+)$/i);
  if (addDirectMatch && !/^(lembrete|resumo|status)\b/i.test(addDirectMatch[1])) {
    return { action: 'add', title: addDirectMatch[1].trim(), origin: 'frase natural' };
  }

  const completeMatch = comparable.match(/^(?:concluir|conclui|finalizar|finaliza)\s+(?:a\s+)?tarefa\s+(\d+)$/)
    || comparable.match(/^marcar\s+(?:a\s+)?tarefa\s+(\d+)\s+como\s+(?:feita|concluida)$/)
    || comparable.match(/^tarefa\s+(\d+)\s+(?:feita|concluida)$/)
    || comparable.match(/^feito\s+(\d+)$/);
  if (completeMatch) return { action: 'complete', index: Number(completeMatch[1]) };

  const removeMatch = comparable.match(/^(?:remover|remove|excluir|exclui|apagar|apaga)\s+(?:a\s+)?tarefa\s+(\d+)$/);
  if (removeMatch) return { action: 'remove', index: Number(removeMatch[1]) };

  const editMatch = input.match(/^(?:editar|edita)\s+(?:a\s+)?tarefa\s+(\d+)\s+(.+)$/i)
    || input.match(/^(?:alterar|altera)\s+(?:a\s+)?tarefa\s+(\d+)\s+para\s+(.+)$/i);
  if (editMatch) return { action: 'edit', index: Number(editMatch[1]), title: editMatch[2].trim() };

  const priorityMatch = comparable.match(/^mudar\s+prioridade\s+da\s+tarefa\s+(\d+)\s+para\s+(p\d+)$/)
    || comparable.match(/^colocar\s+tarefa\s+(\d+)\s+como\s+(p\d+)$/)
    || comparable.match(/^muda\s+a\s+tarefa\s+(\d+)\s+para\s+(p\d+)$/);
  if (priorityMatch) return { action: 'priority', index: Number(priorityMatch[1]), priority: priorityMatch[2].toUpperCase() };

  if (/^(mover|move)\s+(a\s+)?tarefa\s+\d+\s+para\s+\d+$/.test(comparable)) return { action: 'moveRemoved' };

  return null;
}

function formatInvalidPriorityMessage() {
  return [
    '❌ Prioridade inválida.',
    '',
    'Use:',
    'P0, P1, P2, P3 ou P4.'
  ].join('\n');
}

function formatIncompleteAddMessage() {
  return [
    '❌ Comando incompleto.',
    '',
    'Use:',
    '/afazer-add <tarefa>',
    '',
    'Exemplo:',
    '/afazer-add Ver meu FGTS'
  ].join('\n');
}

function formatCommandError(err, parsed) {
  if (err?.code === 'INVALID_PRIORITY') return formatInvalidPriorityMessage();
  if (err?.code === 'EMPTY_TASK' || parsed?.action === 'add') return formatIncompleteAddMessage();

  if (parsed?.action === 'complete') {
    return [
      '❌ Não encontrei essa posição na lista.',
      'Use /afazer-lista para ver os números corretos.'
    ].join('\n');
  }

  if (parsed?.action === 'remove') {
    return [
      '❌ Não encontrei essa tarefa.',
      'Use /afazer-lista para conferir a posição.'
    ].join('\n');
  }

  if (parsed?.action === 'edit') {
    return [
      '❌ Não encontrei essa posição na lista.',
      'Use /afazer-lista para conferir a posição.'
    ].join('\n');
  }

  if (parsed?.action === 'details' || parsed?.action === 'priority') {
    return [
      '❌ Não encontrei essa posição na lista.',
      'Use /afazer-lista para ver os números corretos.'
    ].join('\n');
  }

  return `❌ ${err?.message || String(err)}`;
}

function executeParsedCommand(parsed) {
  if (!parsed?.action) return 'Comando não reconhecido.\n\n' + getHelpMessage();

  switch (parsed.action) {
    case 'help':
      return getHelpMessage();

    case 'status':
      return getReminderStatusMessage();

    case 'list':
      return formatTaskListMessage();

    case 'today':
      return formatMissionMessage();

    case 'interactiveToday':
      return formatMissionMessage({ interactive: true });

    case 'add': {
      const task = addTask(parsed.title, { origin: parsed.origin || 'comando' });
      const title = parsed.legacyNumberIgnored ? '✅ Afazer adicionado no fim da lista' : '✅ Afazer adicionado';
      return formatTaskAddedMessage(task, title);
    }

    case 'complete': {
      const positions = Array.isArray(parsed.positions) && parsed.positions.length ? parsed.positions : [parsed.index];
      const tasks = completeTasksByPositions(positions);

      if (tasks.length === 1) {
        return [
          `✅ Afazer marcado como feito: ${tasks[0].title}`,
          '',
          formatTaskListMessage()
        ].join('\n');
      }

      return [
        `✅ ${tasks.length} afazeres marcados como feitos:`,
        ...tasks.map(task => `${task.index}. ${task.title}`),
        '',
        formatTaskListMessage()
      ].join('\n');
    }

    case 'remove': {
      const positions = Array.isArray(parsed.positions) && parsed.positions.length ? parsed.positions : [parsed.index];
      const tasks = removeTasksByPositions(positions);

      if (tasks.length === 1) {
        return [
          `✅ Afazer removido: ${tasks[0].title}`,
          '',
          formatTaskListMessage()
        ].join('\n');
      }

      return [
        `✅ ${tasks.length} afazeres removidos:`,
        ...tasks.map(task => `${task.index}. ${task.title}`),
        '',
        formatTaskListMessage()
      ].join('\n');
    }

    case 'completeInvalidFormat':
      return [
        '❌ Formato inválido.',
        '',
        'Use:',
        '/afazer-feita <posição>',
        '/afazer-feita 1, 2 e 3'
      ].join('\n');

    case 'removeInvalidFormat':
      return [
        '❌ Formato inválido.',
        '',
        'Use:',
        '/afazer-remover <posição>',
        '/afazer-remover 1, 2 e 3'
      ].join('\n');

    case 'details':
      return formatTaskDetails(getTaskDetailsByPosition(parsed.index));

    case 'priority': {
      const task = updateTaskPriorityByPosition(parsed.index, parsed.priority);
      return [
        `✅ Prioridade de "${task.title}" atualizada para ${task.priority}`,
        '',
        formatTaskListMessage()
      ].join('\n');
    }

    case 'priorityIncomplete':
      return [
        '❌ Comando incompleto.',
        '',
        'Use:',
        '/afazer-prioridade <posição> P0'
      ].join('\n');

    case 'edit':
      if (!normalizeText(parsed.title)) {
        return [
          '❌ Informe o novo texto da tarefa.',
          '',
          'Exemplo:',
          '/afazer-editar 2 Conversar com duas psicólogas para a Lara'
        ].join('\n');
      }
      return formatTaskUpdatedMessage(editTaskByPosition(parsed.index, parsed.title));

    case 'reorganize':
      reorganizeTasks();
      return [
        '✅ Reorganizei seus afazeres com base em urgência, impacto, prazo, dinheiro, família, trabalho e esforço.',
        '',
        formatTaskListMessage()
      ].join('\n');

    case 'clearCompleted': {
      const removedCount = clearCompletedTasks();
      return removedCount > 0
        ? '✅ Afazeres concluídos foram limpos.'
        : '✅ Não há afazeres concluídos para limpar.';
    }

    case 'moveRemoved':
      return 'O comando de mover foi removido. Agora a lista é organizada automaticamente por prioridade.';

    default:
      return 'Comando não reconhecido.\n\n' + getHelpMessage();
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

  try {
    const dashboardPort = Number(process.env.DASHBOARD_PORT || 3456);
    const serverHost = process.env.OPENCLAW_SERVER || config.openclaw.server || '127.0.0.1';
    const dashboardUrl = process.env.TDAH_HTML_URL || `http://${serverHost}:${dashboardPort}/central-tdah/`;

    const tdahResult = handleTdahRouting({
      text: input,
      phone: targetPhone,
      state,
      log,
      getTasks: listTasksInternal,
      dashboardUrl
    });

    if (tdahResult?.handled) {
      return tdahResult.response;
    }
  } catch (err) {
    log.error(`Falha ao processar comando TDAH para ${targetPhone}: ${err.message}`);
    return 'Nao consegui processar o fluxo TDAH agora. Tente novamente com /tdah.';
  }

  const parserInput = input.toLowerCase().startsWith('afazer-') ? `/${input}` : input;
  const parsed = parserInput.startsWith('/') ? parseSlashCommand(parserInput) : parseNaturalCommand(parserInput);

  try {
    const output = executeParsedCommand(parsed);
    log.info(`Comando de afazeres processado para ${targetPhone}: ${input}`);
    return output;
  } catch (err) {
    log.warn(`Comando de afazeres retornou erro de usuario para ${targetPhone}: ${err.message}`);
    return formatCommandError(err, parsed);
  }
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
  schedule('zoe-tdah-foco-followup', '* * * * *', async () => {
    await processTdahFocusSessions({
      state,
      log,
      sendWhatsAppMessage
    });
  }, timezone);
  startIdeiasScheduler();
  schedulerStarted = true;

  log.info(`Scheduler iniciado para ${DISPLAY_NAME}: ${cronExpression} (${timezone}).`);
}


if (process.argv[1]?.endsWith('zoe-tarefas-prioridade/index.js')) {
  log.info(`${DISPLAY_NAME} iniciado.`);
  startScheduler();
}
