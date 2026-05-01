import fs from 'fs';
import path from 'path';
import readline from 'node:readline/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createLogger, StateManager } from '../../core/index.js';
import { parseProductsHTML, groupBySupplier, analyzeParsedProducts } from './parser.js';
import {
  launchBrowser,
  closeBrowser,
  searchAmazon,
  extractAmazonSearchResults,
  goToProductPage,
  waitForMarketplaceExtensions,
  openSupplierPage,
  extractSupplierData,
  inspectPageAccess,
  extractKeepaData,
  extractAZInsightData,
  inputBuyCostInAZInsight,
  checkAmazonSells,
  humanDelay,
  saveScreenshot,
  verifyVpnConnection
} from './browser.js';
import { evaluateProduct, calculateBuyCost } from './rules.js';
import { generateApprovedHTML } from './report.js';
import { createFbaStatusWriter, createSessionId } from './status.js';
import { syncApprovedProductsToSheets } from './sheets-sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('fba-agent');
const state = new StateManager('fba');

const PROJECT_DIR = path.join(__dirname, '..', '..');
const INPUT_DIR = process.env.FBA_INPUT_DIR || path.join(PROJECT_DIR, 'amazon-fba', 'produtos-fornecedores-html');
const OUTPUT_DIR = process.env.FBA_OUTPUT_DIR || path.join(PROJECT_DIR, 'amazon-fba', 'produtos-encontrados');
const DEFAULT_HTML_PATH = path.join(INPUT_DIR, 'Produtos_Mateus_22_02_2026_141622.html');
const RESUME = process.argv.includes('--resume');
const DRY_RUN = process.argv.includes('--dry-run');
const MANUAL_MODE = process.argv.includes('--manual');
const RUN_MODE = DRY_RUN ? 'dry-run' : MANUAL_MODE ? 'manual' : RESUME ? 'resume' : 'auto';
const MAX_ERRORS_CONSECUTIVOS = 5;
const BATCH_SIZE = parseInt(process.env.FBA_BATCH_SIZE || '200', 10);
const REPORT_DIR = OUTPUT_DIR;
const AUDIT_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.FBA_AUDIT || '').toLowerCase());
const AUDIT_SCREENSHOTS = ['1', 'true', 'yes', 'on'].includes(String(process.env.FBA_AUDIT_SCREENSHOTS || '').toLowerCase());
const AUDIT_BASE_DIR = path.join(PROJECT_DIR, 'storage', 'audit', 'fba');
const SESSION_START = new Date().toISOString();
const SESSION_ID = createSessionId(new Date(SESSION_START));

function resolveHtmlPathForRun() {
  const configuredHtmlPath = process.env.FBA_HTML_PATH;
  if (configuredHtmlPath) return configuredHtmlPath;

  const previousHtmlPath = state.get('htmlFile');
  if (RESUME && previousHtmlPath && fs.existsSync(previousHtmlPath)) {
    return previousHtmlPath;
  }

  return DEFAULT_HTML_PATH;
}

const HTML_PATH = resolveHtmlPathForRun();
let dashboardStatus = null;

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

function updateDashboardStatus(patch = {}) {
  if (!dashboardStatus) return null;

  try {
    return dashboardStatus.updateFromState(state, patch);
  } catch (err) {
    log.warn(`Nao foi possivel atualizar status do painel: ${err.message}`);
    return null;
  }
}

function buildInputSignature(products) {
  const signatureBase = products
    .map(product => `${product.index}|${product.upc || ''}|${product.supplierUrl || ''}`)
    .join('\n');
  return crypto.createHash('sha256').update(signatureBase).digest('hex');
}

