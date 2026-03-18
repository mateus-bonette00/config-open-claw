import fs from 'fs';
import path from 'path';
import readline from 'node:readline/promises';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('fba-agent');
const state = new StateManager('fba');

const PROJECT_DIR = path.join(__dirname, '..', '..');
const INPUT_DIR = process.env.FBA_INPUT_DIR || path.join(PROJECT_DIR, 'amazon-fba', 'produtos-fornecedores-html');
const OUTPUT_DIR = process.env.FBA_OUTPUT_DIR || path.join(PROJECT_DIR, 'amazon-fba', 'produtos-encontrados');
const HTML_PATH = process.env.FBA_HTML_PATH || path.join(INPUT_DIR, 'Produtos_Mateus_22_02_2026_141622.html');
const RESUME = process.argv.includes('--resume');
const DRY_RUN = process.argv.includes('--dry-run');
const MANUAL_MODE = process.argv.includes('--manual');
const MAX_ERRORS_CONSECUTIVOS = 5;
const BATCH_SIZE = parseInt(process.env.FBA_BATCH_SIZE || '200', 10);
const REPORT_DIR = OUTPUT_DIR;
const AUDIT_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.FBA_AUDIT || '').toLowerCase());
const AUDIT_SCREENSHOTS = ['1', 'true', 'yes', 'on'].includes(String(process.env.FBA_AUDIT_SCREENSHOTS || '').toLowerCase());
const AUDIT_BASE_DIR = path.join(PROJECT_DIR, 'storage', 'audit', 'fba');

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

async function processProduct(page, product, manual, audit) {
  recordAudit(audit, 'product:start', {
    productIndex: product.index,
    productName: product.name,
    upc: product.upc,
    supplierUrl: product.supplierUrl,
    supplierDomain: product.supplierDomain
  });

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
  log.info(`Pulados/Não aprovados: ${stats.total - stats.approved - stats.errors}`);
  log.info(`Erros: ${stats.errors}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(REPORT_DIR, `fba-aprovados-${timestamp}.html`);
  generateApprovedHTML(approved, reportPath);

  log.info(`\nRelatório HTML: ${reportPath}`);
  log.info(`Estado salvo em: ${state.filePath}`);
}

async function run() {
  const manual = createManualController(MANUAL_MODE);
  const audit = createAuditTrail();
  let browser = null;
  let stopRequested = false;

  try {
    log.info('=== Agente FBA Iniciando ===');
    log.info(`HTML: ${HTML_PATH}`);
    log.info(`Modo: ${DRY_RUN ? 'DRY-RUN' : MANUAL_MODE ? 'MANUAL' : 'AUTOMÁTICO'}`);
    log.info(`Batch size: ${BATCH_SIZE}`);
    log.info(`Resume: ${RESUME}`);
    if (audit) {
      log.info(`Auditoria: ON | trilha em ${audit.dir}`);
    }

    recordAudit(audit, 'session:start', {
      htmlPath: HTML_PATH,
      mode: DRY_RUN ? 'dry-run' : MANUAL_MODE ? 'manual' : RESUME ? 'resume' : 'auto',
      batchSize: BATCH_SIZE
    });

    if (!fs.existsSync(HTML_PATH)) {
      throw new Error(`Arquivo HTML não encontrado: ${HTML_PATH}`);
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

    state.set('sessionStart', new Date().toISOString());
    state.set('htmlFile', HTML_PATH);
    state.set('totalProducts', products.length);
    state.set('mode', DRY_RUN ? 'dry-run' : MANUAL_MODE ? 'manual' : 'auto');
    state.set('inputMetrics', parseAudit);

    if (DRY_RUN) {
      runDryRun(products, startIndex);
      generateReport();
      recordAudit(audit, 'session:end', { status: 'completed-dry-run' });
      return;
    }

    const vpn = await verifyVpnConnection();
    recordAudit(audit, 'vpn:validated', vpn || {});

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

        try {
          const result = await processProduct(page, product, manual, audit);
          const storedResult = buildStateResult(product, result);
          state.addProductResult(product.index, storedResult);
          state.setLastProcessedIndex(i);
          state.set('lastError', null);
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

          state.addProductResult(product.index, errorResult);
          recordAudit(audit, 'product:error', {
            productIndex: product.index,
            productName: product.name,
            message: err.message,
            screenshotPath
          });
          state.setLastProcessedIndex(i);
          state.set('lastError', {
            productIndex: product.index,
            productName: product.name,
            at: new Date().toISOString(),
            message: err.message,
            screenshotPath
          });

          log.error(`  ERRO processando produto [${product.index}] ${product.name}:`, err.message);

          if (consecutiveErrors >= MAX_ERRORS_CONSECUTIVOS) {
            log.error(`${MAX_ERRORS_CONSECUTIVOS} erros consecutivos. Pausando agente; use --resume para continuar.`);
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

    generateReport();
    const finalStats = state.getStats();
    recordAudit(audit, 'session:end', {
      status: stopRequested ? 'interrupted-manual' : 'completed',
      stats: finalStats,
      statePath: state.filePath
    });

    if (stopRequested) {
      log.warn('Agente FBA finalizado com interrupção manual. Use --resume para continuar.');
    } else {
      log.info('=== Agente FBA Finalizado ===');
    }
  } finally {
    manual.close();
    if (audit) {
      log.info(`Auditoria finalizada: ${audit.dir}`);
      state.set('auditTrailDir', audit.dir);
      state.set('auditTrailSessionId', audit.sessionId);
    }
    await closeBrowser(browser);
  }
}

run().catch(err => {
  log.error('Erro fatal no agente FBA:', err);
  process.exit(1);
});
