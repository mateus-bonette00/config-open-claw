import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createLogger } from '../../core/logger.js';
import { config } from '../../core/secrets.js';
import path from 'path';
import fs from 'fs';

puppeteer.use(StealthPlugin());

const log = createLogger('fba-browser');
const SCREENSHOT_DIR = path.resolve('storage/screenshots');

function buildAccessIssue(source, snapshot, type, reason) {
  return {
    source,
    type,
    reason,
    title: snapshot.title,
    url: snapshot.url,
    excerpt: snapshot.bodyText.slice(0, 240)
  };
}

function normalizePrice(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;

  let normalized = String(rawValue).trim();
  if (!normalized) return null;

  normalized = normalized
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!normalized) return null;

  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (normalized.includes(',')) {
    const parts = normalized.split(',');
    normalized = parts.at(-1)?.length === 2
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function navigate(page, url, label) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    return { error: null, accessIssue: null };
  } catch (err) {
    const accessIssue = {
      source: label,
      type: 'navigation',
      reason: `Falha ao abrir ${label}: ${err.message}`,
      title: '',
      url,
      excerpt: ''
    };
    log.error(accessIssue.reason);
    return { error: 'navigation', accessIssue };
  }
}

/**
 * Lança o Chrome com o perfil do usuário que tem Keepa e AZInsight instalados.
 * IMPORTANTE: O Chrome deve estar fechado no servidor antes de lançar com perfil real.
 */
export async function launchBrowser(options = {}) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const launchOptions = {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
      '--disable-dev-shm-usage'
    ],
    defaultViewport: { width: 1920, height: 1080 },
    ...options
  };

  if (config.chrome.userDataDir && fs.existsSync(config.chrome.userDataDir)) {
    launchOptions.userDataDir = config.chrome.userDataDir;
    if (config.chrome.profile && config.chrome.profile !== 'Default') {
      launchOptions.args.push(`--profile-directory=${config.chrome.profile}`);
    }
    log.info(`Usando perfil Chrome: ${config.chrome.userDataDir} (${config.chrome.profile})`);
  } else {
    log.warn('Perfil Chrome não encontrado. Keepa/AZInsight podem não funcionar.');
  }

  const browser = await puppeteer.launch(launchOptions);
  log.info('Browser lançado com sucesso.');
  return browser;
}

/**
 * Confirma que a máquina está com IP dos EUA antes de iniciar navegação sensível.
 */
