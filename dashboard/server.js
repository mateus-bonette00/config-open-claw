import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const STORAGE_DIR = path.join(PROJECT_DIR, 'storage');
const STATE_DIR = path.join(STORAGE_DIR, 'state');
const AUDIT_DIR = path.join(STORAGE_DIR, 'audit', 'fba');
const LOG_DIR = path.join(STORAGE_DIR, 'logs');
const SCREENSHOTS_DIR = path.join(STORAGE_DIR, 'screenshots');
const INPUT_DIR = process.env.FBA_INPUT_DIR || '/home/bonette/Documentos/fornecedores-produtos';
const DONE_DIR = process.env.FBA_DONE_DIR || path.join(INPUT_DIR, 'feitos');
const CONTROL_SCRIPT = path.join(PROJECT_DIR, 'scripts', 'lucas1-control.sh');
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || '/home/bonette/.openclaw/openclaw.json';
const CHROME_PROFILE_DIR = process.env.CHROME_USER_DATA_DIR || '/home/bonette/.config/google-chrome';
const CHROME_PROFILE_NAME = process.env.CHROME_PROFILE || 'Default';
const CHROME_EXECUTABLE_PATH = process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
const KEEPA_EXTENSION_ID = 'neebplgakaahbhdphmkckjjcegoiijjo';
const AZINSIGHT_EXTENSION_ID = 'gefiflkplklbfkcjjcbobokclopbigfg';

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT || '3456', 10);
const STATE_PATH = path.join(STATE_DIR, 'fba.json');
const LOG_FILES = [
  ['trigger', path.join(LOG_DIR, 'fba-trigger.log')],
  ['agent', path.join(LOG_DIR, 'fba-agent.log')],
  ['browser', path.join(LOG_DIR, 'fba-browser.log')],
  ['parser', path.join(LOG_DIR, 'fba-parser.log')]
];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/artifacts', express.static(STORAGE_DIR));

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function stripAnsi(value = '') {
  return String(value)
    .replace(/\u0000/g, '')
    .replace(/\u001B\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\u001B][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .trimEnd();
}

function tailLines(filePath, lines = 80) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = stripAnsi(fs.readFileSync(filePath, 'utf-8'));
    return content.split('\n').slice(-lines).join('\n').trim();
  } catch {
    return '';
  }
}

function aggregateLogs(lines = 80) {
  const perFile = Math.max(20, Math.ceil(lines / Math.max(LOG_FILES.length, 1)));
  const chunks = [];

  for (const [label, filePath] of LOG_FILES) {
    const tailed = tailLines(filePath, perFile);
    if (!tailed) continue;
    chunks.push(`===== ${label.toUpperCase()} =====\n${tailed}`);
  }

  return chunks.join('\n\n').trim();
}

function getRunningProcesses() {
  const result = spawnSync('bash', ['-lc', 'pgrep -af "run-fba-from-html.sh|node .*agents/fba/index.js" || true'], {
    cwd: PROJECT_DIR,
    encoding: 'utf-8'
  });

  return stripAnsi(result.stdout || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.includes('pgrep -af'));
}

function isFbaProcessRunning() {
  return getRunningProcesses().length > 0;
}

function normalizeModelConfig(model) {
  if (!model) return { primary: null, fallbacks: [] };
  if (typeof model === 'string') return { primary: model, fallbacks: [] };
  if (typeof model === 'object') {
    return {
      primary: model.primary || null,
      fallbacks: Array.isArray(model.fallbacks) ? model.fallbacks : []
    };
  }
  return { primary: null, fallbacks: [] };
}

function readOpenClawModels() {
  const config = readJsonSafe(OPENCLAW_CONFIG_PATH);
  const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const mainAgent = agents.find(agent => agent.id === 'main') || null;
  const lucas1Agent = agents.find(agent => agent.id === 'fba-amazon') || null;

  return {
    main: normalizeModelConfig(mainAgent?.model),
    lucas1: normalizeModelConfig(lucas1Agent?.model)
  };
}

