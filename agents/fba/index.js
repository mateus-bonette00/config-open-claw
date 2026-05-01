import fs from 'fs';
import path from 'path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'url';
import { createLogger, StateManager, config } from '../../core/index.js';
import { parseProductsHTML, groupBySupplier, analyzeParsedProducts } from './parser.js';
import {
  launchBrowser,
  preparePage,
  closeBrowser,
  searchAmazon,
  extractAmazonSearchResults,
  goToProductPage,
  extractAmazonProductIdentity,
  waitForMarketplaceExtensions,
  openSupplierPage,
  extractSupplierData,
  inspectPageAccess,
  extractKeepaData,
  extractAZInsightData,
  inputBuyCostInAZInsight,
  checkAmazonSells,
  saveScreenshot,
  verifyVpnConnection
} from './browser.js';
import { evaluateProduct, calculateBuyCost } from './rules.js';
import { generateApprovedHTML } from './report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('fba-agent');
const state = new StateManager('fba');

const PROJECT_DIR = path.join(__dirname, '..', '..');
const INPUT_DIR = process.env.FBA_INPUT_DIR || '/home/bonette/Documentos/fornecedores-produtos';
const OUTPUT_DIR = process.env.FBA_OUTPUT_DIR || '/home/bonette/Documentos/produtos-amazon-lucros';

function findLatestHtmlInDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return null;

    const htmlFiles = fs.readdirSync(dirPath)
      .filter(file => file.toLowerCase().endsWith('.html'))
      .map(file => {
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);
        return { fullPath, mtimeMs: stats.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return htmlFiles[0]?.fullPath || null;
  } catch {
    return null;
  }
}

const HTML_PATH = process.env.FBA_HTML_PATH || findLatestHtmlInDir(INPUT_DIR) || '';
const RESUME = process.argv.includes('--resume');
const DRY_RUN = process.argv.includes('--dry-run');
const MANUAL_MODE = process.argv.includes('--manual');
const MAX_ERRORS_CONSECUTIVOS = 5;
const BATCH_SIZE = parseInt(process.env.FBA_BATCH_SIZE || '200', 10);
const REPORT_DIR = OUTPUT_DIR;
const DONE_DIR = process.env.FBA_DONE_DIR || path.join(INPUT_DIR, 'feitos');
const PROFIT_DIR = process.env.FBA_PROFIT_DIR || OUTPUT_DIR;
const AUDIT_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.FBA_AUDIT || '').toLowerCase());
const AUDIT_SCREENSHOTS = ['1', 'true', 'yes', 'on'].includes(String(process.env.FBA_AUDIT_SCREENSHOTS || '').toLowerCase());
const AUDIT_BASE_DIR = path.join(PROJECT_DIR, 'storage', 'audit', 'fba');
const SUPPLIER_NOT_FOUND_PAUSE_THRESHOLD = 3;
const SUPPLIER_NOT_FOUND_PAUSE_THRESHOLDS = {
  'bossenimp.com': 2
};
const AMAZON_MATCH_STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'from', 'farm', 'tractor', 'toy', 'toys',
  'authentic', 'die', 'cast', 'model', 'set', 'scale', 'years', 'year',
  'john', 'deere', 'ertl', 'big'
]);

class ManualAbortError extends Error {
  constructor() {
    super('Execução interrompida manualmente pelo operador.');
    this.name = 'ManualAbortError';
  }
}