export async function verifyVpnConnection() {
  if (!config.vpn.required) {
    return { checked: false };
  }

  const checkUrls = [
    config.vpn.checkUrl,
    'https://ipapi.co/json/',
    'https://ipinfo.io/json'
  ].filter(Boolean);

  const uniqueUrls = [...new Set(checkUrls)];
  const endpointErrors = [];

  for (const checkUrl of uniqueUrls) {
    try {
      const response = await fetch(checkUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        endpointErrors.push(`${checkUrl} -> HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const countryCode = String(
        data.country_code ||
        data.countryCode ||
        data.countryCodeIso3 ||
        data.country_code_iso3 ||
        data.country ||
        ''
      ).toUpperCase();
      const country = data.country_name || data.country || 'desconhecido';
      const ip = data.ip || data.query || data.ip_addr || 'desconhecido';

      if (!countryCode || countryCode.length < 2) {
        endpointErrors.push(`${checkUrl} -> resposta sem country_code`);
        continue;
      }

      if (!config.vpn.allowedCountries.includes(countryCode)) {
        throw new Error(
          `VPN obrigatória para os EUA. País detectado: ${countryCode} (${country}) | IP ${ip}`
        );
      }

      log.info(`VPN validada: ${countryCode} (${country}) | IP ${ip} | endpoint=${checkUrl}`);
      return { checked: true, countryCode, country, ip, endpoint: checkUrl };
    } catch (err) {
      endpointErrors.push(`${checkUrl} -> ${err.message}`);
    }
  }

  throw new Error(
    `Falha ao validar VPN. Endpoints testados: ${endpointErrors.join(' | ')}`
  );
}

/**
 * Salva screenshot para debug/auditoria.
 */
export async function saveScreenshot(page, name) {
  const filepath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  log.debug(`Screenshot salvo: ${filepath}`);
  return filepath;
}

/**
 * Detecta bloqueios/captchas na página atual.
 */
export async function inspectPageAccess(page, source = 'page') {
  const snapshot = await page.evaluate(() => ({
    title: document.title || '',
    url: location.href,
    bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 5000),
    hasAmazonCaptcha: Boolean(document.querySelector('#captchacharacters')),
    hasCloudflareChallenge: Boolean(
      document.querySelector(
        '#challenge-running, #cf-challenge-running, .cf-browser-verification, ' +
        '[name="cf-turnstile-response"], iframe[src*="challenges.cloudflare.com"]'
      )
    ),
    hasRecaptcha: Boolean(
      document.querySelector('.g-recaptcha, iframe[src*="recaptcha"], [name="g-recaptcha-response"]')
    )
  }));

  const text = `${snapshot.title} ${snapshot.bodyText}`.toLowerCase();

  if (snapshot.hasAmazonCaptcha || text.includes('enter the characters you see below')) {
    return buildAccessIssue(source, snapshot, 'captcha', 'CAPTCHA detectado na página');
  }

  if (
    snapshot.hasCloudflareChallenge ||
    text.includes('verify you are human') ||
    text.includes('checking if the site connection is secure') ||
    text.includes('attention required')
  ) {
    return buildAccessIssue(source, snapshot, 'challenge', 'Desafio anti-bot detectado');
  }

  if (snapshot.hasRecaptcha || text.includes('g-recaptcha') || text.includes('i am human')) {
    return buildAccessIssue(source, snapshot, 'captcha', 'reCAPTCHA detectado na página');
  }

  if (
    text.includes('your connection needs to be verified') ||
    text.includes('access denied') ||
    text.includes('temporarily blocked') ||
    text.includes('unusual traffic') ||
    text.includes('robot or human')
  ) {
    return buildAccessIssue(source, snapshot, 'blocked', 'Acesso bloqueado pelo site');
  }

  return null;
}

/**
 * Extrai resultados já renderizados na busca da Amazon.
 */
export async function extractAmazonSearchResults(page) {
  const noResults = await page.evaluate(() => {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    return bodyText.includes('no results for') || bodyText.includes('did not match any products');
  });

  const results = await page.evaluate(() => {
    const items = document.querySelectorAll('[data-component-type="s-search-result"]');

    return Array.from(items).slice(0, 5).map(item => {
      const titleEl = item.querySelector('h2 a span');
      const priceWhole = item.querySelector('.a-price-whole');
      const priceFraction = item.querySelector('.a-price-fraction');
      const linkEl = item.querySelector('h2 a');
      const asin = item.dataset.asin || '';

      let price = null;
      if (priceWhole) {
        const whole = priceWhole.textContent.replace(/[^0-9]/g, '');
        const fraction = priceFraction ? priceFraction.textContent.replace(/[^0-9]/g, '') : '00';
        const parsed = Number.parseFloat(`${whole}.${fraction}`);
        price = Number.isFinite(parsed) ? parsed : null;
      }

      return {
        asin,
        title: titleEl ? titleEl.textContent.trim() : '',
        price,
        url: linkEl ? `https://www.amazon.com${linkEl.getAttribute('href')}` : ''
      };
    }).filter(result => result.asin && result.url);
  });

  return { noResults, results };
}

/**
 * Busca produto na Amazon por UPC ou título.
 */
