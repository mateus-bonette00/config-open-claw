import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { createLogger } from '../../core/logger.js';

const log = createLogger('fba-parser');

/**
 * Padrões de títulos que indicam páginas de coleção, não produtos reais.
 * Esses devem ser ignorados.
 */
const SKIP_PATTERNS = [
  /^all products/i,
  /^page \d+/i,
  /^all products\s*[–-]\s*page/i,
  /^sem t[ií]tulo$/i,
  /^your connection needs to be verified/i,
  /^\s*$/
];

const TRACKING_QUERY_PATTERNS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^msclkid$/i,
  /^mc_eid$/i,
  /^mc_cid$/i,
  /^srsltid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^_pos$/i,
  /^_sid$/i,
  /^_ss$/i,
  /^_fid$/i,
  /^searchid$/i,
  /^search_query$/i,
  /^trk$/i,
  /^spm$/i
];

const SKIP_LISTING_URLS = !['0', 'false', 'no', 'off'].includes(
  String(process.env.FBA_SKIP_LISTING_URLS || 'true').toLowerCase()
);

const DEDUPE_BY_SUPPLIER_URL = !['0', 'false', 'no', 'off'].includes(
  String(process.env.FBA_DEDUPE_BY_SUPPLIER_URL || 'true').toLowerCase()
);

/**
 * Valida se um UPC é válido (12 ou 13 dígitos numéricos).
 */
function isValidUPC(upc) {
  if (!upc) return false;
  const cleaned = upc.trim().replace(/\D/g, '');
  return cleaned.length === 12 || cleaned.length === 13;
}

/**
 * Extrai a URL real de dentro do link <a href="...">
 */
function extractHref($td) {
  const link = $td.find('a');
  return link.length ? link.attr('href') : '';
}

/**
 * Extrai o parâmetro de busca da URL da Amazon (valor de ?k=)
 */
function extractAmazonSearchTerm(amazonUrl) {
  try {
    const url = new URL(amazonUrl);
    return url.searchParams.get('k') || '';
  } catch {
    return '';
  }
}

function removeTrackingParams(urlObj) {
  const removed = [];

  for (const key of [...urlObj.searchParams.keys()]) {
    if (TRACKING_QUERY_PATTERNS.some(pattern => pattern.test(key))) {
      removed.push(key);
      urlObj.searchParams.delete(key);
      continue;
    }

    const values = urlObj.searchParams.getAll(key);
    const hasOnlyEmptyValues = values.every(value => !String(value || '').trim());
    if (hasOnlyEmptyValues) {
      removed.push(key);
      urlObj.searchParams.delete(key);
    }
  }

  return removed;
}

function classifySupplierUrl(urlObj) {
  const pathname = urlObj.pathname.toLowerCase();
  const queryKeys = [...urlObj.searchParams.keys()].map(key => key.toLowerCase());

  const hasProductHint = (
    /\/products\//.test(pathname) ||
    /\/product\//.test(pathname) ||
    /\/catalog\/product\/view\//.test(pathname) ||
    /\/dp\//.test(pathname)
  );

  const hasListingHint = (
    /\/collections(\/|$)/.test(pathname) ||
    /\/search(\/|$|\.)/.test(pathname) ||
    /\/catalogsearch(\/|$)/.test(pathname) ||
    /\/category(\/|$)/.test(pathname) ||
    /\/categories(\/|$)/.test(pathname) ||
    /\/shop(\/|$)/.test(pathname) ||
    /\/all-products(\/|$)/.test(pathname) ||
    queryKeys.some(key => ['q', 'query', 'search', 'search_query', 'keyword', 'page', 'p'].includes(key))
  );

  if (hasProductHint) return 'product';
  if (hasListingHint) return 'listing';
  return 'unknown';
}

function normalizeSupplierUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    // Shopify: /collections/<x>/products/<slug> -> /products/<slug>
    parsed.pathname = parsed.pathname.replace(
      /^\/collections\/[^/]+\/products\/([^/?#]+)\/?$/i,
      '/products/$1'
    );

    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    const removedParams = removeTrackingParams(parsed);
    const urlKind = classifySupplierUrl(parsed);

    return {
      isValid: true,
      original: rawUrl,
      canonical: parsed.toString(),
      domain: parsed.hostname,
      urlKind,
      removedParams
    };
  } catch {
    return {
      isValid: false,
      original: rawUrl,
      canonical: '',
      domain: '',
      urlKind: 'invalid',
      removedParams: []
    };
  }
}

