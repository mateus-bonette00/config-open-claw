import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../../core/logger.js';
import { parseProductsHTML, analyzeParsedProducts, groupBySupplier } from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('fba-analyzer');

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    htmlPath: null,
    outPath: null,
    sampleSize: 8
  };

  while (args.length > 0) {
    const token = args.shift();
    if (!token) continue;

    if (token === '--out') {
      options.outPath = args.shift() || null;
      continue;
    }

    if (token === '--sample') {
      const sample = Number.parseInt(args.shift() || '', 10);
      if (Number.isFinite(sample) && sample > 0) {
        options.sampleSize = sample;
      }
      continue;
    }

    if (!options.htmlPath) {
      options.htmlPath = token;
    }
  }

  return options;
}

function countByReason(items) {
  return items.reduce((acc, item) => {
    const reason = item.reason || 'sem-reason';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
}

function sortEntriesDesc(objectMap) {
  return Object.entries(objectMap || {})
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

function pickExamples(items, size = 8) {
  return items.slice(0, size).map(item => ({
    index: item.index,
    name: item.name || null,
    reason: item.reason || null,
    supplierUrl: item.supplierUrl || item.supplierUrlOriginal || null,
    canonicalSupplierUrl: item.canonicalSupplierUrl || null,
    firstIndex: item.firstIndex || null
  }));
}

function collectNameConflicts(products, limit = 8) {
  const map = new Map();

  for (const product of products) {
    const key = String(product.name || '').trim().toLowerCase();
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        rawName: product.name,
        urls: new Map()
      });
    }

    const entry = map.get(key);
    const url = product.supplierUrl;

    if (!entry.urls.has(url)) {
      entry.urls.set(url, []);
    }

    entry.urls.get(url).push(product.index);
  }

  const conflicts = [];
  for (const entry of map.values()) {
    if (entry.urls.size <= 1) continue;
    conflicts.push({
      name: entry.rawName,
      distinctUrls: [...entry.urls.entries()].map(([url, indexes]) => ({ url, indexes }))
    });
  }

  return conflicts.slice(0, limit);
}

function buildSupplierBreakdown(products) {
  const grouped = groupBySupplier(products);
  return Object.entries(grouped)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([domain, list]) => ({
      domain,
      products: list.length,
      listingUrls: list.filter(item => item.supplierUrlKind === 'listing').length,
      missingUpc: list.filter(item => !item.hasValidUPC).length
    }));
}

function run() {
  const options = parseArgs(process.argv.slice(2));

  const htmlPath = options.htmlPath || path.join(
    __dirname,
    '..',
    '..',
    'Produtos_Mateus_22_02_2026_141622.html'
  );

  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Arquivo HTML não encontrado: ${htmlPath}`);
  }

  const html = fs.readFileSync(htmlPath, 'utf-8');
  const parsed = parseProductsHTML(html);
  const metrics = analyzeParsedProducts(parsed);

  const skipByReason = countByReason(parsed.skipped);
  const warningByReason = countByReason(parsed.warnings);

  const report = {
    generatedAt: new Date().toISOString(),
    htmlPath,
    summary: {
      totalRows: parsed.totalRows,
      validProducts: parsed.products.length,
      skippedRows: parsed.skipped.length,
      warningRows: parsed.warnings.length,
      uniqueSupplierUrls: metrics.uniqueSupplierUrls,
      deduplicatedBySupplierUrl: metrics.deduplicatedBySupplierUrl,
      skippedListingUrls: metrics.skippedListingUrls,
      invalidOrMissingUpc: metrics.invalidOrMissingUpc,
      duplicateNameDifferentUrl: metrics.duplicateNameDifferentUrl,
      listingUrlsKept: metrics.listingUrlsKept
    },
    skipByReason: sortEntriesDesc(skipByReason),
    warningByReason: sortEntriesDesc(warningByReason),
    suppliers: buildSupplierBreakdown(parsed.products),
    samples: {
      skipped: pickExamples(parsed.skipped, options.sampleSize),
      warnings: pickExamples(parsed.warnings, options.sampleSize),
      sameNameDifferentUrl: collectNameConflicts(parsed.products, options.sampleSize)
    }
  };

  if (options.outPath) {
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    fs.writeFileSync(options.outPath, JSON.stringify(report, null, 2), 'utf-8');
    log.info(`Relatório de auditoria salvo em ${options.outPath}`);
  }

  console.log('\n=== FBA INPUT AUDIT ===');
  console.log(`Arquivo: ${htmlPath}`);
  console.log(`Linhas totais: ${report.summary.totalRows}`);
  console.log(`Produtos válidos: ${report.summary.validProducts}`);
  console.log(`Pulados: ${report.summary.skippedRows}`);
  console.log(`Avisos: ${report.summary.warningRows}`);
  console.log(`URLs únicas: ${report.summary.uniqueSupplierUrls}`);
  console.log(`Deduplicados por URL: ${report.summary.deduplicatedBySupplierUrl}`);
  console.log(`Listagens ignoradas: ${report.summary.skippedListingUrls}`);
  console.log(`Nomes iguais com links diferentes: ${report.summary.duplicateNameDifferentUrl}`);

  const topSkips = report.skipByReason.slice(0, 5);
  if (topSkips.length) {
    console.log('\nTop motivos de skip:');
    for (const item of topSkips) {
      console.log(`- ${item.key}: ${item.count}`);
    }
  }

  const topWarnings = report.warningByReason.slice(0, 5);
  if (topWarnings.length) {
    console.log('\nTop avisos:');
    for (const item of topWarnings) {
      console.log(`- ${item.key}: ${item.count}`);
    }
  }
}

run();