function inspectChromeExtension(profileRoot, profileName, extensionId, label) {
  const profileDir = path.join(profileRoot, profileName);
  const extensionDir = path.join(profileDir, 'Extensions', extensionId);
  const localSettingsDir = path.join(profileDir, 'Local Extension Settings', extensionId);
  const syncSettingsDir = path.join(profileDir, 'Sync Extension Settings', extensionId);
  const installedVersions = fs.existsSync(extensionDir)
    ? fs.readdirSync(extensionDir).filter(Boolean)
    : [];

  return {
    label,
    id: extensionId,
    installedInProfile: installedVersions.length > 0,
    installedVersions,
    localSettingsPresent: fs.existsSync(localSettingsDir),
    syncSettingsPresent: fs.existsSync(syncSettingsDir)
  };
}

function readChromeDiagnostics() {
  const profileRoot = CHROME_PROFILE_DIR;
  const profileName = CHROME_PROFILE_NAME;
  const profileDir = path.join(profileRoot, profileName);

  return {
    profileRoot,
    profileName,
    profileDir,
    profileExists: fs.existsSync(profileDir),
    keepa: inspectChromeExtension(profileRoot, profileName, KEEPA_EXTENSION_ID, 'Keepa'),
    azInsight: inspectChromeExtension(profileRoot, profileName, AZINSIGHT_EXTENSION_ID, 'AZInsight')
  };
}

function getState() {
  return readJsonSafe(STATE_PATH) || {};
}

function getEntriesFromState(state) {
  return Object.entries(state.productResults || {})
    .map(([index, result]) => ({ index: Number(index), ...result }))
    .sort((a, b) => a.index - b.index);
}

function getStats(state) {
  const entries = getEntriesFromState(state);
  return {
    processed: entries.length,
    approved: entries.filter(item => item.status === 'approved').length,
    rejected: entries.filter(item => item.status === 'rejected').length,
    skipped: entries.filter(item => item.status === 'skipped').length,
    needsReview: entries.filter(item => item.status === 'needs_review').length,
    errors: entries.filter(item => item.status === 'error').length
  };
}

function resolveArtifactUrl(filePath) {
  if (!filePath) return null;

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(PROJECT_DIR, filePath);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  if (absolutePath.startsWith(`${STORAGE_DIR}${path.sep}`)) {
    const relativePath = path.relative(STORAGE_DIR, absolutePath).split(path.sep).join('/');
    return `/artifacts/${encodeURIComponent(relativePath).replace(/%2F/g, '/')}`;
  }

  const screenshotFallback = path.join(SCREENSHOTS_DIR, path.basename(filePath));
  if (fs.existsSync(screenshotFallback)) {
    const relativePath = path.relative(STORAGE_DIR, screenshotFallback).split(path.sep).join('/');
    return `/artifacts/${encodeURIComponent(relativePath).replace(/%2F/g, '/')}`;
  }

  return null;
}

function listAuditSessions(limit = 20) {
  if (!fs.existsSync(AUDIT_DIR)) return [];

  return fs.readdirSync(AUDIT_DIR)
    .filter(entry => fs.statSync(path.join(AUDIT_DIR, entry)).isDirectory())
    .sort()
    .reverse()
    .slice(0, limit)
    .map(entry => {
      const fullPath = path.join(AUDIT_DIR, entry);
      return {
        id: entry,
        directory: fullPath,
        meta: readJsonSafe(path.join(fullPath, 'meta.json'))
      };
    });
}

function getLatestAuditDirectory() {
  return listAuditSessions(1)[0]?.directory || null;
}