/**
 * Parseia o HTML de produtos exportados e retorna array de produtos limpos.
 */
export function parseProductsHTML(htmlContent) {
  const $ = cheerio.load(htmlContent);
  const rows = $('table tbody tr');
  const products = [];
  const skipped = [];
  const warnings = [];
  const byCanonicalSupplierUrl = new Map();
  const skipCounts = {};
  const warningCounts = {};

  const addSkip = payload => {
    skipped.push(payload);
    skipCounts[payload.reason] = (skipCounts[payload.reason] || 0) + 1;
  };

  const addWarning = payload => {
    warnings.push(payload);
    warningCounts[payload.reason] = (warningCounts[payload.reason] || 0) + 1;
  };

  log.info(`Encontradas ${rows.length} linhas na tabela HTML.`);

  rows.each((i, row) => {
    const cells = $(row).find('td');
    const fallbackIndex = i + 1;

    if (cells.length < 6) {
      addSkip({ index: fallbackIndex, name: '', reason: 'linha-sem-colunas-suficientes' });
      return;
    }

    const index = parseInt($(cells[0]).text().trim(), 10) || fallbackIndex;
    const name = $(cells[1]).text().trim();
    const upc = $(cells[2]).text().trim();
    const supplierUrl = extractHref($(cells[3]));
    const amazonUpcSearchUrl = extractHref($(cells[4]));
    const amazonTitleSearchUrl = extractHref($(cells[5]));

    // Verificar se deve ser pulado
    const isSkippedByName = SKIP_PATTERNS.some(pattern => pattern.test(name));
    const hasValidUPC = isValidUPC(upc);
    const normalizedUrl = normalizeSupplierUrl(supplierUrl);

    if (isSkippedByName) {
      addSkip({ index, name, reason: 'nome-indica-pagina-ou-colecao' });
      return;
    }

    if (!supplierUrl) {
      addSkip({ index, name, reason: 'url-fornecedor-ausente' });
      return;
    }

    if (!normalizedUrl.isValid) {
      addSkip({ index, name, reason: 'url-fornecedor-invalida', supplierUrl });
      return;
    }

    if (SKIP_LISTING_URLS && normalizedUrl.urlKind === 'listing') {
      addSkip({
        index,
        name,
        reason: 'url-de-listagem-detectada',
        supplierUrl: normalizedUrl.original
      });
      return;
    }

    if (DEDUPE_BY_SUPPLIER_URL) {
      const firstIndex = byCanonicalSupplierUrl.get(normalizedUrl.canonical);
      if (firstIndex !== undefined) {
        addSkip({
          index,
          name,
          reason: 'url-fornecedor-duplicada',
          supplierUrl: normalizedUrl.original,
          canonicalSupplierUrl: normalizedUrl.canonical,
          firstIndex
        });
        return;
      }
      byCanonicalSupplierUrl.set(normalizedUrl.canonical, index);
    }

    if (!hasValidUPC) {
      addWarning({
        index,
        name,
        upc,
        reason: 'upc-invalido-ou-ausente'
      });
    }

    products.push({
      index,
      name,
      upc: upc.replace(/\D/g, ''),
      supplierUrl: normalizedUrl.canonical,
      supplierUrlOriginal: normalizedUrl.original,
      supplierDomain: normalizedUrl.domain,
      supplierUrlKind: normalizedUrl.urlKind,
      supplierUrlRemovedParams: normalizedUrl.removedParams,
      amazonUpcSearchUrl,
      amazonTitleSearchUrl,
      amazonSearchTermUpc: extractAmazonSearchTerm(amazonUpcSearchUrl),
      amazonSearchTermTitle: extractAmazonSearchTerm(amazonTitleSearchUrl),
      hasValidUPC
    });
  });

  const metrics = {
    totalRows: rows.length,
    includedProducts: products.length,
    skippedRows: skipped.length,
    warningRows: warnings.length,
    skipCounts,
    warningCounts,
    deduplicatedBySupplierUrl: skipCounts['url-fornecedor-duplicada'] || 0,
    skippedListingUrls: skipCounts['url-de-listagem-detectada'] || 0,
    skippedByInvalidSupplierUrl: skipCounts['url-fornecedor-invalida'] || 0,
    invalidOrMissingUpc: warningCounts['upc-invalido-ou-ausente'] || 0,
    uniqueSupplierUrls: new Set(products.map(product => product.supplierUrl)).size
  };

  log.info(
    `Produtos incluídos: ${metrics.includedProducts} | ` +
    `Pulados: ${metrics.skippedRows} | Avisos: ${metrics.warningRows}`
  );

  if (metrics.deduplicatedBySupplierUrl > 0) {
    log.info(`Deduplicados por URL canônica: ${metrics.deduplicatedBySupplierUrl}`);
  }
  if (metrics.skippedListingUrls > 0) {
    log.info(`Ignorados por URL de listagem: ${metrics.skippedListingUrls}`);
  }

  if (skipped.length > 0) {
    log.info(
      `Exemplos de pulados: ${skipped
        .slice(0, 5)
        .map(item => `[${item.index}] ${item.name || '(sem nome)'} — ${item.reason}`)
        .join('; ')}`
    );
  }

  if (warnings.length > 0) {
    log.info(
      `Exemplos de aviso: ${warnings
        .slice(0, 5)
        .map(item => `[${item.index}] ${item.name || '(sem nome)'} — ${item.reason}`)
        .join('; ')}`
    );
  }

  return {
    products,
    skipped,
    warnings,
    totalRows: rows.length,
    metrics
  };
}