function parseUserNumber(rawValue) {
  if (!rawValue) return null;

  let normalized = rawValue.trim().replace(/\s+/g, '').replace(/[^\d,.-]/g, '');
  if (!normalized) return null;

  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatReasons(result) {
  return (result.reasons || [])
    .filter(Boolean)
    .join(' | ');
}

function normalizeFiniteNumber(value, { allowZero = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (!allowZero && numeric <= 0) return null;
  if (allowZero && numeric < 0) return null;
  return numeric;
}

function firstMeaningfulNumber(values, options = {}) {
  for (const value of values) {
    const normalized = normalizeFiniteNumber(value, options);
    if (normalized !== null) return normalized;
  }
  return null;
}

function describeSupplierPriceStatus(status) {
  switch (status) {
    case 'zero_detected':
      return 'Preço retornou 0.00 (suspeita de seletor/fallback/JS não carregado)';
    case 'variant_not_selected':
      return 'Preço depende de variante não selecionada';
    case 'price_on_request':
      return 'Preço sob consulta (não exposto no HTML)';
    case 'out_of_stock':
      return 'Produto esgotado sem preço válido';
    case 'price_parse_error':
      return 'Preço encontrado, mas parse falhou';
    case 'missing':
    default:
      return 'Preço ausente no DOM/JSON-LD';
  }
}

function parseBooleanEnv(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function determineBrowserMode() {
  const explicit = parseBooleanEnv(process.env.FBA_HEADLESS ?? process.env.CHROME_HEADLESS);
  if (explicit === true) return 'headless';
  if (explicit === false) return 'visual';
  return process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? 'visual' : 'headless';
}

function buildCurrentProductSnapshot(product, extra = {}) {
  if (!product) return null;

  return {
    index: product.index,
    name: product.name,
    upc: product.upc,
    supplierDomain: product.supplierDomain,
    supplierUrl: product.supplierUrl,
    ...extra
  };
}

function buildSupplierLabelCandidates(domain = '') {
  const hostname = String(domain || '').toLowerCase().replace(/^www\./, '');
  const base = hostname.replace(/\.(com|net|org|co|io|us|biz|store)$/i, '');
  const compact = base.replace(/[^a-z0-9]+/g, '');
  const spaced = base.replace(/[-_.]+/g, ' ').trim();

  return [...new Set([hostname, base, compact, spaced].filter(Boolean))];
}

function stripTrailingSupplierSuffix(term, supplierDomain) {
  let text = String(term || '').trim();
  if (!text) return '';

  const candidates = buildSupplierLabelCandidates(supplierDomain);
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const compactCandidate = candidate.replace(/\s+/g, '');

    text = text
      .replace(new RegExp(`\\s*[-|–]\\s*${escaped}$`, 'i'), '')
      .replace(new RegExp(`\\s*[-|–]\\s*${compactCandidate}$`, 'i'), '')
      .trim();
  }

  return text;
}

function buildSearchQueries(product) {
  const queries = [];
  const seen = new Set();

  for (const term of product.upcVariants || []) {
    if (!term || seen.has(`upc:${term}`)) continue;
    seen.add(`upc:${term}`);
    queries.push({ term, type: 'upc', label: `Buscar Amazon por UPC ${term}` });
  }

  const titleCandidates = [
    stripTrailingSupplierSuffix(product.amazonSearchTermTitle, product.supplierDomain),
    stripTrailingSupplierSuffix(product.name, product.supplierDomain)
  ].filter(Boolean);

  for (const term of titleCandidates) {
    const normalized = term.trim();
    if (!normalized || seen.has(`title:${normalized}`)) continue;
    seen.add(`title:${normalized}`);
    queries.push({ term: normalized, type: 'title', label: 'Buscar Amazon por título' });
  }

  return queries;
}

function normalizeAmazonMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeAmazonCompactText(value) {
  return normalizeAmazonMatchText(value).replace(/\s+/g, '');
}

function tokenizeAmazonMatchText(value) {
  return normalizeAmazonMatchText(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => {
      if (token.length < 2) return false;
      if (AMAZON_MATCH_STOPWORDS.has(token)) return false;
      if (/^\d{1,2}$/.test(token)) return false;
      if (/^\d{8,}$/.test(token)) return false;
      return true;
    });
}

function uniqueNonEmptyStrings(values = []) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function extractAmazonScaleTokens(values = []) {
  const tokens = [];

  for (const value of values) {
    const matches = String(value || '').match(/\b\d+\s*(?:\/|:)\s*\d+\b/g) || [];
    for (const match of matches) {
      const normalized = match.replace(/\s+/g, '').replace(/:/g, '/').toLowerCase();
      if (normalized) tokens.push(normalized);
    }
  }

  return uniqueNonEmptyStrings(tokens);
}

function extractAmazonModelTokens(values = []) {
  const tokens = [];

  for (const value of values) {
    const prepared = String(value || '')
      .replace(/([a-zA-Z])\s*-\s*(\d)/g, '$1$2')
      .replace(/(\d)\s*-\s*([a-zA-Z])/g, '$1$2');
    const matches = prepared.match(/\b[a-zA-Z]*\d+[a-zA-Z0-9]*\b/g) || [];

    for (const match of matches) {
      const normalized = normalizeAmazonCompactText(match);
      if (!normalized) continue;
      if (/^\d{12,}$/.test(normalized)) continue;
      if (/^\d{1,2}$/.test(normalized)) continue;
      tokens.push(normalized);
    }
  }

  return uniqueNonEmptyStrings(tokens);
}

function extractAmazonProductCodes(values = []) {
  const codes = [];

  for (const value of values) {
    const matches = String(value || '').match(/\b\d{12,14}\b/g) || [];
    for (const match of matches) {
      codes.push(match);
    }
  }

  return uniqueNonEmptyStrings(codes);
}

function buildAmazonMatchTargets(product, supplierData = {}, searchTerm = '') {
  return uniqueNonEmptyStrings([
    stripTrailingSupplierSuffix(searchTerm, product.supplierDomain),
    stripTrailingSupplierSuffix(supplierData.title, product.supplierDomain),
    stripTrailingSupplierSuffix(product.amazonSearchTermTitle, product.supplierDomain),
    stripTrailingSupplierSuffix(product.name, product.supplierDomain)
  ]);
}

function buildAmazonIdentityProfile(product, supplierData = {}, searchTerm = '') {
  const targets = buildAmazonMatchTargets(product, supplierData, searchTerm);
  const brandTokens = uniqueNonEmptyStrings(
    tokenizeAmazonMatchText(supplierData.brand || '')
      .filter(token => token.length >= 3)
  );
  const skuTokens = extractAmazonModelTokens([supplierData.sku]);
  const modelTokens = uniqueNonEmptyStrings([
    ...extractAmazonModelTokens(targets),
    ...extractAmazonModelTokens([supplierData.sku])
  ]);
  const scaleTokens = extractAmazonScaleTokens([
    ...targets,
    supplierData.category
  ]);
  const productCodes = uniqueNonEmptyStrings([
    ...extractAmazonProductCodes([product.upc, ...(product.upcVariants || [])])
  ]);
  const targetTokens = uniqueNonEmptyStrings(targets.flatMap(tokenizeAmazonMatchText));

  return {
    targets,
    targetTokens,
    brandTokens,
    skuTokens,
    modelTokens,
    scaleTokens,
    productCodes
  };
}

function buildAmazonComparisonBundle(values = [], options = {}) {
  const codeValues = options.codes || [];
  const normalizedValues = uniqueNonEmptyStrings(values.map(normalizeAmazonMatchText));
  const combinedText = normalizedValues.join(' ').trim();
  const compactText = normalizeAmazonCompactText(combinedText);
  const tokenSet = new Set(normalizedValues.flatMap(tokenizeAmazonMatchText));
  const modelTokenSet = new Set(extractAmazonModelTokens(values));
  const scaleTokenSet = new Set(extractAmazonScaleTokens(values));
  const codeSet = new Set([
    ...extractAmazonProductCodes(values),
    ...extractAmazonProductCodes(codeValues)
  ]);

  return {
    combinedText,
    compactText,
    tokenSet,
    modelTokenSet,
    scaleTokenSet,
    codeSet
  };
}

function summarizeAmazonReasons(reasons = [], max = 4) {
  return uniqueNonEmptyStrings(reasons).slice(0, max);
}

function deriveAmazonMatchConfidence(score, hardMisses = [], matchedCodes = []) {
  if (matchedCodes.length > 0) return 'high';
  if (score >= 58 && hardMisses.length === 0) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function compareAmazonProfile(profile, bundle) {
  const reasons = [];
  let score = 0;

  for (const target of profile.targets) {
    const normalizedTarget = normalizeAmazonMatchText(target);
    if (!normalizedTarget) continue;

    if (bundle.combinedText === normalizedTarget) {
      score += 30;
      reasons.push('titulo-identico');
      continue;
    }

    if (bundle.combinedText.includes(normalizedTarget)) {
      score += 20;
      reasons.push('titulo-contido');
      continue;
    }

    if (normalizedTarget.includes(bundle.combinedText) && bundle.combinedText) {
      score += 8;
      reasons.push('titulo-parcial');
    }
  }

  const matchedTokens = profile.targetTokens.filter(token => bundle.tokenSet.has(token));
  const tokenCoverage = profile.targetTokens.length
    ? matchedTokens.length / profile.targetTokens.length
    : 0;
  score += Math.round(tokenCoverage * 20);
  if (matchedTokens.length > 0) {
    reasons.push(`tokens:${matchedTokens.slice(0, 5).join(',')}`);
  }

  const matchedBrandTokens = profile.brandTokens.filter(token => (
    bundle.tokenSet.has(token) || bundle.compactText.includes(normalizeAmazonCompactText(token))
  ));
  if (matchedBrandTokens.length > 0) {
    score += matchedBrandTokens.length * 5;
    reasons.push(`marca:${matchedBrandTokens.join(',')}`);
  }

  const matchedSkuTokens = profile.skuTokens.filter(token => (
    bundle.modelTokenSet.has(token) || bundle.compactText.includes(token)
  ));
  if (matchedSkuTokens.length > 0) {
    score += matchedSkuTokens.length * 14;
    reasons.push(`sku:${matchedSkuTokens.join(',')}`);
  }

  const matchedModelTokens = profile.modelTokens.filter(token => (
    bundle.modelTokenSet.has(token) || bundle.compactText.includes(token)
  ));
  if (matchedModelTokens.length > 0) {
    score += matchedModelTokens.length * 11;
    reasons.push(`modelo:${matchedModelTokens.slice(0, 5).join(',')}`);
  } else if (profile.modelTokens.length > 0) {
    score -= 12;
  }

  const missingModelTokens = profile.modelTokens.filter(token => !matchedModelTokens.includes(token));
  const matchedScaleTokens = profile.scaleTokens.filter(token => (
    bundle.scaleTokenSet.has(token) || bundle.compactText.includes(token.replace('/', ''))
  ));
  if (matchedScaleTokens.length > 0) {
    score += matchedScaleTokens.length * 14;
    reasons.push(`escala:${matchedScaleTokens.join(',')}`);
  } else if (profile.scaleTokens.length > 0) {
    score -= 12;
  }

  const matchedCodes = profile.productCodes.filter(code => (
    bundle.codeSet.has(code) || bundle.compactText.includes(code)
  ));
  if (matchedCodes.length > 0) {
    score += 40;
    reasons.push(`codigo:${matchedCodes.join(',')}`);
  }

  const hardMisses = [];
  if (profile.scaleTokens.length > 0 && matchedScaleTokens.length === 0) {
    hardMisses.push('escala');
  }
  if (profile.modelTokens.length >= 2 && matchedModelTokens.length === 0) {
    hardMisses.push('modelo');
  }

  return {
    score,
    confidence: deriveAmazonMatchConfidence(score, hardMisses, matchedCodes),
    reasons: summarizeAmazonReasons(reasons),
    matchedTokens,
    matchedBrandTokens,
    matchedSkuTokens,
    matchedModelTokens,
    missingModelTokens,
    matchedScaleTokens,
    matchedCodes,
    hardMisses
  };
}

function rankAmazonResults(product, supplierData = {}, results, searchTerm) {
  const profile = buildAmazonIdentityProfile(product, supplierData, searchTerm);

  return (results || [])
    .map(result => {
      const comparison = compareAmazonProfile(
        profile,
        buildAmazonComparisonBundle([result.title, result.url])
      );
      let matchScore = comparison.score;

      if (result.price !== null && result.price !== undefined) matchScore += 1;
      if (result.url?.includes('/dp/')) matchScore += 1;

      return {
        ...result,
        matchScore,
        matchConfidence: deriveAmazonMatchConfidence(matchScore, comparison.hardMisses, comparison.matchedCodes),
        matchReasons: comparison.reasons,
        matchedModelTokens: comparison.matchedModelTokens,
        matchedScaleTokens: comparison.matchedScaleTokens,
        matchedCodes: comparison.matchedCodes,
        hardMisses: comparison.hardMisses
      };
    })
    .sort((a, b) => {
      if ((b.matchScore || 0) !== (a.matchScore || 0)) {
        return (b.matchScore || 0) - (a.matchScore || 0);
      }
      return 0;
    });
}

function validateAmazonProductIdentity(product, supplierData = {}, result, identity, searchTerm, searchMeta = {}) {
  const profile = buildAmazonIdentityProfile(product, supplierData, searchTerm);
  const bundle = buildAmazonComparisonBundle([
    result?.title,
    result?.url,
    identity?.title,
    identity?.brand,
    ...(identity?.modelNumbers || []),
    ...(identity?.bullets || [])
  ], {
    codes: identity?.productCodes || []
  });
  const comparison = compareAmazonProfile(profile, bundle);
  let score = comparison.score + (identity?.asin ? 2 : 0);
  const reasons = [...(comparison.reasons || [])];

  if (searchMeta.matchedBy === 'upc') {
    const resultCount = searchMeta.resultCount || 0;
    if (resultCount === 1) {
      score += 28;
      reasons.push('upc-unico');
    } else if (resultCount > 0 && resultCount <= 3) {
      score += 18;
      reasons.push('upc-forte');
    }
  }

  const accepted = comparison.matchedCodes.length > 0 ||
    (score >= 58 && comparison.hardMisses.length === 0) ||
    score >= 74;

  return {
    ...comparison,
    score,
    reasons: summarizeAmazonReasons(reasons),
    confidence: deriveAmazonMatchConfidence(score, comparison.hardMisses, comparison.matchedCodes),
    accepted
  };
}

function describeSearchFailure(attempts = []) {
  const triedUpc = attempts.some(item => item.type === 'upc');
  const triedTitle = attempts.some(item => item.type === 'title');

  if (triedUpc && triedTitle) return 'Sem resultado na Amazon por UPC nem por título';
  if (triedUpc) return 'Sem resultado na Amazon por UPC';
  return 'Sem resultado na Amazon por título';
}

function markRuntimeState(patch) {
  state.setMany({
    ...patch,
    runtimeUpdatedAt: new Date().toISOString()
  });
}

function buildExtensionRuntimeState(extensionState = {}, keepaData = null, azInsightData = null) {
  const keepaLoaded = extensionState.keepaLoaded === true
    ? true
    : (extensionState.keepaLoaded === false ? false : null);
  const azInsightLoaded = extensionState.azInsightLoaded === true
    ? true
    : (extensionState.azInsightLoaded === false ? false : null);
  const keepaAvailable = keepaData?.available === true
    ? true
    : (keepaData?.available === false ? false : null);
  const azInsightAvailable = azInsightData?.available === true
    ? true
    : (azInsightData?.available === false ? false : null);
  const azInsightAuthIssue = azInsightData?.authIssue || null;

  return {
    keepaLoaded,
    keepaAvailable,
    keepaSummary: keepaLoaded === true
      ? (keepaAvailable === true ? 'Keepa carregou e foi lido.' : 'Keepa carregou, mas os dados não apareceram.')
      : (keepaLoaded === false ? 'Keepa não carregou na página.' : 'Keepa ainda não foi testado nesta sessão.'),
    azInsightLoaded,
    azInsightAvailable,
    azInsightSummary: azInsightLoaded === true
      ? (
        azInsightAuthIssue
          ? 'AZInsight pediu login (não está logado no servidor).'
          : (azInsightAvailable === true ? 'AZInsight carregou e foi lido.' : 'AZInsight carregou, mas os dados não apareceram.')
      )
      : (azInsightLoaded === false ? 'AZInsight não carregou na página.' : 'AZInsight ainda não foi testado nesta sessão.'),
    checkedAt: new Date().toISOString()
  };
}

function createAuditTrail() {
  if (!AUDIT_ENABLED) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionId = `${timestamp}-${process.pid}`;
  const dir = path.join(AUDIT_BASE_DIR, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, 'events.ndjson');
  const metaPath = path.join(dir, 'meta.json');

  const meta = {
    sessionId,
    startedAt: new Date().toISOString(),
    htmlPath: HTML_PATH,
    mode: DRY_RUN ? 'dry-run' : MANUAL_MODE ? 'manual' : RESUME ? 'resume' : 'auto',
    batchSize: BATCH_SIZE,
    screenshots: AUDIT_SCREENSHOTS
  };

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  fs.writeFileSync(eventsPath, '', 'utf-8');

  return {
    sessionId,
    dir,
    eventsPath,
    metaPath
  };
}

function recordAudit(audit, event, data = {}) {
  if (!audit) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...data
  });
  fs.appendFileSync(audit.eventsPath, `${line}\n`, 'utf-8');
}

function createManualController(enabled) {
  if (!enabled) {
    return {
      enabled: false,
      async confirm() {
        return 'continue';
      },
      async resolveChallenge() {
        return 'continue';
      },
      async promptSupplierPrice() {
        return null;
      },
      close() {}
    };
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('--manual requer um terminal interativo (TTY).');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return {
    enabled: true,
    async confirm(message, { allowSkip = true } = {}) {
      const hint = allowSkip
        ? '[Enter=continuar, s=pular produto, q=sair]'
        : '[Enter=continuar, q=sair]';

      const answer = (await rl.question(`\n[manual] ${message} ${hint} `)).trim().toLowerCase();

      if (answer === 'q') throw new ManualAbortError();
      if (allowSkip && answer === 's') return 'skip';
      return 'continue';
    },
    async resolveChallenge(label, issue) {
      const answer = (await rl.question(
        `\n[manual] ${label}: ${issue.reason}. ` +
        `Resolva no Chrome aberto e pressione Enter para continuar. ` +
        `Digite 's' para pular o produto ou 'q' para sair: `
      )).trim().toLowerCase();

      if (answer === 'q') throw new ManualAbortError();
      if (answer === 's') return 'skip';
      return 'continue';
    },
    async promptSupplierPrice(product, supplierData = {}) {
      while (true) {
        const answer = (await rl.question(
          `\n[manual] Preço do fornecedor não encontrado para "${product.name}". ` +
          `Digite o valor em USD, Enter para deixar em revisão, 's' para pular ou 'q' para sair: `
        )).trim().toLowerCase();

        if (!answer) return null;
        if (answer === 'q') throw new ManualAbortError();
        if (answer === 's') return 'skip';

        const parsed = parseUserNumber(answer);
        if (parsed !== null) {
          return {
            price: parsed,
            priceSource: supplierData.priceSource || 'manual',
            manuallyProvided: true
          };
        }

        log.warn(`Valor inválido informado manualmente: ${answer}`);
      }
    },
    close() {
      rl.close();
    }
  };
}

function buildStateResult(product, result) {
  return {
    name: product.name,
    upc: product.upc,
    supplierDomain: product.supplierDomain,
    supplierUrl: product.supplierUrl,
    ...result
  };
}

async function safeCaptureScreenshot(page, label) {
  if (!page) return null;

  try {
    return await saveScreenshot(page, label);
  } catch {
    return null;
  }
}

async function ensureIssueScreenshot(page, issue, label) {
  if (issue?.screenshotPath) return issue.screenshotPath;

  const screenshotPath = await safeCaptureScreenshot(page, label);
  if (issue && screenshotPath) {
    issue.screenshotPath = screenshotPath;
  }

  return screenshotPath;
}

function getBlockedSupplierDomain(runtime, domain) {
  return runtime?.blockedSupplierDomains?.get(domain) || null;
}

function blockSupplierDomain(runtime, product, issue, screenshotPath, options = {}) {
  const force = options.force === true;
  if (!runtime?.blockedSupplierDomains || !product?.supplierDomain || !issue?.type) return;
  if (!force && !['captcha', 'challenge', 'blocked', 'navigation'].includes(issue.type)) return;

  runtime.blockedSupplierDomains.set(product.supplierDomain, {
    type: issue.type,
    reason: issue.reason || 'Bloqueio detectado no fornecedor',
    screenshotPath: screenshotPath || issue.screenshotPath || null,
    productIndex: product.index,
    productName: product.name,
    at: new Date().toISOString()
  });
}

function describePausedSupplierDomain(domain, domainBlock) {
  if (!domainBlock) {
    return `Domínio ${domain} em pausa.`;
  }

  if (domainBlock.type === 'not_found') {
    return `Domínio ${domain} em pausa por URLs antigas ou inexistentes detectadas no produto #${domainBlock.productIndex} (${domainBlock.reason})`;
  }

  return `Domínio ${domain} em pausa por bloqueio detectado no produto #${domainBlock.productIndex} (${domainBlock.reason})`;
}

function resetSupplierNotFound(runtime, domain) {
  if (!runtime?.supplierNotFoundCounts || !domain) return;
  runtime.supplierNotFoundCounts.delete(domain);
}

function getSupplierNotFoundPauseThreshold(domain) {
  return SUPPLIER_NOT_FOUND_PAUSE_THRESHOLDS[domain] || SUPPLIER_NOT_FOUND_PAUSE_THRESHOLD;
}

function buildSupplierNotFoundPauseReason(domain, count) {
  if (domain === 'bossenimp.com') {
    return `Foram encontradas ${count} URLs antigas ou inexistentes no Bossen. O catálogo atual do site não bate com os links do HTML importado.`;
  }

  return `Foram encontradas ${count} URLs inexistentes neste domínio. O catálogo importado parece antigo ou inválido.`;
}

function registerSupplierNotFound(runtime, product, issue, screenshotPath) {
  if (!runtime?.supplierNotFoundCounts || !product?.supplierDomain) {
    return { count: 1, paused: false, reason: issue?.reason || 'Página do fornecedor não encontrada' };
  }

  const current = runtime.supplierNotFoundCounts.get(product.supplierDomain) || { count: 0 };
  const next = {
    count: current.count + 1,
    lastProductIndex: product.index,
    lastProductName: product.name,
    reason: issue?.reason || 'Página do fornecedor não encontrada',
    screenshotPath: screenshotPath || issue?.screenshotPath || null,
    at: new Date().toISOString()
  };
  runtime.supplierNotFoundCounts.set(product.supplierDomain, next);

  const pauseThreshold = getSupplierNotFoundPauseThreshold(product.supplierDomain);
  if (next.count >= pauseThreshold) {
    const pauseIssue = {
      ...issue,
      type: 'not_found',
      reason: buildSupplierNotFoundPauseReason(product.supplierDomain, next.count)
    };
    blockSupplierDomain(runtime, product, pauseIssue, screenshotPath, { force: true });
    return { ...next, paused: true, reason: pauseIssue.reason };
  }

  return { ...next, paused: false };
}

async function interruptibleDelay(runtime, min = 2000, max = 5000) {
  const delay = Math.floor(Math.random() * (max - min) + min);
  let elapsed = 0;

  while (elapsed < delay) {
    if (runtime?.stopRequested) return false;
    const step = Math.min(250, delay - elapsed);
    await new Promise(resolve => setTimeout(resolve, step));
    elapsed += step;
  }

  return true;
}

async function resolveCurrentAccessIssue({ page, manual, label, issue, retry }) {
  if (!issue) {
    return { status: 'ok', result: await retry() };
  }

  if (issue.type === 'navigation') {
    return { status: 'error', issue };
  }

  if (!manual.enabled) {
    return { status: 'skip', issue, automatic: true };
  }

  const decision = await manual.resolveChallenge(label, issue);
  if (decision === 'skip') {
    return { status: 'skip', issue, automatic: false };
  }

  const retried = await retry();
  if (!retried.error) {
    return { status: 'ok', result: retried };
  }

  return { status: 'error', issue: retried.accessIssue || issue };
}

async function extractCurrentSupplierState(page) {
  const accessIssue = await inspectPageAccess(page, 'supplier');
  if (accessIssue) {
    return { error: accessIssue.type, accessIssue, supplier: null };
  }

  const supplier = await extractSupplierData(page);
  return { error: null, accessIssue: null, supplier };
}

async function extractCurrentAmazonSearchState(page, type) {
  const accessIssue = await inspectPageAccess(page, `amazon-${type}`);
  if (accessIssue) {
    return { error: accessIssue.type, accessIssue, results: [] };
  }

  const extracted = await extractAmazonSearchResults(page);
  return { error: null, accessIssue: null, results: extracted.results };
}

async function ensureSupplierData(page, product, manual, audit, runtime) {
  const domainBlock = getBlockedSupplierDomain(runtime, product.supplierDomain);
  if (domainBlock) {
    return {
      status: 'skipped',
      step: 'supplier-domain-blocked',
      reasons: [
        describePausedSupplierDomain(product.supplierDomain, domainBlock)
      ],
      accessIssue: {
        type: domainBlock.type,
        reason: domainBlock.reason
      },
      screenshotPath: null
    };
  }

  markRuntimeState({
    currentStep: 'abrindo-fornecedor',
    currentProduct: buildCurrentProductSnapshot(product),
    searchAttempts: []
  });

  recordAudit(audit, 'supplier:start', {
    productIndex: product.index,
    productName: product.name,
    supplierUrl: product.supplierUrl,
    supplierDomain: product.supplierDomain
  });

  const manualDecision = await manual.confirm(
    `Abrir fornecedor ${product.supplierDomain} para validar preço real`
  );
  if (manualDecision === 'skip') {
    return {
      status: 'skipped',
      step: 'supplier',
      reasons: ['Produto pulado manualmente antes de abrir o fornecedor']
    };
  }

  let supplierResult = await openSupplierPage(page, product.supplierUrl, {
    productName: product.name,
    productCodeVariants: product.upcVariants || []
  });
  if (supplierResult.error) {
    const screenshotPath = await ensureIssueScreenshot(
      page,
      supplierResult.accessIssue,
      `supplier-issue-${product.index}`
    );
    let notFoundSummary = null;
    if (supplierResult.accessIssue?.type === 'not_found') {
      notFoundSummary = registerSupplierNotFound(runtime, product, supplierResult.accessIssue, screenshotPath);
      if (notFoundSummary?.paused) {
        supplierResult.accessIssue.reason = notFoundSummary.reason;
      }
    } else {
      blockSupplierDomain(runtime, product, supplierResult.accessIssue, screenshotPath);
    }

    recordAudit(audit, 'supplier:error', {
      productIndex: product.index,
      productName: product.name,
      supplierDomain: product.supplierDomain,
      reason: supplierResult.accessIssue?.reason || supplierResult.error,
      screenshot: screenshotPath
    });

    const resolved = await resolveCurrentAccessIssue({
      page,
      manual,
      label: `Fornecedor ${product.supplierDomain}`,
      issue: supplierResult.accessIssue,
      retry: async () => extractCurrentSupplierState(page)
    });

    if (resolved.status === 'skip') {
      const resolvedScreenshot = await ensureIssueScreenshot(
        page,
        resolved.issue,
        `supplier-skip-${product.index}`
      );
      blockSupplierDomain(runtime, product, resolved.issue, resolvedScreenshot);
      return {
        status: 'skipped',
        step: 'supplier',
        reasons: [resolved.automatic
          ? (resolved.issue?.type === 'not_found'
            ? resolved.issue?.reason || 'Página do fornecedor não encontrada'
            : `Fornecedor bloqueado automaticamente: ${resolved.issue?.reason || 'bloqueio detectado'}`)
          : 'Produto pulado manualmente após bloqueio no fornecedor'],
        accessIssue: resolved.issue,
        screenshotPath: resolvedScreenshot
      };
    }

    if (resolved.status === 'error') {
      const resolvedScreenshot = await ensureIssueScreenshot(
        page,
        resolved.issue,
        `supplier-error-${product.index}`
      );
      blockSupplierDomain(runtime, product, resolved.issue, resolvedScreenshot);
      return {
        status: 'error',
        step: 'supplier',
        error: resolved.issue.reason,
        reasons: [resolved.issue.reason],
        accessIssue: resolved.issue,
        screenshotPath: resolvedScreenshot
      };
    }

    supplierResult = resolved.result;
  }

  let supplierData = supplierResult.supplier || {};
  const supplierPageUrl = supplierResult.pageUrl || supplierData.url || page.url();
  const supplierAccessMode = supplierResult.fetchedVia || 'browser';
  resetSupplierNotFound(runtime, product.supplierDomain);
  let supplierScreenshot = null;
  if (AUDIT_SCREENSHOTS && supplierAccessMode === 'browser') {
    supplierScreenshot = await safeCaptureScreenshot(page, `audit-supplier-${product.index}`);
  }

  recordAudit(audit, 'supplier:data', {
    productIndex: product.index,
    productName: product.name,
    pageUrl: supplierPageUrl,
    accessMode: supplierAccessMode,
    recoveredFromUrl: supplierResult.recoveryMeta?.fromUrl || null,
    recoverySearchUrl: supplierResult.recoveryMeta?.searchUrl || null,
    recoveryQuery: supplierResult.recoveryMeta?.query || null,
    title: supplierData.title || null,
    price: supplierData.price ?? null,
    pricePrevious: supplierData.pricePrevious ?? null,
    priceStatus: supplierData.priceStatus || null,
    priceConfidence: supplierData.priceConfidence || null,
    priceSource: supplierData.priceSource || null,
    sku: supplierData.sku || null,
    brand: supplierData.brand || null,
    category: supplierData.category || null,
    imageUrl: supplierData.imageUrl || null,
    available: supplierData.available !== false,
    availabilityStatus: supplierData.availabilityStatus || null,
    screenshot: supplierScreenshot
  });

  markRuntimeState({
    currentStep: 'fornecedor-carregado',
    currentProduct: buildCurrentProductSnapshot(product, {
      supplierPrice: supplierData.price ?? null,
      supplierPriceStatus: supplierData.priceStatus || null,
      pageUrl: supplierPageUrl
    })
  });

  if (supplierData.available === false) {
    return {
      status: 'skipped',
      step: 'supplier',
      reasons: [
        `Produto indisponível no fornecedor (${supplierData.availabilityStatus || 'out_of_stock'})`
      ],
      supplierTitle: supplierData.title || null,
      supplierPrice: supplierData.price ?? null,
      supplierPriceStatus: supplierData.priceStatus || 'out_of_stock'
    };
  }

  if (supplierData.price === null) {
    const manualPrice = await manual.promptSupplierPrice(product, supplierData);

    if (manualPrice === 'skip') {
      return {
        status: 'skipped',
        step: 'supplier',
        reasons: ['Produto pulado manualmente porque o preço do fornecedor não foi encontrado'],
        supplierPriceStatus: supplierData.priceStatus || 'missing'
      };
    }

    if (manualPrice) {
      supplierData = {
        ...supplierData,
        price: manualPrice.price,
        priceSource: manualPrice.priceSource,
        manuallyProvided: true,
        priceStatus: 'manual'
      };
      log.info(`Preço informado manualmente: $${supplierData.price.toFixed(2)}`);
    } else {
      return {
        status: 'needs_review',
        step: 'supplier-price',
        reasons: [describeSupplierPriceStatus(supplierData.priceStatus)],
        supplierTitle: supplierData.title || null,
        supplierPrice: null,
        supplierPriceStatus: supplierData.priceStatus || 'missing',
        supplierPriceSource: supplierData.priceSource || null,
        supplierSku: supplierData.sku || null,
        supplierBrand: supplierData.brand || null
      };
    }
  }

  return { status: 'ok', supplierData };
}

async function searchAmazonForProduct(page, product, supplierData, manual, audit, runtime) {
  const queries = buildSearchQueries(product);
  const attempts = [];

  for (const query of queries) {
    markRuntimeState({
      currentStep: query.type === 'upc' ? 'buscando-amazon-upc' : 'buscando-amazon-titulo',
      currentProduct: buildCurrentProductSnapshot(product, {
        searchType: query.type,
        searchTerm: query.term
      }),
      searchAttempts: attempts
    });

    recordAudit(audit, 'amazon-search:start', {
      productIndex: product.index,
      productName: product.name,
      type: query.type,
      term: query.term
    });

    const decision = await manual.confirm(query.label);
    if (decision === 'skip') {
      return {
        status: 'skipped',
        step: `amazon-${query.type}`,
        reasons: [`Produto pulado manualmente antes da busca Amazon por ${query.type}`],
        searchAttempts: attempts
      };
    }

    let searchResult = await searchAmazon(page, query.term, query.type);
    if (searchResult.error) {
      const screenshotPath = await ensureIssueScreenshot(
        page,
        searchResult.accessIssue,
        `amazon-search-${query.type}-issue-${product.index}`
      );
      recordAudit(audit, 'amazon-search:error', {
        productIndex: product.index,
        productName: product.name,
        type: query.type,
        reason: searchResult.accessIssue?.reason || searchResult.error,
        screenshot: screenshotPath
      });

      const resolved = await resolveCurrentAccessIssue({
        page,
        manual,
        label: `Amazon (${query.type})`,
        issue: searchResult.accessIssue,
        retry: async () => extractCurrentAmazonSearchState(page, query.type)
      });

      if (resolved.status === 'skip') {
        const resolvedScreenshot = await ensureIssueScreenshot(
          page,
          resolved.issue,
          `amazon-search-${query.type}-skip-${product.index}`
        );
        return {
          status: 'skipped',
          step: `amazon-${query.type}`,
          reasons: [resolved.automatic
            ? `Busca Amazon por ${query.type} bloqueada automaticamente: ${resolved.issue?.reason || 'bloqueio detectado'}`
            : `Produto pulado manualmente após bloqueio na busca Amazon por ${query.type}`],
          accessIssue: resolved.issue,
          searchAttempts: attempts,
          screenshotPath: resolvedScreenshot
        };
      }

      if (resolved.status === 'error') {
        const resolvedScreenshot = await ensureIssueScreenshot(
          page,
          resolved.issue,
          `amazon-search-${query.type}-error-${product.index}`
        );
        return {
          status: 'error',
          step: `amazon-${query.type}`,
          error: resolved.issue.reason,
          reasons: [resolved.issue.reason],
          accessIssue: resolved.issue,
          searchAttempts: attempts,
          screenshotPath: resolvedScreenshot
        };
      }

      searchResult = resolved.result;
    }

    searchResult = {
      ...searchResult,
      results: rankAmazonResults(product, supplierData, searchResult.results || [], query.term)
    };

    let searchScreenshot = null;
    if (AUDIT_SCREENSHOTS) {
      searchScreenshot = await safeCaptureScreenshot(page, `audit-amazon-search-${query.type}-${product.index}`);
    }

    const top = (searchResult.results || []).slice(0, 3).map(r => ({
      asin: r.asin,
      title: r.title,
      price: r.price ?? null,
      url: r.url,
      score: r.matchScore ?? null,
      confidence: r.matchConfidence || null,
      reasons: r.matchReasons || []
    }));
    const attempt = {
      type: query.type,
      term: query.term,
      resultCount: searchResult.results?.length || 0,
      top
    };
    attempts.push(attempt);

    recordAudit(audit, 'amazon-search:result', {
      productIndex: product.index,
      productName: product.name,
      type: query.type,
      term: query.term,
      resultCount: searchResult.results?.length || 0,
      top,
      screenshot: searchScreenshot
    });

    markRuntimeState({
      currentStep: query.type === 'upc' ? 'resultado-amazon-upc' : 'resultado-amazon-titulo',
      currentProduct: buildCurrentProductSnapshot(product, {
        searchType: query.type,
        searchTerm: query.term,
        resultCount: searchResult.results?.length || 0
      }),
      searchAttempts: attempts
    });

    if (searchResult.results?.length) {
      return {
        status: 'ok',
        searchResult,
        searchAttempts: attempts,
        matchedBy: query.type,
        matchedTerm: query.term
      };
    }

    if (!await interruptibleDelay(runtime, 1500, 3000)) break;
  }

  return {
    status: 'skipped',
    step: 'amazon-search',
    reasons: [describeSearchFailure(attempts)],
    searchAttempts: attempts
  };
}

async function openAmazonResultPage(page, product, supplierData, searchOutcome, manual, audit, runtime) {
  const candidates = (searchOutcome?.searchResult?.results || []).slice(0, 5);
  const mismatches = [];

  for (const [candidateIndex, candidate] of candidates.entries()) {
    markRuntimeState({
      currentStep: 'abrindo-produto-amazon',
      currentProduct: buildCurrentProductSnapshot(product, {
        asin: candidate.asin,
        amazonUrl: candidate.url,
        candidateIndex: candidateIndex + 1
      })
    });

    recordAudit(audit, 'amazon-product:start', {
      productIndex: product.index,
      productName: product.name,
      asin: candidate.asin,
      url: candidate.url,
      candidateIndex: candidateIndex + 1,
      matchScore: candidate.matchScore ?? null,
      matchConfidence: candidate.matchConfidence || null,
      matchReasons: candidate.matchReasons || []
    });

    const decision = await manual.confirm(`Abrir produto Amazon ${candidate.asin} (tentativa ${candidateIndex + 1})`);
    if (decision === 'skip') {
      return {
        status: 'skipped',
        step: 'amazon-product',
        reasons: ['Produto pulado manualmente antes de abrir a página da Amazon']
      };
    }

    let pageResult = await goToProductPage(page, candidate.url);
    if (pageResult.error) {
      const screenshotPath = await ensureIssueScreenshot(
        page,
        pageResult.accessIssue,
        `amazon-product-issue-${product.index}`
      );
      recordAudit(audit, 'amazon-product:error', {
        productIndex: product.index,
        productName: product.name,
        asin: candidate.asin,
        reason: pageResult.accessIssue?.reason || pageResult.error,
        screenshot: screenshotPath
      });

      const resolved = await resolveCurrentAccessIssue({
        page,
        manual,
        label: `Página Amazon ${candidate.asin}`,
        issue: pageResult.accessIssue,
        retry: async () => {
          const accessIssue = await inspectPageAccess(page, 'amazon-product');
          if (accessIssue) {
            return { error: accessIssue.type, accessIssue };
          }

          const extensionState = await waitForMarketplaceExtensions(page);
          return { error: null, accessIssue: null, extensionState };
        }
      });

      if (resolved.status === 'skip') {
        const resolvedScreenshot = await ensureIssueScreenshot(
          page,
          resolved.issue,
          `amazon-product-skip-${product.index}`
        );
        return {
          status: 'skipped',
          step: 'amazon-product',
          reasons: [resolved.automatic
            ? `Página Amazon bloqueada automaticamente: ${resolved.issue?.reason || 'bloqueio detectado'}`
            : 'Produto pulado manualmente após bloqueio na página da Amazon'],
          accessIssue: resolved.issue,
          screenshotPath: resolvedScreenshot
        };
      }

      if (resolved.status === 'error') {
        const resolvedScreenshot = await ensureIssueScreenshot(
          page,
          resolved.issue,
          `amazon-product-error-${product.index}`
        );
        return {
          status: 'error',
          step: 'amazon-product',
          error: resolved.issue.reason,
          reasons: [resolved.issue.reason],
          accessIssue: resolved.issue,
          screenshotPath: resolvedScreenshot
        };
      }

      pageResult = resolved.result;
    }

    await interruptibleDelay(runtime, 3000, 5000);
    const amazonIdentity = await extractAmazonProductIdentity(page);
    const validation = validateAmazonProductIdentity(
      product,
      supplierData,
      candidate,
      amazonIdentity,
      searchOutcome?.matchedTerm || '',
      {
        matchedBy: searchOutcome?.matchedBy || null,
        resultCount: searchOutcome?.searchResult?.results?.length || 0
      }
    );

    let productScreenshot = null;
    if (AUDIT_SCREENSHOTS) {
      productScreenshot = await safeCaptureScreenshot(page, `audit-amazon-product-${product.index}-c${candidateIndex + 1}`);
    }

    recordAudit(audit, 'amazon-product:validated', {
      productIndex: product.index,
      productName: product.name,
      asin: candidate.asin,
      candidateIndex: candidateIndex + 1,
      finalUrl: page.url(),
      amazonTitle: amazonIdentity?.title || null,
      amazonBrand: amazonIdentity?.brand || null,
      amazonCodes: amazonIdentity?.productCodes || [],
      amazonModelNumbers: amazonIdentity?.modelNumbers || [],
      validationScore: validation.score,
      validationConfidence: validation.confidence,
      validationAccepted: validation.accepted,
      validationReasons: validation.reasons,
      keepaLoaded: pageResult.extensionState?.keepaLoaded === true,
      azInsightLoaded: pageResult.extensionState?.azInsightLoaded === true,
      screenshot: productScreenshot
    });

    if (validation.accepted) {
      markRuntimeState({
        currentStep: 'produto-amazon-carregado',
        currentProduct: buildCurrentProductSnapshot(product, {
          asin: candidate.asin,
          amazonUrl: page.url()
        })
      });

      return {
        status: 'ok',
        pageResult,
        bestMatch: candidate,
        amazonIdentity,
        validation,
        extensionState: pageResult.extensionState || null,
        screenshotPath: productScreenshot
      };
    }

    mismatches.push({
      asin: candidate.asin,
      title: amazonIdentity?.title || candidate.title,
      score: validation.score,
      confidence: validation.confidence,
      reasons: validation.reasons
    });

    log.warn(
      `Candidato Amazon rejeitado: ${candidate.asin} ` +
      `(score=${validation.score}, motivos=${(validation.reasons || []).join(', ') || 'sem-detalhes'})`
    );

    if (!await interruptibleDelay(runtime, 800, 1500)) break;
  }

  return {
    status: 'needs_review',
    step: 'amazon-product-match',
    reasons: ['Resultados encontrados na Amazon, mas nenhum bateu com segurança com o produto do fornecedor'],
    mismatches
  };
}

async function processProduct(page, product, manual, audit, runtime) {
  markRuntimeState({
    currentStep: 'iniciando-produto',
    currentProduct: buildCurrentProductSnapshot(product),
    searchAttempts: []
  });

  recordAudit(audit, 'product:start', {
    productIndex: product.index,
    productName: product.name,
    upc: product.upc,
    supplierUrl: product.supplierUrl,
    supplierDomain: product.supplierDomain
  });

  const supplierOutcome = await ensureSupplierData(page, product, manual, audit, runtime);
  if (supplierOutcome.status !== 'ok') {
    recordAudit(audit, 'product:end', {
      productIndex: product.index,
      productName: product.name,
      status: supplierOutcome.status,
      step: supplierOutcome.step || null,
      reasons: supplierOutcome.reasons || [],
      screenshot: supplierOutcome.screenshotPath || null
    });
    return supplierOutcome;
  }

  const supplierData = supplierOutcome.supplierData;
  const supplierPrice = normalizeFiniteNumber(supplierData.price);
  const supplierPriceStatus = supplierData.priceStatus || (supplierPrice !== null ? 'ok' : 'missing');

  const amazonSearchOutcome = await searchAmazonForProduct(page, product, supplierData, manual, audit, runtime);
  if (amazonSearchOutcome.status !== 'ok') {
    recordAudit(audit, 'product:end', {
      productIndex: product.index,
      productName: product.name,
      status: amazonSearchOutcome.status,
      step: amazonSearchOutcome.step || null,
      reasons: amazonSearchOutcome.reasons || [],
      screenshot: amazonSearchOutcome.screenshotPath || null
    });
    return {
      ...amazonSearchOutcome,
      supplierTitle: supplierData.title || null,
      supplierPrice,
      supplierPriceSource: supplierData.priceSource || null,
      supplierPriceStatus,
      searchAttempts: amazonSearchOutcome.searchAttempts || []
    };
  }

  const amazonPageOutcome = await openAmazonResultPage(
    page,
    product,
    supplierData,
    amazonSearchOutcome,
    manual,
    audit,
    runtime
  );
  if (amazonPageOutcome.status !== 'ok') {
    const fallbackBestMatch = amazonSearchOutcome.searchResult?.results?.[0] || null;
    recordAudit(audit, 'product:end', {
      productIndex: product.index,
      productName: product.name,
      status: amazonPageOutcome.status,
      step: amazonPageOutcome.step || null,
      asin: fallbackBestMatch?.asin || null,
      reasons: amazonPageOutcome.reasons || [],
      screenshot: amazonPageOutcome.screenshotPath || null
    });
    return {
      ...amazonPageOutcome,
      asin: fallbackBestMatch?.asin || null,
      amazonTitle: fallbackBestMatch?.title || null,
      amazonUrl: fallbackBestMatch?.url || null,
      supplierTitle: supplierData.title || null,
      supplierPrice,
      supplierPriceSource: supplierData.priceSource || null,
      supplierPriceStatus,
      searchAttempts: amazonSearchOutcome.searchAttempts || [],
      matchedBy: amazonSearchOutcome.matchedBy || null
    };
  }

  const bestMatch = amazonPageOutcome.bestMatch;
  const bestMatchPrice = normalizeFiniteNumber(bestMatch.price);
  log.info(
    `  Match Amazon validado: ${bestMatch.title} (ASIN: ${bestMatch.asin}, score: ${amazonPageOutcome.validation?.score ?? bestMatch.matchScore ?? 0}) - ` +
    `${bestMatchPrice !== null ? `$${bestMatchPrice.toFixed(2)}` : 'preço-não-detectado'}`
  );

  markRuntimeState({
    currentStep: 'analisando-lucro',
    currentProduct: buildCurrentProductSnapshot(product, {
      asin: bestMatch.asin,
      amazonUrl: bestMatch.url
    }),
    searchAttempts: amazonSearchOutcome.searchAttempts || [],
    extensionStatus: buildExtensionRuntimeState(amazonPageOutcome.extensionState || {})
  });

  const keepaData = await extractKeepaData(page);
  const amazonSells = await checkAmazonSells(page);
  recordAudit(audit, 'marketplace:data', {
    productIndex: product.index,
    productName: product.name,
    asin: bestMatch.asin,
    keepaLoaded: amazonPageOutcome.extensionState?.keepaLoaded === true,
    keepaAvailable: keepaData.available || false,
    keepaDrops30d: keepaData.bsrDrops ?? null,
    amazonSells
  });

  let buyCost = null;
  if (supplierPrice !== null) {
    buyCost = calculateBuyCost(supplierPrice);
    const inputDecision = await manual.confirm(
      `Inserir Buy Cost $${buyCost.toFixed(2)} no AZInsight`,
      { allowSkip: false }
    );

    if (inputDecision === 'continue') {
      await inputBuyCostInAZInsight(page, buyCost);
      await interruptibleDelay(runtime, 1000, 2000);
    }
  }

  const azInsightData = await extractAZInsightData(page);
  const amazonPrice = firstMeaningfulNumber([
    bestMatch.price,
    azInsightData.amazonPrice
  ]);
  const fbaFees = firstMeaningfulNumber([
    azInsightData.fbaFee,
    azInsightData.referralFee
  ], { allowZero: true });
  const amazonPriceStatus = amazonPrice !== null ? 'ok' : 'missing';
  const fbaFeesStatus = fbaFees === null ? 'missing' : (fbaFees === 0 ? 'zero_detected' : 'ok');

  recordAudit(audit, 'azinsight:data', {
    productIndex: product.index,
    productName: product.name,
    asin: bestMatch.asin,
    azInsightLoaded: amazonPageOutcome.extensionState?.azInsightLoaded === true,
    azInsightAvailable: azInsightData.available || false,
    available: azInsightData.available || false,
    authIssue: azInsightData.authIssue || null,
    amazonPrice: azInsightData.amazonPrice ?? null,
    fbaFee: azInsightData.fbaFee ?? null,
    selectedAmazonPrice: amazonPrice,
    selectedFbaFees: fbaFees,
    amazonPriceStatus,
    fbaFeesStatus,
    estimatedProfit: azInsightData.estimatedProfit ?? null,
    roi: azInsightData.roi ?? null,
    margin: azInsightData.margin ?? null
  });

  markRuntimeState({
    extensionStatus: buildExtensionRuntimeState(
      amazonPageOutcome.extensionState || {},
      keepaData,
      azInsightData
    )
  });

  if (supplierPrice === null) {
    recordAudit(audit, 'product:end', {
      productIndex: product.index,
      status: 'needs_review',
      step: 'supplier-price',
      asin: bestMatch.asin,
      reasons: ['Preço do fornecedor não encontrado; revisão manual necessária']
    });
    return {
      status: 'needs_review',
      step: 'supplier-price',
      reasons: ['Preço do fornecedor não encontrado; revisão manual necessária'],
      asin: bestMatch.asin,
      amazonTitle: bestMatch.title,
      amazonUrl: bestMatch.url,
      supplierTitle: supplierData.title || null,
      supplierPrice: null,
      supplierPriceStatus,
      supplierPriceSource: supplierData.priceSource || null,
      amazonPrice,
      amazonPriceStatus,
      fbaFees,
      fbaFeesStatus,
      amazonSells,
      keepaDrops30d: keepaData.bsrDrops ?? null,
      keepaAvailable: keepaData.available || false,
      azInsightAvailable: azInsightData.available || false
    };
  }

  const evaluation = evaluateProduct({
    supplierPrice,
    amazonPrice,
    fbaFees,
    amazonSells,
    keepaData,
    azInsightData
  });

  const analysisScreenshot = AUDIT_SCREENSHOTS
    ? await safeCaptureScreenshot(page, `audit-analysis-${product.index}`)
    : null;

  recordAudit(audit, 'product:end', {
    productIndex: product.index,
    productName: product.name,
    status: evaluation.status,
    step: 'completed',
    asin: bestMatch.asin,
    reasons: evaluation.reasons || [],
    profit: evaluation.profit ?? null,
    margin: evaluation.margin ?? null,
    roi: evaluation.roi ?? null,
    matchedBy: amazonSearchOutcome.matchedBy || null,
    screenshot: analysisScreenshot
  });

  return {
    ...evaluation,
    step: 'completed',
    asin: bestMatch.asin,
    amazonTitle: bestMatch.title,
    amazonUrl: bestMatch.url,
    matchedBy: amazonSearchOutcome.matchedBy || null,
    matchedTerm: amazonSearchOutcome.matchedTerm || null,
    searchAttempts: amazonSearchOutcome.searchAttempts || [],
    supplierTitle: supplierData.title || null,
    supplierPrice,
    supplierPriceStatus,
    supplierPriceSource: supplierData.priceSource || null,
    supplierPriceManual: supplierData.manuallyProvided || false,
    supplierSku: supplierData.sku || null,
    supplierBrand: supplierData.brand || null,
    supplierCategory: supplierData.category || null,
    supplierImageUrl: supplierData.imageUrl || null,
    supplierAvailabilityStatus: supplierData.availabilityStatus || null,
    supplierPricePrevious: supplierData.pricePrevious ?? null,
    amazonPriceStatus,
    fbaFeesStatus,
    keepaDrops30d: keepaData.bsrDrops ?? null,
    keepaAvailable: keepaData.available || false,
    azInsightAvailable: azInsightData.available || false,
    analysisScreenshot
  };
}

function runDryRun(products, startIndex) {
  for (let i = startIndex; i < products.length; i++) {
    const product = products[i];
    state.addProductResult(product.index, {
      status: 'needs_review',
      name: product.name,
      upc: product.upc,
      supplierDomain: product.supplierDomain,
      supplierUrl: product.supplierUrl,
      hasValidUPC: product.hasValidUPC
    });
    state.setLastProcessedIndex(i);
  }

  log.info(`\nDry-run concluído: ${products.length - startIndex} produtos para revisão`);
}

function moveProcessedHTML(htmlPath) {
  try {
    fs.mkdirSync(DONE_DIR, { recursive: true });
    const filename = path.basename(htmlPath);
    const destPath = path.join(DONE_DIR, filename);
    fs.renameSync(htmlPath, destPath);
    log.info(`HTML processado movido para: ${destPath}`);
    return destPath;
  } catch (err) {
    log.error(`Falha ao mover HTML para feitos: ${err.message}`);
    return null;
  }
}

function generateReport({ moveInput = true } = {}) {
  const results = state.get('productResults', {});
  const approved = Object.entries(results)
    .filter(([, result]) => result.status === 'approved')
    .map(([index, result]) => ({ index: parseInt(index, 10), ...result }))
    .sort((a, b) => (b.profit || 0) - (a.profit || 0));

  const stats = state.getStats();
  log.info('\n=== RELATÓRIO FINAL ===');
  log.info(`Total processados: ${stats.total}`);
  log.info(`Aprovados: ${stats.approved}`);
  log.info(`Pulados/Não aprovados: ${stats.total - stats.approved - stats.errors}`);
  log.info(`Erros: ${stats.errors}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const mainReportPath = path.join(REPORT_DIR, `fba-aprovados-${timestamp}.html`);
  generateApprovedHTML(approved, mainReportPath);
  log.info(`\nRelatório HTML: ${mainReportPath}`);

  if (approved.length > 0) {
    fs.mkdirSync(PROFIT_DIR, { recursive: true });
    const profitReportPath = path.join(PROFIT_DIR, `produtos-lucro-${timestamp}.html`);
    generateApprovedHTML(approved, profitReportPath);
    log.info(`Relatório lucrativos: ${profitReportPath}`);
  }

  if (moveInput) {
    moveProcessedHTML(HTML_PATH);
  } else {
    log.info('HTML mantido na pasta de entrada para permitir retomada/novo processamento.');
  }

  log.info(`Estado salvo em: ${state.filePath}`);
}

async function run() {
  const manual = createManualController(MANUAL_MODE);
  const audit = createAuditTrail();
  let browser = null;
  const runtime = {
    stopRequested: false,
    stopReason: null,
    blockedSupplierDomains: new Map(),
    supplierNotFoundCounts: new Map()
  };
  const browserMode = determineBrowserMode();
  const runSessionId = audit?.sessionId || `${Date.now()}-${process.pid}`;
  const handleSignal = signal => {
    runtime.stopRequested = true;
    runtime.stopReason = signal;
    log.warn(`Sinal ${signal} recebido. Encerrando de forma segura...`);
    markRuntimeState({
      runStatus: 'stopping',
      stopSignal: signal,
      stopRequestedAt: new Date().toISOString()
    });
  };

  process.on('SIGTERM', handleSignal);
  process.on('SIGINT', handleSignal);

  try {
    markRuntimeState({
      runSessionId,
      runStatus: 'starting',
      auditTrailDir: audit?.dir || null,
      auditTrailSessionId: audit?.sessionId || null,
      activeHtmlFile: HTML_PATH,
      htmlFile: HTML_PATH,
      currentStep: 'inicializando',
      currentProduct: null,
      searchAttempts: [],
      mode: DRY_RUN ? 'dry-run' : MANUAL_MODE ? 'manual' : RESUME ? 'resume' : 'auto',
      browserMode,
      browserDisplay: process.env.DISPLAY || process.env.WAYLAND_DISPLAY || null,
      chromeExecutablePath: config.chrome.executablePath || null,
      chromeProfileDir: config.chrome.userDataDir || null,
      chromeProfileName: config.chrome.profile || null,
      extensionStatus: buildExtensionRuntimeState(),
      startedAt: new Date().toISOString()
    });

    log.info('=== Agente FBA Iniciando ===');
    log.info(`HTML: ${HTML_PATH}`);
    log.info(`Modo: ${DRY_RUN ? 'DRY-RUN' : MANUAL_MODE ? 'MANUAL' : 'AUTOMÁTICO'}`);
    log.info(`Batch size: ${BATCH_SIZE}`);
    log.info(`Resume: ${RESUME}`);
    log.info(`Browser mode: ${browserMode}`);
    if (audit) {
      log.info(`Auditoria: ON | trilha em ${audit.dir}`);
    }

    recordAudit(audit, 'session:start', {
      htmlPath: HTML_PATH,
      mode: DRY_RUN ? 'dry-run' : MANUAL_MODE ? 'manual' : RESUME ? 'resume' : 'auto',
      batchSize: BATCH_SIZE
    });

    if (!HTML_PATH || !fs.existsSync(HTML_PATH)) {
      throw new Error(`Nenhum HTML válido encontrado em ${INPUT_DIR}. Coloque um arquivo .html na pasta de entrada.`);
    }

    const html = fs.readFileSync(HTML_PATH, 'utf-8');
    const parsedInput = parseProductsHTML(html);
    const { products, skipped, warnings, totalRows, metrics } = parsedInput;
    const parseAudit = analyzeParsedProducts(parsedInput);
    recordAudit(audit, 'parse:summary', {
      totalRows,
      validProducts: products.length,
      skippedRows: skipped.length,
      warningRows: warnings.length,
      metrics: parseAudit
    });

    log.info(
      `Total linhas: ${totalRows} | Produtos válidos: ${products.length} | ` +
      `Pulados: ${skipped.length} | Avisos: ${warnings.length}`
    );
    log.info(
      `Métricas parse: dedupe-url=${metrics?.deduplicatedBySupplierUrl || 0} | ` +
      `listagem-ignoradas=${metrics?.skippedListingUrls || 0} | ` +
      `urls-unicas=${metrics?.uniqueSupplierUrls || 0} | ` +
      `nomes-iguais-links-diferentes=${parseAudit.duplicateNameDifferentUrl || 0}`
    );

    const groups = groupBySupplier(products);
    for (const [domain, groupedProducts] of Object.entries(groups)) {
      log.info(`  ${domain}: ${groupedProducts.length} produtos`);
    }

    let startIndex = 0;
    if (RESUME) {
      const lastProcessed = state.getLastProcessedIndex();
      if (lastProcessed >= 0) {
        startIndex = lastProcessed + 1;
        log.info(`Retomando do produto #${startIndex} (último processado: #${lastProcessed})`);
        log.info(`Estado anterior: ${JSON.stringify(state.getStats())}`);
      }
    } else {
      state.reset();
      log.info('Estado resetado; processando do início.');
    }

    markRuntimeState({
      runSessionId,
      runStatus: 'starting',
      sessionStart: new Date().toISOString(),
      htmlFile: HTML_PATH,
      activeHtmlFile: HTML_PATH,
      totalProducts: products.length,
      mode: DRY_RUN ? 'dry-run' : MANUAL_MODE ? 'manual' : RESUME ? 'resume' : 'auto',
      inputMetrics: parseAudit,
      auditTrailDir: audit?.dir || null,
      auditTrailSessionId: audit?.sessionId || null,
      browserMode,
      browserDisplay: process.env.DISPLAY || process.env.WAYLAND_DISPLAY || null,
      chromeExecutablePath: config.chrome.executablePath || null,
      chromeProfileDir: config.chrome.userDataDir || null,
      chromeProfileName: config.chrome.profile || null,
      extensionStatus: buildExtensionRuntimeState()
    });

    if (DRY_RUN) {
      runDryRun(products, startIndex);
      markRuntimeState({ runStatus: 'completed', currentStep: 'dry-run-concluido' });
      generateReport();
      recordAudit(audit, 'session:end', { status: 'completed-dry-run' });
      return;
    }

    if (products.length === 0) {
      log.warn('Nenhum produto válido no HTML. Encerrando sem abrir browser.');
      markRuntimeState({ runStatus: 'completed', currentStep: 'sem-produtos' });
      generateReport();
      recordAudit(audit, 'session:end', { status: 'completed-empty' });
      return;
    }

    markRuntimeState({ currentStep: 'validando-vpn' });
    const vpn = await verifyVpnConnection();
    recordAudit(audit, 'vpn:validated', vpn || {});

    markRuntimeState({ currentStep: 'abrindo-browser' });
    browser = await launchBrowser();
    const page = await browser.newPage();
    await preparePage(page);
    page.setDefaultTimeout(45000);
    page.setDefaultNavigationTimeout(45000);
    markRuntimeState({
      runStatus: 'running',
      currentStep: 'browser-pronto'
    });

    let consecutiveErrors = 0;
    let currentIndex = startIndex;

    while (currentIndex < products.length) {
      const batchEnd = Math.min(currentIndex + BATCH_SIZE, products.length);
      log.info(`\n=== BATCH: produtos ${currentIndex} a ${batchEnd - 1} (${batchEnd - currentIndex} produtos) ===`);

      for (let i = currentIndex; i < batchEnd; i++) {
        const product = products[i];
        log.info(`\n--- [${i + 1}/${products.length}] ${product.name} ---`);
        log.info(`  UPC: ${product.upc} | Fornecedor: ${product.supplierDomain}`);

        try {
          const result = await processProduct(page, product, manual, audit, runtime);
          const storedResult = buildStateResult(product, result);
          state.addProductResult(product.index, storedResult);
          markRuntimeState({
            currentStep: 'produto-processado',
            currentProduct: buildCurrentProductSnapshot(product, {
              status: result.status,
              asin: result.asin || null
            }),
            searchAttempts: result.searchAttempts || [],
            lastError: null
          });
          state.setLastProcessedIndex(i);
          consecutiveErrors = 0;

          if (result.status === 'approved') {
            log.info(`  [APROVADO] margem=${result.margin}% roi=${result.roi}% lucro=$${result.profit}`);
          } else {
            const icon = result.status === 'skipped'
              ? '[PULADO]'
              : result.status === 'needs_review'
                ? '[REVISAO]'
                : '[NAO APROVADO]';
            const reasons = formatReasons(result);
            log.info(`  ${icon}${reasons ? ` ${reasons}` : ''}`);
          }

          if (!await interruptibleDelay(runtime, 3000, 7000)) break;
        } catch (err) {
          if (err instanceof ManualAbortError) {
            runtime.stopRequested = true;
            runtime.stopReason = 'manual';
            log.warn('Execução interrompida pelo operador no modo manual.');
            markRuntimeState({ runStatus: 'paused', currentStep: 'interrompido-manualmente' });
            break;
          }

          consecutiveErrors++;
          const screenshotPath = await safeCaptureScreenshot(page, `product-error-${product.index}`);
          const errorResult = buildStateResult(product, {
            status: 'error',
            step: 'unexpected',
            error: err.message,
            reasons: [err.message],
            screenshotPath
          });

          state.addProductResult(product.index, errorResult);
          recordAudit(audit, 'product:error', {
            productIndex: product.index,
            productName: product.name,
            message: err.message,
            screenshot: screenshotPath
          });
          state.setLastProcessedIndex(i);
          markRuntimeState({
            currentStep: 'erro-produto',
            currentProduct: buildCurrentProductSnapshot(product),
            searchAttempts: [],
            lastError: {
              productIndex: product.index,
              productName: product.name,
              at: new Date().toISOString(),
              message: err.message,
              screenshotPath
            }
          });
          log.error(`  ERRO processando produto [${product.index}] ${product.name}:`, err.message);

          if (consecutiveErrors >= MAX_ERRORS_CONSECUTIVOS) {
            markRuntimeState({ runStatus: 'failed', currentStep: 'falha-consecutiva' });
            log.error(`${MAX_ERRORS_CONSECUTIVOS} erros consecutivos. Pausando agente; use --resume para continuar.`);
            break;
          }

          if (!await interruptibleDelay(runtime, 10000, 20000)) break;
        }

        if (runtime.stopRequested) break;
      }

      if (runtime.stopRequested || consecutiveErrors >= MAX_ERRORS_CONSECUTIVOS) break;

      currentIndex = batchEnd;
      if (currentIndex < products.length) {
        log.info('\nIntervalo entre batches (30s)...');
        markRuntimeState({ currentStep: 'intervalo-entre-batches' });
        if (!await interruptibleDelay(runtime, 25000, 35000)) break;
      }
    }

    const finishedAllProducts = !runtime.stopRequested && consecutiveErrors < MAX_ERRORS_CONSECUTIVOS && currentIndex >= products.length;
    const finalRunStatus = runtime.stopRequested
      ? 'paused'
      : consecutiveErrors >= MAX_ERRORS_CONSECUTIVOS
        ? 'failed'
        : 'completed';
    markRuntimeState({
      runStatus: finalRunStatus,
      currentStep: finalRunStatus === 'completed' ? 'concluido' : finalRunStatus === 'paused' ? 'pausado' : 'falhou'
    });

    generateReport({ moveInput: finishedAllProducts });
    const finalStats = state.getStats();
    recordAudit(audit, 'session:end', {
      status: runtime.stopRequested
        ? 'paused'
        : consecutiveErrors >= MAX_ERRORS_CONSECUTIVOS
          ? 'failed'
          : 'completed',
      stats: finalStats,
      statePath: state.filePath
    });

    if (runtime.stopRequested) {
      log.warn('Agente FBA finalizado em modo de pausa. Use --resume para continuar.');
    } else if (consecutiveErrors >= MAX_ERRORS_CONSECUTIVOS) {
      log.error('Agente FBA finalizado com falhas consecutivas. Corrija o erro e use --resume.');
    } else {
      log.info('=== Agente FBA Finalizado ===');
    }
  } finally {
    process.off('SIGTERM', handleSignal);
    process.off('SIGINT', handleSignal);
    manual.close();
    if (audit) {
      log.info(`Auditoria finalizada: ${audit.dir}`);
      markRuntimeState({
        auditTrailDir: audit.dir,
        auditTrailSessionId: audit.sessionId
      });
    }
    markRuntimeState({
      finishedAt: new Date().toISOString(),
      currentProduct: runtime.stopRequested ? state.get('currentProduct', null) : null
    });
    await closeBrowser(browser);
  }
}

run().catch(err => {
  markRuntimeState({
    runStatus: 'failed',
    currentStep: 'erro-fatal',
    lastError: {
      at: new Date().toISOString(),
      message: err.message
    }
  });
  log.error('Erro fatal no agente FBA:', err);
  process.exit(1);
});