function parseScreenshotTimestamp(filePath) {
  const match = path.basename(filePath).match(/-(\d+)\.(png|jpe?g)$/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? numeric : null;
}

function detectLegacyScreenshotPrefix(item) {
  const reason = String(item.reason || item.message || '').toLowerCase();

  if (item.event === 'supplier:error') {
    if (reason.includes('recaptcha') || reason.includes('captcha')) return 'supplier-captcha-';
    if (reason.includes('desafio') || reason.includes('challenge')) return 'supplier-challenge-';
    if (reason.includes('bloqueado') || reason.includes('blocked')) return 'supplier-blocked-';
    if (reason.includes('falha ao abrir') || reason.includes('navigation')) return 'supplier-navigation-error-';
  }

  if (item.event === 'amazon-search:error') {
    const searchType = item.type || 'upc';
    if (reason.includes('recaptcha') || reason.includes('captcha')) return `amazon-${searchType}-captcha-`;
    if (reason.includes('desafio') || reason.includes('challenge')) return `amazon-${searchType}-challenge-`;
    if (reason.includes('bloqueado') || reason.includes('blocked')) return `amazon-${searchType}-blocked-`;
    if (reason.includes('falha ao abrir') || reason.includes('navigation')) return `amazon-${searchType}-navigation-error-`;
  }

  if (item.event === 'amazon-product:error') {
    if (reason.includes('recaptcha') || reason.includes('captcha')) return 'amazon-product-captcha-';
    if (reason.includes('desafio') || reason.includes('challenge')) return 'amazon-product-challenge-';
    if (reason.includes('bloqueado') || reason.includes('blocked')) return 'amazon-product-blocked-';
    if (reason.includes('falha ao abrir') || reason.includes('navigation')) return 'amazon-product-navigation-error-';
  }

  if (item.event === 'product:error' && item.productIndex != null) {
    return `product-error-${item.productIndex}-`;
  }

  return null;
}

function inferLegacyScreenshotPath(item) {
  const prefix = detectLegacyScreenshotPrefix(item);
  if (!prefix || !fs.existsSync(SCREENSHOTS_DIR)) return null;

  const eventTimestamp = item.ts ? new Date(item.ts).getTime() : null;
  const candidates = fs.readdirSync(SCREENSHOTS_DIR)
    .filter(name => name.startsWith(prefix))
    .map(name => ({
      filePath: path.join(SCREENSHOTS_DIR, name),
      ts: parseScreenshotTimestamp(name)
    }))
    .filter(candidate => candidate.ts !== null);

  if (!candidates.length) return null;
  if (!eventTimestamp) return candidates.at(-1)?.filePath || null;

  const nearest = candidates
    .map(candidate => ({
      ...candidate,
      delta: Math.abs(candidate.ts - eventTimestamp)
    }))
    .filter(candidate => candidate.delta <= 120000)
    .sort((a, b) => a.delta - b.delta)[0];

  return nearest?.filePath || null;
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `$${numeric.toFixed(2)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `${numeric.toFixed(1)}%`;
}

function translateMatchConfidence(value) {
  switch (String(value || '').toLowerCase()) {
    case 'high':
      return 'alta';
    case 'medium':
      return 'media';
    case 'low':
      return 'baixa';
    default:
      return String(value || '');
  }
}

function humanizeValidationReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return null;

  if (text === 'titulo-identico') return 'O nome do produto bateu exatamente.';
  if (text === 'titulo-contido') return 'O nome principal do produto bateu.';
  if (text === 'titulo-parcial') return 'O nome bateu parcialmente.';
  if (text === 'upc-unico') return 'A busca por UPC trouxe um unico resultado.';
  if (text === 'upc-forte') return 'A busca por UPC trouxe poucos resultados e reforcou o match.';

  if (text.startsWith('tokens:')) {
    const values = text.slice('tokens:'.length).split(',').filter(Boolean).join(', ');
    return values ? `Palavras principais iguais: ${values}.` : null;
  }

  if (text.startsWith('marca:')) {
    const values = text.slice('marca:'.length).split(',').filter(Boolean).join(', ');
    return values ? `Marca encontrada: ${values}.` : null;
  }

  if (text.startsWith('modelo:')) {
    const values = text.slice('modelo:'.length).split(',').filter(Boolean).join(', ');
    return values ? `Modelo igual: ${values}.` : null;
  }

  if (text.startsWith('sku:')) {
    const values = text.slice('sku:'.length).split(',').filter(Boolean).join(', ');
    return values ? `SKU igual: ${values}.` : null;
  }

  if (text.startsWith('escala:')) {
    const values = text.slice('escala:'.length).split(',').filter(Boolean).join(', ');
    return values ? `Escala igual: ${values}.` : null;
  }

  if (text.startsWith('codigo:')) {
    const values = text.slice('codigo:'.length).split(',').filter(Boolean).join(', ');
    return values ? `Codigo UPC/GTIN igual: ${values}.` : null;
  }

  return text;
}

function humanizeEvent(event, payload) {
  switch (event) {
    case 'session:start':
      return 'Sessão iniciada';
    case 'parse:summary':
      return 'HTML validado pelo parser';
    case 'vpn:validated':
      return 'VPN validada';
    case 'supplier:start':
      return 'Abrindo fornecedor';
    case 'supplier:error':
      return String(payload.reason || '').toLowerCase().includes('não encontrada')
        ? 'Fornecedor não encontrado'
        : 'Bloqueio no fornecedor';
    case 'supplier:data':
      return 'Fornecedor carregado';
    case 'amazon-search:start':
      return payload.type === 'upc' ? 'Busca Amazon por UPC' : 'Busca Amazon por título';
    case 'amazon-search:result':
      return payload.type === 'upc' ? 'Resultado da busca por UPC' : 'Resultado da busca por título';
    case 'amazon-product:start':
      return 'Abrindo produto na Amazon';
    case 'amazon-product:opened':
      return 'Produto Amazon aberto';
    case 'amazon-product:validated':
      return payload.validationAccepted ? 'Produto Amazon confirmado' : 'Produto Amazon rejeitado';
    case 'marketplace:data':
      return 'Keepa e Amazon lidos';
    case 'azinsight:data':
      return 'AZInsight e análise carregados';
    case 'product:end':
      return 'Resultado final do produto';
    case 'product:error':
      return 'Erro durante o produto';
    case 'session:end':
      return 'Sessão finalizada';
    default:
      return event;
  }
}

function dedupeTimelineItems(items = []) {
  const productEndByProduct = new Map();

  for (const item of items) {
    if (item.event !== 'product:end' || item.productIndex == null) continue;
    productEndByProduct.set(item.productIndex, item);
  }

  return items.filter(item => {
    if (item.event !== 'supplier:error' || item.productIndex == null) return true;
    const finalEvent = productEndByProduct.get(item.productIndex);
    if (!finalEvent) return true;
    return finalEvent.screenshotUrl !== item.screenshotUrl;
  });
}

function buildFacts(payload) {
  const facts = [];

  if (payload.term) facts.push(`Busca: ${payload.term}`);
  if (payload.accessMode) facts.push(`Modo de leitura: ${payload.accessMode}`);
  if (payload.asin) facts.push(`ASIN: ${payload.asin}`);
  if (payload.reason) facts.push(`Motivo: ${payload.reason}`);
  if (payload.message) facts.push(`Mensagem: ${payload.message}`);
  if (payload.recoveredFromUrl) facts.push('URL antiga recuperada por busca interna');
  if (payload.recoveryQuery) facts.push(`Busca interna: ${payload.recoveryQuery}`);
  if (payload.price !== undefined && payload.price !== null) facts.push(`Preço fornecedor: ${formatMoney(payload.price)}`);
  if (payload.selectedAmazonPrice !== undefined && payload.selectedAmazonPrice !== null) facts.push(`Preço Amazon: ${formatMoney(payload.selectedAmazonPrice)}`);
  if (payload.selectedFbaFees !== undefined && payload.selectedFbaFees !== null) facts.push(`Taxas FBA: ${formatMoney(payload.selectedFbaFees)}`);
  if (payload.amazonPrice !== undefined && payload.amazonPrice !== null && payload.selectedAmazonPrice === undefined) facts.push(`Preço Amazon: ${formatMoney(payload.amazonPrice)}`);
  if (payload.fbaFee !== undefined && payload.fbaFee !== null && payload.selectedFbaFees === undefined) facts.push(`Taxa FBA: ${formatMoney(payload.fbaFee)}`);
  if (payload.estimatedProfit !== undefined && payload.estimatedProfit !== null) facts.push(`Lucro estimado: ${formatMoney(payload.estimatedProfit)}`);
  if (payload.profit !== undefined && payload.profit !== null) facts.push(`Lucro final: ${formatMoney(payload.profit)}`);
  if (payload.margin !== undefined && payload.margin !== null) facts.push(`Margem: ${formatPercent(payload.margin)}`);
  if (payload.roi !== undefined && payload.roi !== null) facts.push(`ROI: ${formatPercent(payload.roi)}`);
  if (payload.resultCount !== undefined && payload.resultCount !== null) facts.push(`Resultados encontrados: ${payload.resultCount}`);
  if (payload.keepaLoaded === true) facts.push('Keepa na página: sim');
  if (payload.keepaLoaded === false) facts.push('Keepa na página: não');
  if (payload.keepaAvailable === true) facts.push('Keepa lido: sim');
  if (payload.keepaAvailable === false) facts.push('Keepa lido: não');
  if (payload.azInsightLoaded === true) facts.push('AZInsight na página: sim');
  if (payload.azInsightLoaded === false) facts.push('AZInsight na página: não');
  if (payload.azInsightAvailable === true) facts.push('AZInsight lido: sim');
  if (payload.azInsightAvailable === false) facts.push('AZInsight lido: não');
  if (payload.available === true) facts.push('AZInsight lido: sim');
  if (payload.available === false) facts.push('AZInsight lido: não');
  if (Array.isArray(payload.reasons) && payload.reasons.length) facts.push(`Motivos: ${payload.reasons.join(' | ')}`);
  if (payload.matchScore !== undefined && payload.matchScore !== null) facts.push(`Forca do match: ${payload.matchScore}`);
  if (payload.validationScore !== undefined && payload.validationScore !== null) facts.push(`Forca final do match: ${payload.validationScore}`);
  if (payload.matchConfidence) facts.push(`Confianca do match: ${translateMatchConfidence(payload.matchConfidence)}`);
  if (payload.validationConfidence) facts.push(`Confianca final: ${translateMatchConfidence(payload.validationConfidence)}`);
  if (payload.validationAccepted === true) facts.push('Mesmo produto confirmado: sim');
  if (payload.validationAccepted === false) facts.push('Mesmo produto confirmado: nao');
  if (payload.amazonTitle) facts.push(`Titulo Amazon: ${payload.amazonTitle}`);
  if (payload.amazonBrand) facts.push(`Marca Amazon: ${payload.amazonBrand}`);
  if (Array.isArray(payload.matchReasons) && payload.matchReasons.length) {
    for (const item of payload.matchReasons.map(humanizeValidationReason).filter(Boolean)) {
      facts.push(`Por que ele escolheu: ${item}`);
    }
  }
  if (Array.isArray(payload.validationReasons) && payload.validationReasons.length) {
    for (const item of payload.validationReasons.map(humanizeValidationReason).filter(Boolean)) {
      facts.push(`Como ele confirmou: ${item}`);
    }
  }
  if (payload.status) facts.push(`Status: ${payload.status}`);

  return facts.filter(Boolean);
}

function shouldExposeTimelineEvent(event, payload) {
  if (payload.screenshot || payload.screenshotPath) return true;
  return new Set([
    'session:start',
    'parse:summary',
    'vpn:validated',
    'supplier:start',
    'supplier:error',
    'supplier:data',
    'amazon-search:start',
    'amazon-search:error',
    'amazon-search:result',
    'amazon-product:start',
    'amazon-product:validated',
    'amazon-product:error',
    'amazon-product:opened',
    'marketplace:data',
    'azinsight:data',
    'product:end',
    'product:error',
    'session:end'
  ]).has(event);
}

function readAuditCurrent(state) {
  const dir = state.auditTrailDir && fs.existsSync(state.auditTrailDir)
    ? state.auditTrailDir
    : getLatestAuditDirectory();
  if (!dir || !fs.existsSync(dir)) {
    return {
      sessionId: state.auditTrailSessionId || null,
      directory: dir || null,
      meta: null,
      items: []
    };
  }

  const eventsPath = path.join(dir, 'events.ndjson');
  const meta = readJsonSafe(path.join(dir, 'meta.json'));
  const lines = fs.existsSync(eventsPath)
    ? fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean)
    : [];

  const items = lines
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => shouldExposeTimelineEvent(item.event, item))
    .map((item, index) => {
      const screenshotPath = item.screenshot || item.screenshotPath || inferLegacyScreenshotPath(item);
      return {
        id: `${item.ts || index}-${item.event}-${item.productIndex ?? 'session'}`,
        ts: item.ts || null,
        event: item.event,
        label: humanizeEvent(item.event, item),
        productIndex: item.productIndex ?? null,
        productName: item.productName || null,
        searchType: item.type || null,
        status: item.status || null,
        term: item.term || null,
        url: item.pageUrl || item.finalUrl || item.url || item.supplierUrl || item.htmlPath || null,
        screenshotUrl: resolveArtifactUrl(screenshotPath),
        facts: buildFacts(item)
      };
    })
    .sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());

  return {
    sessionId: path.basename(dir),
    directory: dir,
    meta,
    items: dedupeTimelineItems(items)
  };
}

function resolveCurrentAuditDir(state) {
  const dir = state.auditTrailDir && fs.existsSync(state.auditTrailDir)
    ? state.auditTrailDir
    : getLatestAuditDirectory();
  return dir && fs.existsSync(dir) ? dir : null;
}

function readAuditRawItems(dir) {
  if (!dir) return [];
  const eventsPath = path.join(dir, 'events.ndjson');
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function listAuditScreenshotFiles(auditItems = []) {
  const files = new Set();

  for (const item of auditItems) {
    const rawPath = item.screenshot || item.screenshotPath || inferLegacyScreenshotPath(item) || null;
    if (!rawPath) continue;

    const absolute = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(PROJECT_DIR, rawPath);

    if (!absolute.startsWith(`${STORAGE_DIR}${path.sep}`)) continue;
    files.add(absolute);
  }

  return Array.from(files);
}

function deleteFilesSafely(filePaths) {
  let deleted = 0;
  const removed = [];

  for (const filePath of filePaths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      fs.unlinkSync(filePath);
      deleted += 1;
      removed.push(filePath);
    } catch {
      // Ignora falhas individuais para continuar limpando o restante.
    }
  }

  return { deleted, removed };
}

function clearAuditSession(dir) {
  try {
    const eventsPath = path.join(dir, 'events.ndjson');
    const metaPath = path.join(dir, 'meta.json');
    if (fs.existsSync(eventsPath)) fs.unlinkSync(eventsPath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  } catch {
    // Ignora falha ao limpar os arquivos de auditoria.
  }
}

function readQueue() {
  try {
    const pending = fs.existsSync(INPUT_DIR)
      ? fs.readdirSync(INPUT_DIR)
          .filter(name => name.endsWith('.html'))
          .map(name => {
            const fullPath = path.join(INPUT_DIR, name);
            const stats = fs.statSync(fullPath);
            return {
              name,
              size: stats.size,
              modifiedAt: stats.mtime.toISOString()
            };
          })
          .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      : [];

    const done = fs.existsSync(DONE_DIR)
      ? fs.readdirSync(DONE_DIR)
          .filter(name => name.endsWith('.html'))
          .sort()
          .reverse()
      : [];

    return { pending, done };
  } catch (error) {
    return { pending: [], done: [], error: error.message };
  }
}

function runControl(action) {
  const result = spawnSync('bash', [CONTROL_SCRIPT, action], {
    cwd: PROJECT_DIR,
    encoding: 'utf-8'
  });

  return {
    ok: result.status === 0,
    code: result.status ?? 1,
    stdout: stripAnsi(result.stdout || ''),
    stderr: stripAnsi(result.stderr || '')
  };
}

app.get('/api/status', (req, res) => {
  const state = getState();
  const stats = getStats(state);
  const totalProducts = Number(state.totalProducts || 0);
  const lastProcessedIndex = Number(state.lastProcessedIndex ?? -1);
  const progress = totalProducts > 0 && lastProcessedIndex >= 0
    ? Math.min(100, Number((((lastProcessedIndex + 1) / totalProducts) * 100).toFixed(1)))
    : 0;
  const entries = getEntriesFromState(state);
  const lastProcessedProduct = entries.at(-1) || null;
  const models = readOpenClawModels();
  const chromeDiagnostics = readChromeDiagnostics();

  res.json({
    running: isFbaProcessRunning(),
    runStatus: state.runStatus || 'idle',
    sessionStart: state.sessionStart || null,
    finishedAt: state.finishedAt || null,
    runSessionId: state.runSessionId || null,
    mode: state.mode || null,
    totalProducts,
    lastProcessedIndex,
    progress,
    stats,
    currentStep: state.currentStep || null,
    currentProduct: state.currentProduct || null,
    lastProcessedProduct,
    lastError: state.lastError || null,
    htmlFile: state.activeHtmlFile || state.htmlFile || null,
    auditTrailDir: state.auditTrailDir || null,
    auditTrailSessionId: state.auditTrailSessionId || null,
    browserMode: state.browserMode || null,
    browserDisplay: state.browserDisplay || null,
    chromeExecutablePath: state.chromeExecutablePath || CHROME_EXECUTABLE_PATH,
    chromeProfileDir: state.chromeProfileDir || CHROME_PROFILE_DIR,
    chromeProfileName: state.chromeProfileName || CHROME_PROFILE_NAME,
    extensionStatus: state.extensionStatus || null,
    chromeDiagnostics,
    models,
    liveProcesses: getRunningProcesses()
  });
});

app.get('/api/products', (req, res) => {
  const state = getState();
  const filter = String(req.query.filter || 'all');
  const products = getEntriesFromState(state).filter(product => filter === 'all' || product.status === filter);
  res.json({ products });
});

app.get('/api/approved', (req, res) => {
  const approved = getEntriesFromState(getState())
    .filter(product => product.status === 'approved')
    .sort((a, b) => Number(b.profit || 0) - Number(a.profit || 0));

  const totalProfit = approved.reduce((sum, item) => sum + Number(item.profit || 0), 0);
  const avgMargin = approved.length
    ? approved.reduce((sum, item) => sum + Number(item.margin || 0), 0) / approved.length
    : 0;

  res.json({ products: approved, totalProfit, avgMargin });
});

app.get('/api/logs', (req, res) => {
  const lines = parseInt(String(req.query.lines || '120'), 10);
  res.json({ log: aggregateLogs(lines) });
});

app.get('/api/queue', (req, res) => {
  res.json(readQueue());
});

app.get('/api/audit/current', (req, res) => {
  const state = getState();
  res.json(readAuditCurrent(state));
});

app.get('/api/audit/sessions', (req, res) => {
  try {
    res.json({ sessions: listAuditSessions(20) });
  } catch (error) {
    res.status(500).json({ sessions: [], error: error.message });
  }
});

app.post('/api/audit/clear', (req, res) => {
  try {
    const state = getState();
    const dir = resolveCurrentAuditDir(state);
    if (!dir) {
      return res.json({ ok: true, deleted: 0, message: 'Nenhuma sessao ativa para limpar.' });
    }

    const rawItems = readAuditRawItems(dir);
    const files = listAuditScreenshotFiles(rawItems || []);
    const result = deleteFilesSafely(files);
    clearAuditSession(dir);

    res.json({
      ok: true,
      deleted: result.deleted,
      message: `Timeline e prints limpos. Prints apagados: ${result.deleted}`
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || 'Falha ao limpar prints.'
    });
  }
});

app.post('/api/control/:action', (req, res) => {
  const action = String(req.params.action || '').trim().toLowerCase();
  const allowedActions = new Set(['start', 'resume', 'stop', 'reset', 'restart']);

  if (!allowedActions.has(action)) {
    return res.status(400).json({ ok: false, error: 'Acao invalida.' });
  }

  const result = runControl(action);
  if (!result.ok) {
    return res.status(500).json({
      ok: false,
      action,
      error: result.stderr || result.stdout || 'Falha ao executar controle do LUCAS1.'
    });
  }

  res.json({
    ok: true,
    action,
    message: result.stdout || 'Comando executado.'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard FBA rodando em http://0.0.0.0:${PORT}`);
});