function summarizeNameDuplicatesByDistinctUrl(products) {
  const byName = new Map();
  for (const product of products) {
    const key = (product.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key).add(product.supplierUrl);
  }

  let duplicateNameDifferentUrl = 0;
  for (const urls of byName.values()) {
    if (urls.size > 1) duplicateNameDifferentUrl += 1;
  }

  return duplicateNameDifferentUrl;
}

/**
 * Extrai métricas adicionais de auditoria para validar qualidade do input.
 */
export function analyzeParsedProducts(parsed) {
  const products = parsed.products || [];

  return {
    ...(parsed.metrics || {}),
    duplicateNameDifferentUrl: summarizeNameDuplicatesByDistinctUrl(products),
    listingUrlsKept: products.filter(product => product.supplierUrlKind === 'listing').length
  };
}

/**
 * Agrupa produtos por domínio do fornecedor para exibição/relatório.
 */
export function groupBySupplier(products) {
  const groups = {};
  for (const product of products) {
    const key = product.supplierDomain || 'desconhecido';
    if (!groups[key]) groups[key] = [];
    groups[key].push(product);
  }
  return groups;
}

// Execução direta: parseia o HTML e imprime resumo
if (process.argv[1] && process.argv[1].endsWith('parser.js')) {
  const htmlPath = process.argv[2] || path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '..', '..', 'Produtos_Mateus_22_02_2026_141622.html'
  );

  if (!fs.existsSync(htmlPath)) {
    log.error(`Arquivo não encontrado: ${htmlPath}`);
    process.exit(1);
  }

  log.info(`Parseando: ${htmlPath}`);
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const parsed = parseProductsHTML(html);
  const metrics = analyzeParsedProducts(parsed);
  const groups = groupBySupplier(parsed.products);

  console.log('\n=== RESUMO DO PARSE ===');
  console.log(`Total de linhas na tabela: ${parsed.totalRows}`);
  console.log(`Produtos incluídos: ${parsed.products.length}`);
  console.log(`Pulados: ${parsed.skipped.length}`);
  console.log(`Avisos: ${parsed.warnings.length}`);
  console.log(`Deduplicados por URL: ${metrics.deduplicatedBySupplierUrl}`);
  console.log(`Nomes duplicados com URLs diferentes: ${metrics.duplicateNameDifferentUrl}`);

  console.log('\nPor fornecedor:');
  for (const [domain, productList] of Object.entries(groups)) {
    console.log(`  ${domain}: ${productList.length} produtos`);
  }

  console.log('\nPrimeiros 5 produtos:');
  parsed.products.slice(0, 5).forEach(product => {
    console.log(`  [${product.index}] ${product.name} | UPC: ${product.upc || '-'} | ${product.supplierDomain}`);
  });
}