function validateResumeInput(products, inputSignature) {
  if (!RESUME) return;

  const previousTotal = state.get('totalProducts');
  const previousSignature = state.get('inputSignature');
  const previousHtmlFile = state.get('htmlFile');

  if (previousTotal !== undefined && previousTotal !== products.length) {
    throw new Error(
      `Resume bloqueado: o estado anterior tem ${previousTotal} produtos, mas o HTML atual tem ${products.length}. ` +
      'Use o mesmo HTML da execucao anterior ou rode sem --resume para recomecar.'
    );
  }

  if (previousSignature && previousSignature !== inputSignature) {
    throw new Error(
      'Resume bloqueado: o HTML atual nao bate com o estado salvo. ' +
      'Use o HTML original da execucao anterior ou rode sem --resume para recomecar.'
    );
  }

  if (previousHtmlFile && path.resolve(previousHtmlFile) !== path.resolve(HTML_PATH)) {
    log.warn(`Resume usando HTML diferente do salvo no estado: salvo=${previousHtmlFile} atual=${HTML_PATH}`);
  }
}

function getResumeStartIndex(products) {
  const lastProcessed = state.getLastProcessedIndex();
  const results = state.get('productResults', {});
  let consecutiveProcessed = -1;

  for (let i = 0; i < products.length; i++) {
    if (!results[String(products[i].index)]) break;
    consecutiveProcessed = i;
  }

  const startIndex = Math.max(lastProcessed, consecutiveProcessed) + 1;
  return Math.min(Math.max(startIndex, 0), products.length);
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

function createAuditTrail() {
  if (!AUDIT_ENABLED) return null;

  const sessionId = SESSION_ID;
  const dir = path.join(AUDIT_BASE_DIR, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, 'events.ndjson');
  const metaPath = path.join(dir, 'meta.json');

  const meta = {
    sessionId,
    startedAt: new Date().toISOString(),
    htmlPath: HTML_PATH,
    mode: RUN_MODE,
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

async function resolveCurrentAccessIssue({ page, manual, label, issue, retry }) {
  if (!issue) {
    return { status: 'ok', result: await retry() };
  }

  if (!manual.enabled || issue.type === 'navigation') {
    return { status: 'error', issue };
  }

  const decision = await manual.resolveChallenge(label, issue);
  if (decision === 'skip') {
    return { status: 'skip', issue };
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

async function ensureSupplierData(page, product, manual, audit) {
  recordAudit(audit, 'supplier:start', {
    productIndex: product.index,
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

  let supplierResult = await openSupplierPage(page, product.supplierUrl);
  if (supplierResult.error) {
    recordAudit(audit, 'supplier:error', {
      productIndex: product.index,
      reason: supplierResult.accessIssue?.reason || supplierResult.error
    });

    const resolved = await resolveCurrentAccessIssue({
      page,
      manual,
      label: `Fornecedor ${product.supplierDomain}`,
      issue: supplierResult.accessIssue,
      retry: async () => extractCurrentSupplierState(page)
    });

    if (resolved.status === 'skip') {
      return {
        status: 'skipped',
        step: 'supplier',
        reasons: ['Produto pulado manualmente após bloqueio no fornecedor'],
        accessIssue: resolved.issue
      };
    }

    if (resolved.status === 'error') {
      return {
        status: 'error',
        step: 'supplier',
        error: resolved.issue.reason,
        reasons: [resolved.issue.reason],
        accessIssue: resolved.issue
      };
    }

    supplierResult = resolved.result;
  }

  let supplierData = supplierResult.supplier || {};
  let supplierScreenshot = null;
  if (AUDIT_SCREENSHOTS) {
    supplierScreenshot = await safeCaptureScreenshot(page, `audit-supplier-${product.index}`);
  }

  recordAudit(audit, 'supplier:data', {
    productIndex: product.index,
    pageUrl: page.url(),
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

async function searchAmazonForProduct(page, product, manual, audit) {
  const queries = [];
  if (product.hasValidUPC) {
    queries.push({ term: product.upc, type: 'upc', label: `Buscar Amazon por UPC ${product.upc}` });
  }
  queries.push({ term: product.name, type: 'title', label: `Buscar Amazon por título` });

  for (const query of queries) {
    recordAudit(audit, 'amazon-search:start', {
      productIndex: product.index,
      type: query.type,
      term: query.term
    });

    const decision = await manual.confirm(query.label);
    if (decision === 'skip') {
      return {
        status: 'skipped',
        step: `amazon-${query.type}`,
        reasons: [`Produto pulado manualmente antes da busca Amazon por ${query.type}`]
      };
    }

    let searchResult = await searchAmazon(page, query.term, query.type);
    if (searchResult.error) {
      recordAudit(audit, 'amazon-search:error', {
        productIndex: product.index,
        type: query.type,
        reason: searchResult.accessIssue?.reason || searchResult.error
      });

      const resolved = await resolveCurrentAccessIssue({
        page,
        manual,
        label: `Amazon (${query.type})`,
        issue: searchResult.accessIssue,
        retry: async () => extractCurrentAmazonSearchState(page, query.type)
      });

      if (resolved.status === 'skip') {
        return {
          status: 'skipped',
          step: `amazon-${query.type}`,
          reasons: [`Produto pulado manualmente após bloqueio na busca Amazon por ${query.type}`],
          accessIssue: resolved.issue
        };
      }

      if (resolved.status === 'error') {
        return {
          status: 'error',
          step: `amazon-${query.type}`,
          error: resolved.issue.reason,
          reasons: [resolved.issue.reason],
          accessIssue: resolved.issue
        };
      }

      searchResult = resolved.result;
    }

    let searchScreenshot = null;
    if (AUDIT_SCREENSHOTS) {
      searchScreenshot = await safeCaptureScreenshot(page, `audit-amazon-search-${query.type}-${product.index}`);
    }

    const top = (searchResult.results || []).slice(0, 3).map(r => ({
      asin: r.asin,
      title: r.title,
      price: r.price ?? null,
      url: r.url
    }));
    recordAudit(audit, 'amazon-search:result', {
      productIndex: product.index,
      type: query.type,
      term: query.term,
      resultCount: searchResult.results?.length || 0,
      top,
      screenshot: searchScreenshot
    });

    if (searchResult.results?.length) {
      return { status: 'ok', searchResult };
    }

    await humanDelay(1500, 3000);
  }

  return {
    status: 'skipped',
    step: 'amazon-search',
    reasons: ['Sem resultados na Amazon por UPC nem por título']
  };
}

async function openAmazonResultPage(page, product, bestMatch, manual, audit) {
  recordAudit(audit, 'amazon-product:start', {
    productIndex: product.index,
    asin: bestMatch.asin,
    url: bestMatch.url
  });

  const decision = await manual.confirm(`Abrir produto Amazon ${bestMatch.asin}`);
  if (decision === 'skip') {
    return {
      status: 'skipped',
      step: 'amazon-product',
      reasons: ['Produto pulado manualmente antes de abrir a página da Amazon']
    };
  }

  let pageResult = await goToProductPage(page, bestMatch.url);
  if (pageResult.error) {
    recordAudit(audit, 'amazon-product:error', {
      productIndex: product.index,
      asin: bestMatch.asin,
      reason: pageResult.accessIssue?.reason || pageResult.error
    });

    const resolved = await resolveCurrentAccessIssue({
      page,
      manual,
      label: `Página Amazon ${bestMatch.asin}`,
      issue: pageResult.accessIssue,
      retry: async () => {
        const accessIssue = await inspectPageAccess(page, 'amazon-product');
        if (accessIssue) {
          return { error: accessIssue.type, accessIssue };
        }

        await waitForMarketplaceExtensions(page);
        return { error: null, accessIssue: null };
      }
    });

    if (resolved.status === 'skip') {
      return {
        status: 'skipped',
        step: 'amazon-product',
        reasons: ['Produto pulado manualmente após bloqueio na página da Amazon'],
        accessIssue: resolved.issue
      };
    }

    if (resolved.status === 'error') {
      return {
        status: 'error',
        step: 'amazon-product',
        error: resolved.issue.reason,
        reasons: [resolved.issue.reason],
        accessIssue: resolved.issue
      };
    }

    pageResult = resolved.result;
  }

  await humanDelay(3000, 5000);
  let productScreenshot = null;
  if (AUDIT_SCREENSHOTS) {
    productScreenshot = await safeCaptureScreenshot(page, `audit-amazon-product-${product.index}`);
  }

  recordAudit(audit, 'amazon-product:opened', {
    productIndex: product.index,
    asin: bestMatch.asin,
    finalUrl: page.url(),
    screenshot: productScreenshot
  });

  return { status: 'ok', pageResult };
}

async function processProduct(page, product, manual, audit, updateStep = () => {}) {
  recordAudit(audit, 'product:start', {
    productIndex: product.index,
    productName: product.name,
    upc: product.upc,
    supplierUrl: product.supplierUrl,
    supplierDomain: product.supplierDomain
  });

  updateStep('supplier', product);
  const supplierOutcome = await ensureSupplierData(page, product, manual, audit);
  if (supplierOutcome.status !== 'ok') {
    recordAudit(audit, 'product:end', {
      productIndex: product.index,
      status: supplierOutcome.status,
      step: supplierOutcome.step || null,
      reasons: supplierOutcome.reasons || []
    });
    return supplierOutcome;
  }

  const supplierData = supplierOutcome.supplierData;
  const supplierPrice = normalizeFiniteNumber(supplierData.price);
  const supplierPriceStatus = supplierData.priceStatus || (supplierPrice !== null ? 'ok' : 'missing');

  updateStep('amazon-search', product);
  const amazonSearchOutcome = await searchAmazonForProduct(page, product, manual, audit);
  if (amazonSearchOutcome.status !== 'ok') {
    recordAudit(audit, 'product:end', {
      productIndex: product.index,
      status: amazonSearchOutcome.status,
      step: amazonSearchOutcome.step || null,
      reasons: amazonSearchOutcome.reasons || []
    });
    return {
      ...amazonSearchOutcome,
      supplierTitle: supplierData.title || null,
      supplierPrice,
      supplierPriceSource: supplierData.priceSource || null,
      supplierPriceStatus
    };
  }

  const amazonResult = amazonSearchOutcome.searchResult;
  const bestMatch = amazonResult.results[0];
  const bestMatchPrice = normalizeFiniteNumber(bestMatch.price);
  log.info(
    `  Match Amazon: ${bestMatch.title} (ASIN: ${bestMatch.asin}) - ` +
    `${bestMatchPrice !== null ? `$${bestMatchPrice.toFixed(2)}` : 'preço-não-detectado'}`
  );

  updateStep('amazon-product', product);
  const amazonPageOutcome = await openAmazonResultPage(page, product, bestMatch, manual, audit);
  if (amazonPageOutcome.status !== 'ok') {
    recordAudit(audit, 'product:end', {
      productIndex: product.index,
      status: amazonPageOutcome.status,
      step: amazonPageOutcome.step || null,
      asin: bestMatch.asin,
      reasons: amazonPageOutcome.reasons || []
    });
    return {
      ...amazonPageOutcome,
      asin: bestMatch.asin,
      amazonTitle: bestMatch.title,
      amazonUrl: bestMatch.url,
      supplierTitle: supplierData.title || null,
      supplierPrice,
      supplierPriceSource: supplierData.priceSource || null,
      supplierPriceStatus
    };
  }

  updateStep('keepa', product);
  const keepaData = await extractKeepaData(page);
  const amazonSells = await checkAmazonSells(page);
  recordAudit(audit, 'marketplace:data', {
    productIndex: product.index,
    asin: bestMatch.asin,
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
      await humanDelay(1000, 2000);
    }
  }

  updateStep('azinsight', product);
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
    asin: bestMatch.asin,
    available: azInsightData.available || false,
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

  recordAudit(audit, 'product:end', {
    productIndex: product.index,
    status: evaluation.status,
    step: 'completed',
    asin: bestMatch.asin,
    reasons: evaluation.reasons || [],
    profit: evaluation.profit ?? null,
    margin: evaluation.margin ?? null,
    roi: evaluation.roi ?? null
  });

  return {
    ...evaluation,
    step: 'completed',
    asin: bestMatch.asin,
    amazonTitle: bestMatch.title,
    amazonUrl: bestMatch.url,
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
    azInsightAvailable: azInsightData.available || false
  };
}

function runDryRun(products, startIndex) {
  for (let i = startIndex; i < products.length; i++) {
    const product = products[i];
    state.recordProductResult(product.index, {
      status: 'needs_review',
      name: product.name,
      upc: product.upc,
      supplierDomain: product.supplierDomain,
      supplierUrl: product.supplierUrl,
      hasValidUPC: product.hasValidUPC
    }, i);
    updateDashboardStatus({
      status: 'running',
      currentStep: 'parse-input',
      lastProcessedIndex: i
    });
  }

  log.info(`\nDry-run concluído: ${products.length - startIndex} produtos para revisão`);
}

function generateReport() {
  const results = state.get('productResults', {});
  const approved = Object.entries(results)
    .filter(([, result]) => result.status === 'approved')
    .map(([index, result]) => ({ index: parseInt(index, 10), ...result }))
    .sort((a, b) => (b.profit || 0) - (a.profit || 0));

  const stats = state.getStats();
  log.info('\n=== RELATÓRIO FINAL ===');
  log.info(`Total processados: ${stats.total}`);
  log.info(`Aprovados: ${stats.approved}`);
  log.info(`Rejeitados: ${stats.rejected}`);
  log.info(`Precisam revisão: ${stats.needsReview}`);
  log.info(`Pulados: ${stats.skipped}`);
  log.info(`Erros: ${stats.errors}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(REPORT_DIR, `fba-aprovados-${timestamp}.html`);
  generateApprovedHTML(approved, reportPath);
  state.setMany({
    reportPath,
    reportGeneratedAt: new Date().toISOString()
  });

  log.info(`\nRelatório HTML: ${reportPath}`);
  log.info(`Estado salvo em: ${state.filePath}`);

  return { reportPath, approved, stats };
}

async function finalizeSession({ products, audit, finalStatus = 'completed', auditStatus = 'completed' }) {
  updateDashboardStatus({ status: 'running', currentStep: 'report' });
  const reportResult = generateReport();
  updateDashboardStatus({
    status: 'running',
    currentStep: 'sheets-sync',
    reportPath: reportResult.reportPath
  });
  const sheetResult = await syncApprovedProductsToSheets({
    state,
    approvedProducts: reportResult.approved,
    updateStatus: patch => updateDashboardStatus({
      status: 'running',
      currentStep: 'sheets-sync',
      ...patch
    })
  });

  const finalStats = state.getStats();
  recordAudit(audit, 'session:end', {
    status: auditStatus,
    stats: finalStats,
    sheets: sheetResult,
    statePath: state.filePath
  });
  updateDashboardStatus({
    status: finalStatus,
    currentStep: 'sheets-sync',
    reportPath: reportResult.reportPath
  });

  log.info(
    `Resumo final: processados=${finalStats.total}/${products.length} | ` +
    `aprovados=${finalStats.approved} | rejeitados=${finalStats.rejected} | ` +
    `revisao=${finalStats.needsReview} | pulados=${finalStats.skipped} | erros=${finalStats.errors}`
  );
  log.info(`Sheets: status=${sheetResult.status} | linhas=${sheetResult.rowsWritten}`);
  log.info(`Status do painel: ${dashboardStatus.filePath}`);

  return { reportResult, sheetResult, finalStats };
}

async function run() {
  let manual = null;
  const audit = createAuditTrail();
  let browser = null;
  let stopRequested = false;
  let pausedByErrors = false;

  dashboardStatus = createFbaStatusWriter({
    sessionId: SESSION_ID,
    sessionStart: SESSION_START,
    mode: RUN_MODE,
    inputHtmlPath: HTML_PATH
  });
  updateDashboardStatus({
    status: 'running',
    currentStep: 'parse-input',
    mode: RUN_MODE,
    inputHtmlPath: HTML_PATH
  });

  try {
    manual = createManualController(MANUAL_MODE);
    log.info('=== Agente FBA Iniciando ===');
    log.info('Agente visivel: LUCAS1 | id tecnico: fba-amazon');
    log.info(`Sessao: ${SESSION_ID}`);
    log.info(`HTML: ${HTML_PATH}`);
    log.info(`Modo: ${RUN_MODE}`);
    log.info(`Batch size: ${BATCH_SIZE}`);
    log.info(`Resume: ${RESUME}`);
    if (audit) {
      log.info(`Auditoria: ON | trilha em ${audit.dir}`);
    }

    recordAudit(audit, 'session:start', {
      htmlPath: HTML_PATH,
      mode: RUN_MODE,
      batchSize: BATCH_SIZE
    });

    if (!fs.existsSync(HTML_PATH)) {
      throw new Error(`Arquivo HTML não encontrado: ${HTML_PATH}`);
    }

    const html = fs.readFileSync(HTML_PATH, 'utf-8');
    const parsedInput = parseProductsHTML(html);
    const { products, skipped, warnings, totalRows, metrics } = parsedInput;
    const parseAudit = analyzeParsedProducts(parsedInput);
    const inputSignature = buildInputSignature(products);
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

    validateResumeInput(products, inputSignature);

    let startIndex = 0;
    if (RESUME) {
      startIndex = getResumeStartIndex(products);
      if (startIndex >= products.length) {
        log.info(`Resume: todos os ${products.length} produtos ja tinham progresso salvo.`);
      } else {
        log.info(`Retomando do produto #${startIndex + 1} de ${products.length}`);
      }
      log.info(`Estado anterior: ${JSON.stringify(state.getStats())}`);
    } else {
      state.reset();
      log.info('Estado resetado; processando do início.');
    }

    state.setMany({
      agentTechnicalId: 'fba-amazon',
      agentDisplayName: 'LUCAS1',
      sessionId: SESSION_ID,
      sessionStart: SESSION_START,
      htmlFile: HTML_PATH,
      totalProducts: products.length,
      mode: RUN_MODE,
      inputMetrics: parseAudit,
      inputSignature,
      sheetSyncStatus: 'not-started',
      sheetRowsWritten: 0
    });
    updateDashboardStatus({
      status: 'running',
      currentStep: 'parse-input',
      totalProducts: products.length
    });

    if (DRY_RUN) {
      runDryRun(products, startIndex);
      await finalizeSession({
        products,
        audit,
        finalStatus: 'completed',
        auditStatus: 'completed-dry-run'
      });
      return;
    }

    if (startIndex >= products.length) {
      log.info('Nada novo para processar no resume; gerando relatorio/status com o estado atual.');
      await finalizeSession({
        products,
        audit,
        finalStatus: 'completed',
        auditStatus: 'completed-resume-noop'
      });
      return;
    }

    updateDashboardStatus({ status: 'running', currentStep: 'verify-vpn' });
    const vpn = await verifyVpnConnection();
    recordAudit(audit, 'vpn:validated', vpn || {});

    updateDashboardStatus({ status: 'running', currentStep: 'launch-browser' });
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    page.setDefaultNavigationTimeout(45000);

    let consecutiveErrors = 0;
    let currentIndex = startIndex;

    while (currentIndex < products.length) {
      const batchEnd = Math.min(currentIndex + BATCH_SIZE, products.length);
      log.info(`\n=== BATCH: produtos ${currentIndex} a ${batchEnd - 1} (${batchEnd - currentIndex} produtos) ===`);

      for (let i = currentIndex; i < batchEnd; i++) {
        const product = products[i];
        log.info(`\n--- [${i + 1}/${products.length}] ${product.name} ---`);
        log.info(`  UPC: ${product.upc} | Fornecedor: ${product.supplierDomain}`);
        let currentProductStep = 'supplier';

        try {
          const existingResults = state.get('productResults', {});
          if (RESUME && existingResults[String(product.index)]) {
            log.info(`  [RESUME] Produto ja tinha resultado salvo; seguindo para o proximo.`);
            state.setLastProcessedIndex(i);
            updateDashboardStatus({
              status: 'running',
              currentStep: 'parse-input',
              lastProcessedIndex: i
            });
            continue;
          }

          const updateProductStep = step => {
            currentProductStep = step;
            updateDashboardStatus({
              status: 'running',
              currentStep: step,
              lastProcessedIndex: state.getLastProcessedIndex()
            });
          };

          const result = await processProduct(page, product, manual, audit, updateProductStep);
          const storedResult = buildStateResult(product, result);
          state.recordProductResult(product.index, storedResult, i);
          state.set('lastError', null);
          consecutiveErrors = 0;
          updateDashboardStatus({
            status: 'running',
            lastProcessedIndex: i
          });

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

          await humanDelay(3000, 7000);
        } catch (err) {
          if (err instanceof ManualAbortError) {
            stopRequested = true;
            log.warn('Execução interrompida pelo operador no modo manual.');
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

          recordAudit(audit, 'product:error', {
            productIndex: product.index,
            productName: product.name,
            message: err.message,
            screenshotPath
          });
          const lastError = {
            productIndex: product.index,
            productName: product.name,
            at: new Date().toISOString(),
            message: err.message,
            screenshotPath
          };
          state.recordProductResult(product.index, errorResult, i);
          state.set('lastError', lastError);
          updateDashboardStatus({
            status: 'running',
            currentStep: currentProductStep || 'supplier',
            lastProcessedIndex: i,
            lastError
          });

          log.error(`  ERRO processando produto [${product.index}] ${product.name}:`, err.message);

          if (consecutiveErrors >= MAX_ERRORS_CONSECUTIVOS) {
            log.error(`${MAX_ERRORS_CONSECUTIVOS} erros consecutivos. Pausando agente; use --resume para continuar.`);
            pausedByErrors = true;
            break;
          }

          await humanDelay(10000, 20000);
        }
      }

      if (stopRequested || consecutiveErrors >= MAX_ERRORS_CONSECUTIVOS) break;

      currentIndex = batchEnd;
      if (currentIndex < products.length) {
        log.info('\nIntervalo entre batches (30s)...');
        await humanDelay(25000, 35000);
      }
    }

    const finalStatus = stopRequested ? 'interrupted' : pausedByErrors ? 'stopped' : 'completed';
    await finalizeSession({
      products,
      audit,
      finalStatus,
      auditStatus: stopRequested ? 'interrupted-manual' : pausedByErrors ? 'stopped-errors' : 'completed'
    });

    if (stopRequested) {
      log.warn('Agente FBA finalizado com interrupção manual. Use --resume para continuar.');
    } else if (pausedByErrors) {
      log.warn('Agente FBA pausado por erros consecutivos. Use --resume para continuar.');
    } else {
      log.info('=== Agente FBA Finalizado ===');
    }
  } catch (err) {
    const errorPayload = {
      step: dashboardStatus?.getSnapshot()?.currentStep || 'parse-input',
      at: new Date().toISOString(),
      message: err.message
    };
    state.set('lastError', errorPayload);
    updateDashboardStatus({
      status: 'error',
      lastError: errorPayload
    });
    recordAudit(audit, 'session:error', errorPayload);
    throw err;
  } finally {
    manual?.close();
    if (audit) {
      log.info(`Auditoria finalizada: ${audit.dir}`);
      state.setMany({
        auditTrailDir: audit.dir,
        auditTrailSessionId: audit.sessionId
      });
    }
    await closeBrowser(browser);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    const payload = {
      step: dashboardStatus?.getSnapshot()?.currentStep || 'parse-input',
      at: new Date().toISOString(),
      message: `Processo interrompido por ${signal}`
    };
    try {
      state.set('lastError', payload);
      updateDashboardStatus({
        status: 'interrupted',
        lastError: payload
      });
    } catch {
      // processo esta encerrando
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

run().catch(err => {
  log.error('Erro fatal no agente FBA:', err);
  process.exit(1);
});