export async function searchAmazon(page, searchTerm, type = 'upc') {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(searchTerm)}`;
  log.info(`Buscando Amazon (${type}): ${searchTerm}`);

  const navigation = await navigate(page, url, `amazon-${type}`);
  if (navigation.error) {
    await saveScreenshot(page, `amazon-${type}-navigation-error`);
    return { error: navigation.error, accessIssue: navigation.accessIssue, results: [] };
  }

  const accessIssue = await inspectPageAccess(page, `amazon-${type}`);
  if (accessIssue) {
    log.warn(`Bloqueio na Amazon (${type}): ${accessIssue.reason}`);
    await saveScreenshot(page, `amazon-${type}-${accessIssue.type}`);
    return { error: accessIssue.type, accessIssue, results: [] };
  }

  const extracted = await extractAmazonSearchResults(page);
  if (extracted.noResults) {
    log.info(`Sem resultados na Amazon para: ${searchTerm}`);
    return { error: null, accessIssue: null, results: [] };
  }

  log.info(`Amazon retornou ${extracted.results.length} resultados para: ${searchTerm}`);
  return { error: null, accessIssue: null, results: extracted.results };
}

/**
 * Extrai título/preço/estoque da página do fornecedor.
 */
export async function extractSupplierData(page) {
  const supplier = await page.evaluate(() => {
    const titleSelectors = [
      'h1',
      '.product__title',
      '.product-title',
      '[itemprop="name"]',
      '[data-product-title]'
    ];
    const currentPriceSelectors = [
      'meta[property="product:price:amount"]',
      'meta[itemprop="price"]',
      'meta[property="og:price:amount"]',
      '[itemprop="price"]',
      '[data-product-price]',
      '[data-price]',
      '.price-item--sale',
      '.price-item--regular',
      '.product__price',
      '.product-price',
      '.price .money',
      '.money',
      '[class*="price"]:not([class*="compare"]):not([class*="old"])',
      '[id*="price"]'
    ];
    const previousPriceSelectors = [
      '[data-compare-price]',
      '.price-item--regular',
      '.price-item--compare',
      '.compare-at-price',
      '.was-price',
      '.old-price',
      '.price--compare',
      '.price--old',
      '[class*="compare"][class*="price"]',
      '[class*="old"][class*="price"]'
    ];

    const normalizePriceInPage = value => {
      if (value === null || value === undefined) return null;

      let normalized = String(value).trim();
      if (!normalized) return null;

      normalized = normalized
        .replace(/\s+/g, '')
        .replace(/[^\d,.-]/g, '');

      if (!normalized) return null;

      if (normalized.includes(',') && normalized.includes('.')) {
        if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
          normalized = normalized.replace(/\./g, '').replace(',', '.');
        } else {
          normalized = normalized.replace(/,/g, '');
        }
      } else if (normalized.includes(',')) {
        const parts = normalized.split(',');
        normalized = parts.at(-1)?.length === 2
          ? normalized.replace(/\./g, '').replace(',', '.')
          : normalized.replace(/,/g, '');
      }

      const parsed = Number.parseFloat(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const isVisible = element => {
      if (!element) return false;
      if (element.tagName === 'META') return true;
      const style = window.getComputedStyle(element);
      if (!style) return true;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      if (element.getClientRects().length === 0 && style.position !== 'fixed') {
        return false;
      }
      return true;
    };

    const sourceConfidence = source => {
      const sourceLower = String(source || '').toLowerCase();
      if (sourceLower.includes('meta') || sourceLower.includes('json-ld')) return 'high';
      if (
        sourceLower.includes('price-item') ||
        sourceLower.includes('product__price') ||
        sourceLower.includes('[data-price]') ||
        sourceLower.includes('[itemprop="price"]')
      ) {
        return 'medium';
      }
      return 'low';
    };

    const collectPriceCandidates = (selectors, candidateType) => {
      const candidates = [];
      for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll(selector)).slice(0, 20);
        for (const element of elements) {
          if (!isVisible(element)) continue;

          const context = `${selector} ${element.className || ''} ${element.id || ''}`.toLowerCase();
          if (
            candidateType === 'current' &&
            /(compare|was|save|old|original|msrp|list|strike|before)/.test(context)
          ) {
            continue;
          }

          const raw = element.getAttribute('content') ||
            element.getAttribute('data-price') ||
            element.getAttribute('value') ||
            element.textContent ||
            '';

          const rawText = String(raw || '').trim();
          if (!rawText) continue;

          const parsed = normalizePriceInPage(rawText);
          if (parsed === null) continue;

          candidates.push({
            value: parsed,
            text: rawText.slice(0, 120),
            source: selector,
            candidateType,
            confidence: sourceConfidence(selector),
            context: context.slice(0, 120)
          });
        }
      }
      return candidates;
    };

    const collectJsonLdData = () => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      const offers = [];
      let sku = null;
      let brand = null;
      let availability = null;

      const traverse = node => {
        if (!node) return;
        if (Array.isArray(node)) {
          node.forEach(traverse);
          return;
        }
        if (typeof node !== 'object') return;

        const nodeType = String(node['@type'] || '').toLowerCase();
        if (nodeType.includes('product')) {
          if (!sku && node.sku) sku = String(node.sku).trim();
          if (!brand) {
            if (typeof node.brand === 'string') brand = node.brand.trim();
            if (typeof node.brand === 'object' && node.brand?.name) brand = String(node.brand.name).trim();
          }
        }

        if (node.offers) traverse(node.offers);
        if (node.offer) traverse(node.offer);
        if (node['@graph']) traverse(node['@graph']);

        const rawPrice = node.price ?? node.lowPrice ?? node.highPrice;
        const parsedPrice = normalizePriceInPage(rawPrice);
        if (parsedPrice !== null) {
          offers.push({
            value: parsedPrice,
            text: String(rawPrice),
            source: 'json-ld',
            confidence: 'high'
          });
        }

        const nodeAvailability = String(node.availability || node.availabilityUrl || '').toLowerCase();
        if (!availability && nodeAvailability) {
          availability = nodeAvailability;
        }
      };

      for (const script of scripts) {
        try {
          const parsed = JSON.parse(script.textContent || '');
          traverse(parsed);
        } catch {
          // ignora json-ld malformado
        }
      }

      return { offers, sku, brand, availability };
    };

    const getFirstText = selectors => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const text = element?.textContent?.trim();
        if (text) return text;
      }
      return null;
    };

    const getFirstAttr = (selectors, attrs = ['content', 'value']) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!element) continue;
        for (const attr of attrs) {
          const value = element.getAttribute(attr);
          if (value && String(value).trim()) return String(value).trim();
        }
      }
      return null;
    };

    const absolutizeUrl = rawUrl => {
      if (!rawUrl) return '';
      try {
        return new URL(rawUrl, location.href).toString();
      } catch {
        return String(rawUrl).trim();
      }
    };

    const getAvailabilityStatus = () => {
      const availabilityMeta = document.querySelector('meta[itemprop="availability"], link[itemprop="availability"]');
      const availabilityMetaValue = String(
        availabilityMeta?.getAttribute('content') ||
        availabilityMeta?.getAttribute('href') ||
        ''
      ).toLowerCase();

      const availabilityText = [
        getFirstText(['[data-availability]', '[class*="availability"]', '[id*="availability"]']),
        getFirstText(['[data-stock]', '[class*="stock"]', '[id*="stock"]'])
      ]
        .filter(Boolean)
        .join(' ');

      const fullText = `${availabilityMetaValue} ${availabilityText} ${(document.body?.innerText || '').slice(0, 5000)}`
        .toLowerCase();

      if (/outofstock|out of stock|sold out|currently unavailable|backorder/.test(fullText)) {
        return { availabilityStatus: 'out_of_stock', available: false, availabilityText };
      }
      if (/preorder|pre-order|pre order/.test(fullText)) {
        return { availabilityStatus: 'preorder', available: true, availabilityText };
      }
      if (/instock|in stock|available to ship|ships in/.test(fullText)) {
        return { availabilityStatus: 'in_stock', available: true, availabilityText };
      }

      return { availabilityStatus: 'unknown', available: null, availabilityText };
    };

    const findTitle = () => {
      for (const selector of titleSelectors) {
        const element = document.querySelector(selector);
        const text = element?.textContent?.trim();
        if (text) return text;
      }
      return document.title || '';
    };

    const currentCandidates = collectPriceCandidates(currentPriceSelectors, 'current');
    const previousCandidates = collectPriceCandidates(previousPriceSelectors, 'previous');
    const jsonLdData = collectJsonLdData();

    if (jsonLdData.offers.length) {
      currentCandidates.push(
        ...jsonLdData.offers.map(offer => ({
          ...offer,
          candidateType: 'current'
        }))
      );
    }

    const positiveCurrentCandidates = currentCandidates.filter(candidate => candidate.value > 0);
    const zeroCurrentCandidates = currentCandidates.filter(candidate => candidate.value === 0);
    const positivePreviousCandidates = previousCandidates.filter(candidate => candidate.value > 0);

    const selectedCurrent = positiveCurrentCandidates[0] || null;
    const selectedPrevious = positivePreviousCandidates[0] || null;

    const { availabilityStatus, available, availabilityText } = getAvailabilityStatus();

    const bodyTextLower = (document.body?.innerText || '').toLowerCase();
    const hasVariantControls = Boolean(
      document.querySelector('select[name*="variant"], [name*="option"], .swatch, .variant-selector, [data-variant]')
    );
    const hasRequestPriceSignal = /call for price|contact for price|request (a )?quote|see price in cart|price upon request|login to view price/.test(
      bodyTextLower
    );

    let priceStatus = 'ok';
    if (!selectedCurrent) {
      if (hasRequestPriceSignal) {
        priceStatus = 'price_on_request';
      } else if (availabilityStatus === 'out_of_stock') {
        priceStatus = 'out_of_stock';
      } else if (zeroCurrentCandidates.length > 0) {
        priceStatus = 'zero_detected';
      } else if (hasVariantControls) {
        priceStatus = 'variant_not_selected';
      } else if (currentCandidates.length > 0) {
        priceStatus = 'price_parse_error';
      } else {
        priceStatus = 'missing';
      }
    }

    const sku = getFirstText([
      '[itemprop="sku"]',
      '[data-sku]',
      '[class*="sku"]',
      '[id*="sku"]'
    ]) || jsonLdData.sku;

    const brand = (
      getFirstText([
        '[itemprop="brand"]',
        '[data-brand]',
        '[class*="brand"]'
      ]) ||
      getFirstAttr([
        'meta[property="product:brand"]',
        'meta[name="brand"]',
        'meta[property="og:brand"]'
      ]) ||
      jsonLdData.brand ||
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
      ''
    ).trim();

    const categoryTrail = Array.from(
      document.querySelectorAll('nav.breadcrumb a, .breadcrumb a, [aria-label*="breadcrumb"] a')
    )
      .map(item => item.textContent?.trim())
      .filter(Boolean);

    const imageUrl = (
      document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      document.querySelector('img[itemprop="image"]')?.getAttribute('src') ||
      document.querySelector('[data-product-image] img')?.getAttribute('src') ||
      document.querySelector('img[src*="product"]')?.getAttribute('src') ||
      ''
    ).trim();

    const priceDiagnostics = {
      currentCandidatesFound: currentCandidates.length,
      previousCandidatesFound: previousCandidates.length,
      zeroCurrentCandidates: zeroCurrentCandidates.length
    };

    return {
      title: findTitle(),
      price: selectedCurrent ? selectedCurrent.value : null,
      priceCurrent: selectedCurrent ? selectedCurrent.value : null,
      priceCurrentText: selectedCurrent ? selectedCurrent.text : '',
      pricePrevious: selectedPrevious ? selectedPrevious.value : null,
      pricePreviousText: selectedPrevious ? selectedPrevious.text : '',
      priceSource: selectedCurrent ? selectedCurrent.source : '',
      priceConfidence: selectedCurrent ? selectedCurrent.confidence : 'none',
      priceStatus,
      available,
      availabilityStatus,
      availabilityText: availabilityText ? availabilityText.slice(0, 200) : '',
      sku,
      brand,
      category: categoryTrail.join(' > '),
      imageUrl: absolutizeUrl(imageUrl),
      extractionDiagnostics: priceDiagnostics,
      url: location.href
    };
  });

  const normalizedCurrent = normalizePrice(supplier.priceCurrent ?? supplier.price);
  const normalizedPrevious = normalizePrice(supplier.pricePrevious);
  const hasZeroDetected = normalizedCurrent !== null && normalizedCurrent <= 0;
  const finalCurrentPrice = normalizedCurrent !== null && normalizedCurrent > 0
    ? normalizedCurrent
    : null;

  const priceStatus = hasZeroDetected
    ? 'zero_detected'
    : (supplier.priceStatus || (finalCurrentPrice !== null ? 'ok' : 'missing'));

  return {
    ...supplier,
    price: finalCurrentPrice,
    priceCurrent: finalCurrentPrice,
    pricePrevious: normalizedPrevious,
    priceStatus,
    priceMissing: finalCurrentPrice === null
  };
}

/**
 * Abre a página do fornecedor e tenta extrair o preço real.
 */
export async function openSupplierPage(page, supplierUrl) {
  log.info(`Abrindo fornecedor: ${supplierUrl}`);

  const navigation = await navigate(page, supplierUrl, 'supplier');
  if (navigation.error) {
    await saveScreenshot(page, 'supplier-navigation-error');
    return { error: navigation.error, accessIssue: navigation.accessIssue, supplier: null };
  }

  const accessIssue = await inspectPageAccess(page, 'supplier');
  if (accessIssue) {
    log.warn(`Bloqueio no fornecedor: ${accessIssue.reason}`);
    await saveScreenshot(page, `supplier-${accessIssue.type}`);
    return { error: accessIssue.type, accessIssue, supplier: null };
  }

  const supplier = await extractSupplierData(page);
  if (supplier.price !== null) {
    log.info(
      `Fornecedor carregado: $${supplier.price.toFixed(2)} ` +
      `(${supplier.priceSource || 'DOM'} | status=${supplier.priceStatus || 'ok'})`
    );
  } else {
    log.warn(
      `Preço do fornecedor não encontrado automaticamente ` +
      `(status=${supplier.priceStatus || 'missing'} | source=${supplier.priceSource || 'n/a'}).`
    );
  }

  return { error: null, accessIssue: null, supplier };
}

/**
 * Aguarda as extensões Keepa e AZInsight carregarem.
 */
export async function waitForMarketplaceExtensions(page) {
  try {
    await page.waitForSelector('#keepa_box, iframe[src*="keepa"]', { timeout: 15000 });
    log.info('Keepa carregado na página.');
  } catch {
    log.warn('Keepa não carregou em 15s. Extensão pode não estar ativa.');
  }

  try {
    await page.waitForSelector('[class*="azinsight"], [class*="asinzen"], [id*="azinsight"]', { timeout: 15000 });
    log.info('AZInsight carregado na página.');
  } catch {
    log.warn('AZInsight não carregou em 15s. Extensão pode não estar ativa.');
  }
}

/**
 * Navega para a página do produto na Amazon e valida acesso.
 */
export async function goToProductPage(page, amazonUrl) {
  log.info(`Navegando para produto: ${amazonUrl}`);

  const navigation = await navigate(page, amazonUrl, 'amazon-product');
  if (navigation.error) {
    await saveScreenshot(page, 'amazon-product-navigation-error');
    return { error: navigation.error, accessIssue: navigation.accessIssue };
  }

  const accessIssue = await inspectPageAccess(page, 'amazon-product');
  if (accessIssue) {
    await saveScreenshot(page, `amazon-product-${accessIssue.type}`);
    return { error: accessIssue.type, accessIssue };
  }

  await waitForMarketplaceExtensions(page);
  return { error: null, accessIssue: null };
}

/**
 * Tenta extrair dados do Keepa da página do produto.
 */
export async function extractKeepaData(page) {
  log.info('Extraindo dados do Keepa...');
  await saveScreenshot(page, 'keepa-section');

  const keepaData = await page.evaluate(() => {
    const keepaBox = document.querySelector('#keepa_box');
    if (!keepaBox) return null;

    const text = keepaBox.textContent || '';

    return {
      available: true,
      rawText: text.substring(0, 2000),
      hasBSRData: text.includes('Sales Rank') || text.includes('BSR')
    };
  });

  if (!keepaData) {
    log.warn('Não foi possível extrair dados do Keepa.');
    return { available: false };
  }

  return keepaData;
}

/**
 * Extrai dados do AZInsight/AsinZen da página do produto.
 */
export async function extractAZInsightData(page) {
  log.info('Extraindo dados do AZInsight...');
  await saveScreenshot(page, 'azinsight-section');

  const azData = await page.evaluate(() => {
    const azPanel = document.querySelector('[class*="azinsight"], [class*="asinzen"], [id*="azinsight"]');
    if (!azPanel) return null;

    const text = azPanel.textContent || '';

    const extractNumber = label => {
      const regex = new RegExp(`${label}[:\\s]*\\$?([\\d.,]+)`, 'i');
      const match = text.match(regex);
      return match ? parseFloat(match[1].replace(',', '')) : null;
    };

    return {
      available: true,
      amazonPrice: extractNumber('Amazon Price|Buy Box|Price'),
      fbaFee: extractNumber('FBA Fee|Fulfillment'),
      referralFee: extractNumber('Referral Fee'),
      estimatedProfit: extractNumber('Profit|Net'),
      roi: extractNumber('ROI'),
      margin: extractNumber('Margin'),
      rawText: text.substring(0, 2000),
      amazonSells: text.toLowerCase().includes('amazon') &&
        (text.toLowerCase().includes('sells') || text.toLowerCase().includes('offer'))
    };
  });

  if (!azData) {
    log.warn('Não foi possível extrair dados do AZInsight.');
    return { available: false };
  }

  return azData;
}

/**
 * Insere o Buy Cost no campo do AZInsight para calcular lucro real.
 */
export async function inputBuyCostInAZInsight(page, buyCost) {
  log.info(`Inserindo Buy Cost no AZInsight: $${buyCost.toFixed(2)}`);

  const costInput = await page.$(
    '[class*="azinsight"] input[type="text"], ' +
    '[class*="azinsight"] input[type="number"], ' +
    '[id*="cost"] input'
  );

  if (!costInput) {
    log.warn('Campo de Buy Cost do AZInsight não encontrado.');
    return false;
  }

  await costInput.click({ clickCount: 3 });
  await costInput.type(buyCost.toFixed(2), { delay: 50 });
  await page.keyboard.press('Tab');
  await new Promise(resolve => setTimeout(resolve, 2000));

  await saveScreenshot(page, 'azinsight-after-cost');
  return true;
}

/**
 * Verifica se a Amazon vende o mesmo produto.
 */
export async function checkAmazonSells(page) {
  const amazonSells = await page.evaluate(() => {
    const buyBox = document.querySelector('#buyBoxInner, #newBuyBoxPrice, #merchant-info');
    if (buyBox) {
      const text = buyBox.textContent || '';
      if (text.includes('Amazon.com') || text.includes('Ships from and sold by Amazon')) {
        return true;
      }
    }

    const sellers = document.querySelectorAll('#aod-offer .aod-offer-soldBy, .offer-display-feature-text');
    for (const seller of sellers) {
      if ((seller.textContent || '').includes('Amazon.com')) {
        return true;
      }
    }

    return false;
  });

  log.info(`Amazon vende o produto: ${amazonSells ? 'SIM' : 'NAO'}`);
  return amazonSells;
}

/**
 * Delay humano para evitar detecção de bot.
 */
export async function humanDelay(min = 2000, max = 5000) {
  const delay = Math.floor(Math.random() * (max - min) + min);
  log.debug(`Aguardando ${delay}ms (anti-bot delay)...`);
  await new Promise(resolve => setTimeout(resolve, delay));
}

export async function closeBrowser(browser) {
  if (browser) {
    await browser.close();
    log.info('Browser fechado.');
  }
}
