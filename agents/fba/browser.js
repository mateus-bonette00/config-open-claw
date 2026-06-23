import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createLogger } from '../../core/logger.js';
import { config } from '../../core/secrets.js';
import path from 'path';
import fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

puppeteer.use(StealthPlugin());

const log = createLogger('fba-browser');
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT_DIR = path.resolve(MODULE_DIR, '../..');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT_DIR, 'storage/screenshots');
const CHROME_RUNTIME_PROFILE_DIR = process.env.CHROME_AUTOMATION_USER_DATA_DIR
  ? path.resolve(process.env.CHROME_AUTOMATION_USER_DATA_DIR)
  : path.join(PROJECT_ROOT_DIR, 'storage/chrome-profile-runtime');
const MARKETPLACE_EXTENSION_IDS = {
  keepa: 'neebplgakaahbhdphmkckjjcegoiijjo',
  azInsight: 'gefiflkplklbfkcjjcbobokclopbigfg'
};
const AZINSIGHT_ROOT_SELECTORS = [
  '[id*="azinsight" i]',
  '[id*="asinzen" i]',
  '[class*="azinsight" i]',
  '[class*="asinzen" i]',
  'body'
];
const AZINSIGHT_PANEL_SELECTOR = AZINSIGHT_ROOT_SELECTORS.join(', ');
const DEFAULT_USER_AGENT = process.env.FBA_USER_AGENT ||
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const NAVIGATION_ATTEMPTS = [
  { waitUntil: 'domcontentloaded', timeout: 30000, settleMs: 2500, label: 'domcontentloaded' },
  { waitUntil: 'load', timeout: 40000, settleMs: 3500, label: 'load' }
];
const RECOVERY_STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'from', 'this', 'that', 'series', 'scale',
  'collection', 'edition', 'tractor', 'toy', 'farm'
]);

function parseBooleanFlag(value) {
  if (value === undefined || value === null || value === '') return null;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveHeadlessMode() {
  const explicit = parseBooleanFlag(process.env.FBA_HEADLESS ?? process.env.CHROME_HEADLESS);
  if (explicit !== null) return explicit;
  return !(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

function isDisplayRequired() {
  const explicit = parseBooleanFlag(process.env.FBA_REQUIRE_DISPLAY);
  return explicit ?? false;
}

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeIfExists(targetPath) {
  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  } catch {}
}

function cleanupChromeLockFiles(dirPath) {
  const lockNames = [
    'SingletonLock',
    'SingletonSocket',
    'SingletonCookie',
    'DevToolsActivePort',
    'lockfile'
  ];

  for (const name of lockNames) {
    removeIfExists(path.join(dirPath, name));
  }
}

function removeArg(args, prefix) {
  return args.filter(arg => !String(arg).startsWith(prefix));
}

function normalizeFinitePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveChromeDebugPort() {
  const rawPort = process.env.FBA_CHROME_DEBUG_PORT || process.env.CHROME_DEBUG_PORT || '9222';
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Porta de controle do Chrome invalida: ${rawPort}`);
  }
  return port;
}

async function probeChromeDebugger(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1000)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function waitForChromeDebugger(port, chromeProcess, getRecentLogs, timeoutMs = 45000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const version = await probeChromeDebugger(port);
    if (version?.webSocketDebuggerUrl) {
      return version;
    }

    if (chromeProcess.exitCode !== null || chromeProcess.signalCode) {
      throw new Error(
        `Chrome encerrou antes de abrir a porta de controle ${port}. ` +
        `Logs: ${getRecentLogs() || 'sem logs'}`
      );
    }

    await sleep(500);
  }

  throw new Error(
    `Chrome abriu, mas a porta de controle ${port} nao respondeu em ${Math.round(timeoutMs / 1000)}s. ` +
    `Logs: ${getRecentLogs() || 'sem logs'}`
  );
}

async function launchChromeViaBrowserUrl(launchOptions) {
  const debugPort = resolveChromeDebugPort();
  const existingDebugger = await probeChromeDebugger(debugPort);
  if (existingDebugger) {
    throw new Error(
      `A porta de controle do Chrome ${debugPort} ja esta em uso. ` +
      'Feche outro Chrome/LUCAS1 aberto com debugger e tente novamente.'
    );
  }

  let args = Array.isArray(launchOptions.args) ? [...launchOptions.args] : [];
  args = removeArg(args, '--remote-debugging-');
  args.push(`--remote-debugging-port=${debugPort}`);

  const recentLogs = [];
  const rememberLog = chunk => {
    const text = String(chunk || '').trim();
    if (!text) return;
    recentLogs.push(text);
    while (recentLogs.length > 12) recentLogs.shift();
  };
  const getRecentLogs = () => recentLogs.join(' | ');

  const chromeProcess = spawn(launchOptions.executablePath, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  chromeProcess.stdout.on('data', rememberLog);
  chromeProcess.stderr.on('data', rememberLog);

  let browser;
  try {
    await waitForChromeDebugger(debugPort, chromeProcess, getRecentLogs);
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${debugPort}`,
      defaultViewport: launchOptions.defaultViewport,
      protocolTimeout: launchOptions.protocolTimeout
    });
  } catch (error) {
    if (chromeProcess.exitCode === null && !chromeProcess.killed) {
      chromeProcess.kill('SIGTERM');
    }
    throw error;
  }

  browser.once('disconnected', () => {
    if (chromeProcess.exitCode === null && !chromeProcess.killed) {
      chromeProcess.kill('SIGTERM');
    }
  });

  return browser;
}

function firstFiniteNumber(values = []) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function normalizeKeepaRank(value) {
  const numeric = normalizeFinitePositiveNumber(value);
  if (numeric === null || numeric < 0) return null;
  return numeric;
}

function normalizeKeepaMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Number((numeric / 100).toFixed(2));
}

function extractKeepaApiStats(product = {}) {
  const stats = product.stats || {};
  const current = Array.isArray(stats.current) ? stats.current : [];

  const bsrDrops30 = firstFiniteNumber([
    product.salesRankDrops30,
    product.salesRankDrops30d,
    stats.salesRankDrops30,
    stats.salesRankDrops30d,
    stats.salesRankDropsLast30
  ]);
  const bsrDrops90 = firstFiniteNumber([
    product.salesRankDrops90,
    product.salesRankDrops90d,
    stats.salesRankDrops90,
    stats.salesRankDrops90d,
    stats.salesRankDropsLast90
  ]);
  const monthlySold = firstFiniteNumber([
    product.monthlySold,
    stats.monthlySold,
    stats.sales30,
    stats.salesLast30
  ]);

  return {
    available: true,
    source: 'keepa-api',
    bsrDrops: bsrDrops30 ?? bsrDrops90 ?? null,
    bsrDrops30: bsrDrops30 ?? null,
    bsrDrops90: bsrDrops90 ?? null,
    monthlySold: monthlySold ?? null,
    salesYearEstimate: (
      monthlySold !== null && monthlySold !== undefined
        ? Math.max(0, Math.round(monthlySold * 12))
        : (bsrDrops30 !== null && bsrDrops30 !== undefined
          ? Math.max(0, Math.round(bsrDrops30 * 12))
          : (bsrDrops90 !== null && bsrDrops90 !== undefined
            ? Math.max(0, Math.round(bsrDrops90 * (365 / 90)))
            : null))
    ),
    salesRankCurrent: normalizeKeepaRank(product.stats?.current_SALES ?? current[3]),
    buyBoxPrice: normalizeKeepaMoney(product.stats?.buyBoxPrice ?? current[18]),
    rawStatsAvailable: Boolean(product.stats)
  };
}

async function fetchKeepaApiData(asin) {
  const apiKey = process.env.KEEPA_API_KEY || '';
  if (!apiKey || !asin) return null;

  try {
    const url = new URL('https://api.keepa.com/product');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('domain', '1');
    url.searchParams.set('asin', asin);
    url.searchParams.set('stats', '90');
    url.searchParams.set('history', '1');
    url.searchParams.set('rating', '0');

    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(Number(process.env.FBA_KEEPA_API_TIMEOUT_MS || 15000))
    });

    if (!response.ok) {
      log.warn(`Keepa API falhou para ${asin}: HTTP ${response.status}`);
      return {
        available: false,
        source: 'keepa-api',
        apiError: `HTTP ${response.status}`
      };
    }

    const payload = await response.json();
    log.info(
      `Keepa API OK para ${asin}: tokensLeft=${payload?.tokensLeft ?? 'n/a'} refillIn=${payload?.refillIn ?? 'n/a'}`
    );
    const product = payload?.products?.[0] || null;
    if (!product) {
      return {
        available: false,
        source: 'keepa-api',
        apiError: 'ASIN sem produto na resposta'
      };
    }

    return extractKeepaApiStats(product);
  } catch (error) {
    log.warn(`Keepa API indisponivel para ${asin}: ${error.message}`);
    return {
      available: false,
      source: 'keepa-api',
      apiError: error.message
    };
  }
}

function copyPathIfExists(sourcePath, targetPath) {
  if (!sourcePath || !targetPath || !fs.existsSync(sourcePath)) return false;
  ensureDir(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
    dereference: true
  });
  return true;
}

function syncCriticalChromeFiles(sourceDir, targetDir, profileName) {
  const profile = profileName || 'Default';
  const mappings = [
    ['Local State', 'Local State'],
    [path.join(profile, 'Preferences'), path.join(profile, 'Preferences')],
    [path.join(profile, 'Secure Preferences'), path.join(profile, 'Secure Preferences')],
    [path.join(profile, 'Extensions'), path.join(profile, 'Extensions')],
    [path.join(profile, 'Extension State'), path.join(profile, 'Extension State')]
  ];

  for (const [srcRelative, dstRelative] of mappings) {
    const sourcePath = path.join(sourceDir, srcRelative);
    const targetPath = path.join(targetDir, dstRelative);
    copyPathIfExists(sourcePath, targetPath);
  }
}

function inspectProfileExtensionsState(userDataDir, profileName = 'Default') {
  const profile = profileName || 'Default';
  const extensionsDir = path.join(userDataDir, profile, 'Extensions');
  const preferencesPath = path.join(userDataDir, profile, 'Preferences');
  const localSettingsRoot = path.join(userDataDir, profile, 'Local Extension Settings');

  let preferencesRaw = '';
  let preferencesSettings = {};
  try {
    preferencesRaw = fs.readFileSync(preferencesPath, 'utf-8');
    const parsed = JSON.parse(preferencesRaw);
    preferencesSettings = parsed?.extensions?.settings || {};
  } catch {}

  const checkExtension = extensionId => {
    const dir = fs.existsSync(path.join(extensionsDir, extensionId));
    const prefs = Boolean(preferencesSettings && preferencesSettings[extensionId]);
    const localSettings = fs.existsSync(path.join(localSettingsRoot, extensionId));
    return { dir, prefs: prefs || localSettings, localSettings };
  };

  return {
    profile,
    preferencesPath,
    extensionsDir,
    preferencesSize: preferencesRaw.length || 0,
    keepa: checkExtension(MARKETPLACE_EXTENSION_IDS.keepa),
    azInsight: checkExtension(MARKETPLACE_EXTENSION_IDS.azInsight)
  };
}

function syncChromeProfileSnapshot(sourceDir, targetDir, profileName) {
  if (!sourceDir || !fs.existsSync(sourceDir)) return null;

  ensureDir(targetDir);

  const rsyncArgs = [
    '-a',
    '--delete',
    '--exclude=Singleton*',
    '--exclude=DevToolsActivePort',
    '--exclude=BrowserMetrics*',
    '--exclude=Crashpad',
    '--exclude=ShaderCache',
    '--exclude=GrShaderCache',
    '--exclude=GraphiteDawnCache',
    '--exclude=Code Cache',
    '--exclude=GPUCache',
    '--exclude=Cache',
    '--exclude=Default/Cache',
    '--exclude=Default/Code Cache',
    '--exclude=Default/GPUCache',
    '--exclude=Default/Service Worker/CacheStorage',
    '--exclude=Default/Service Worker/ScriptCache',
    '--exclude=Default/DawnGraphiteCache',
    '--exclude=Default/Session Storage',
    '--exclude=Default/Sessions',
    `${sourceDir.replace(/\/+$/, '')}/`,
    `${targetDir.replace(/\/+$/, '')}/`
  ];

  const rsyncResult = spawnSync('rsync', rsyncArgs, {
    encoding: 'utf-8'
  });

  if (rsyncResult.status !== 0) {
    log.warn(`Falha ao clonar perfil via rsync: ${rsyncResult.stderr || rsyncResult.stdout || 'erro desconhecido'}`);
    removeIfExists(targetDir);
    ensureDir(targetDir);
    fs.cpSync(sourceDir, targetDir, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  }

  syncCriticalChromeFiles(sourceDir, targetDir, profileName);
  cleanupChromeLockFiles(targetDir);
  cleanupChromeLockFiles(path.join(targetDir, profileName || 'Default'));
  return targetDir;
}

export async function preparePage(page) {
  if (!page) return;

  await page.setUserAgent(DEFAULT_USER_AGENT);
  await page.setExtraHTTPHeaders({
    'accept-language': 'en-US,en;q=0.9'
  });

  attachAzInsightResponseWatcher(page);
}

function attachAzInsightResponseWatcher(page) {
  if (!page || page.__azInsightWatcherAttached) return;
  page.__azInsightWatcherAttached = true;
  page.__azInsightAuthIssue = null;

  page.on('response', async response => {
    try {
      const url = response.url();
      if (!/azinsight|asinzen|srvasinzen/i.test(url)) return;
      const type = response.request().resourceType();
      if (type !== 'xhr' && type !== 'fetch') return;

      const status = response.status();
      if (status === 401 || status === 403) {
        page.__azInsightAuthIssue = { url, status, bodySample: `http_${status}` };
        return;
      }

      const body = await response.text();
      if (!body) return;

      if (
        /unauthorized/i.test(body) ||
        /\"message\"\s*:\s*\"unauthorized\"/i.test(body) ||
        /\\"unauthorized\\"/i.test(body)
      ) {
        page.__azInsightAuthIssue = {
          url,
          status,
          bodySample: body.slice(0, 240)
        };
      }
    } catch {}
  });
}

async function resolveBestAzInsightFrame(page) {
  let bestFrame = null;
  let bestScore = 0;
  for (const frame of page.frames()) {
    try {
      let score = await frame.evaluate((sels) => {
        let max = 0;
        for (const sel of sels) {
          let nodes = [];
          try {
            nodes = Array.from(document.querySelectorAll(sel));
          } catch {
            nodes = [];
          }
          for (const el of nodes) {
            const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const rect = el.getBoundingClientRect();
            const visible = rect.width > 140 && rect.height > 100;
            if (!visible) continue;
            const hasSignature =
              text.includes('supplier tracker') ||
              /buy\s*cost|purchase\s*cost|custo/.test(text) ||
              /sell price based on roi|sell price based on profit/.test(text) ||
              (/\bfbm\b/.test(text) && /\bfba\b/.test(text));
            if (!hasSignature) continue;
            const inputCount = Array.from(el.querySelectorAll('input, textarea')).filter(input => {
              const inputRect = input.getBoundingClientRect();
              return inputRect.width > 10 && inputRect.height > 10;
            }).length;
            if (text.length < 24 && inputCount === 0) continue;
            let s = inputCount * 4;
            if (text.includes('supplier tracker')) s += 25;
            if (text.includes('buy cost') || text.includes('purchase')) s += 18;
            if (text.includes('fba')) s += 12;
            if (text.includes('profit') || text.includes('roi') || text.includes('margin')) s += 10;
            if (text.includes('lucro') || text.includes('margem')) s += 10;
            if (inputCount >= 4) s += 14;
            if (inputCount >= 6) s += 18;
            if (s > max) max = s;
          }
        }
        return max;
      }, AZINSIGHT_ROOT_SELECTORS);
      const frameUrl = String(frame.url() || '').toLowerCase();
      if (frameUrl.includes(`chrome-extension://${MARKETPLACE_EXTENSION_IDS.azInsight}`)) {
        score += 120;
      } else if (frameUrl.includes('azinsight') || frameUrl.includes('asinzen')) {
        score += 40;
      } else if (frame === page.mainFrame()) {
        score += 5;
      }
      if (score > bestScore) {
        bestScore = score;
        bestFrame = frame;
      }
    } catch {
      continue;
    }
  }
  return bestScore >= 18 ? bestFrame : null;
}

async function scrollAzInsightPanelIntoView(frame) {
  if (!frame) return;
  await frame.evaluate((sels) => {
    let best = null;
    let bestScore = -1;
    for (const sel of sels) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(sel));
      } catch {
        nodes = [];
      }
      for (const el of nodes) {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const inputCount = Array.from(el.querySelectorAll('input, textarea')).filter(input => {
          const rect = input.getBoundingClientRect();
          return rect.width > 10 && rect.height > 10;
        }).length;
        let s = inputCount * 3;
        if (text.includes('supplier tracker')) s += 12;
        if (text.includes('buy cost')) s += 12;
        if (text.includes('fba')) s += 6;
        if (s > bestScore) {
          bestScore = s;
          best = el;
        }
      }
    }
    best?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, AZINSIGHT_ROOT_SELECTORS).catch(() => null);
}

async function isAzInsightCalculatorReadyOnFrame(frame) {
  if (!frame) return false;
  return frame.evaluate((sels) => {
    const candidates = [];
    for (const sel of sels) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(sel));
      } catch {
        nodes = [];
      }
      for (const el of nodes) {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 140 && rect.height > 100;
        if (!visible) continue;
        const hasSignature =
          text.includes('supplier tracker') ||
          /buy\s*cost|purchase\s*cost|custo/.test(text) ||
          /sell price based on roi|sell price based on profit/.test(text) ||
          (/\bfbm\b/.test(text) && /\bfba\b/.test(text));
        if (!hasSignature) continue;
        const inputs = Array.from(el.querySelectorAll('input, textarea')).filter(input => {
          const inputRect = input.getBoundingClientRect();
          return inputRect.width > 10 && inputRect.height > 10;
        });
        if (text.length < 24 && inputs.length === 0) continue;
        let score = inputs.length * 3;
        if (text.includes('supplier tracker')) score += 10;
        if (text.includes('buy cost')) score += 10;
        if (text.includes('fba')) score += 4;
        candidates.push({ text, inputs, score });
      }
    }
    if (!candidates.length) return false;
    return candidates.some(candidate => {
      const text = candidate.text || '';
      const inputs = candidate.inputs || [];
      const strictReady =
        text.includes('supplier tracker') &&
        text.includes('buy cost') &&
        text.includes('fba') &&
        inputs.length >= 2;
      if (strictReady) return true;
      const hasBuy = /buy\s*cost|purchase\s*cost|custo/.test(text);
      const hasFba = /\bfba\b|fulfillment|referral/.test(text);
      const hasOfferColumns = /\bfbm\b/.test(text) && /\bfba\b/.test(text);
      const hasCalcControls =
        /sell price based on roi|sell price based on profit/.test(text);
      const hasProfitUi =
        /(profit|lucro|roi|margin|margem)/.test(text) &&
        (/[0-9.]+\s*%/.test(text) || /\$\s*[0-9]/.test(text));
      if (inputs.length >= 2 && hasBuy && hasFba) return true;
      if (hasBuy && (hasCalcControls || hasOfferColumns)) return true;
      if (inputs.length >= 3 && hasBuy && hasProfitUi) return true;
      if (inputs.length >= 4 && hasProfitUi) return true;
      if (inputs.length >= 6 && hasBuy) return true;
      return false;
    });
  }, AZINSIGHT_ROOT_SELECTORS).catch(() => false);
}

async function resolveAzInsightFrameOrMain(page) {
  const extensionFrame = page.frames().find(frame => {
    const frameUrl = String(frame.url() || '').toLowerCase();
    return frameUrl.includes(`chrome-extension://${MARKETPLACE_EXTENSION_IDS.azInsight}`);
  });
  if (extensionFrame) return extensionFrame;
  const hit = await resolveBestAzInsightFrame(page);
  return hit || page.mainFrame();
}

async function clickAzInsightRefreshControl(frame) {
  if (!frame) return false;
  return frame.evaluate((sels) => {
    const roots = [];
    for (const sel of sels) {
      try {
        roots.push(...Array.from(document.querySelectorAll(sel)));
      } catch {
        continue;
      }
    }
    const root = roots[0] || document;
    const candidates = Array.from(root.querySelectorAll('button, [role="button"], .icon, i'))
      .filter(el => {
        const label = [
          el.getAttribute?.('aria-label'),
          el.getAttribute?.('title'),
          el.className,
          el.id,
          el.textContent
        ].filter(Boolean).join(' ').toLowerCase();
        return /refresh|reload|recarregar|atualizar/.test(label);
      });
    if (!candidates.length) return false;
    candidates[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }, AZINSIGHT_ROOT_SELECTORS).catch(() => false);
}

async function getAzInsightPanelSnapshot(frame) {
  if (!frame) {
    return {
      panelDetected: false,
      calculatorReady: false,
      loading: false,
      loginRequired: false,
      inputCount: 0,
      textSample: '',
      metricsVisible: false
    };
  }

  return frame.evaluate((sels) => {
    const roots = [];
    for (const sel of sels) {
      try {
        roots.push(...Array.from(document.querySelectorAll(sel)));
      } catch {
        continue;
      }
    }

    const best = roots
      .map(el => {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        const lower = text.toLowerCase();
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 140 && rect.height > 100;
        if (!visible) return { score: -1, text: '', inputCount: 0 };
        const hasSignature =
          lower.includes('supplier tracker') ||
          /buy\s*cost|purchase\s*cost|custo/.test(lower) ||
          /sell price based on roi|sell price based on profit/.test(lower) ||
          (/\bfbm\b/.test(lower) && /\bfba\b/.test(lower));
        if (!hasSignature) return { score: -1, text: '', inputCount: 0 };
        const inputCount = Array.from(el.querySelectorAll('input, textarea')).filter(input => {
          const inputRect = input.getBoundingClientRect();
          return inputRect.width > 10 && inputRect.height > 10;
        }).length;
        if (text.length < 24 && inputCount === 0) return { score: -1, text: '', inputCount: 0 };
        let score = inputCount * 3;
        if (lower.includes('supplier tracker')) score += 12;
        if (lower.includes('buy cost') || lower.includes('purchase')) score += 10;
        if (lower.includes('fba')) score += 5;
        if (/(profit|roi|margin|lucro|margem)/.test(lower)) score += 4;
        return { score, text, inputCount };
      })
      .sort((a, b) => b.score - a.score)[0] || { score: -1, text: '', inputCount: 0 };

    const text = String(best.text || '');
    const lower = text.toLowerCase();
    const metricsVisible =
      (/\$\s*[0-9]/.test(text) || /-?[0-9]+(?:[.,][0-9]+)?\s*%/.test(text)) &&
      /(profit|roi|margin|lucro|margem|fba)/i.test(text);
    const loginRequired =
      /(sign in|log in|login|unauthorized|assinatura|subscription|upgrade plan|trial expired)/i.test(text);
    const loading =
      /(sales data is loading|hold tight|carregando|loading)/i.test(lower) &&
      !metricsVisible;
    const calculatorReady =
      lower.includes('supplier tracker') &&
      (lower.includes('buy cost') || lower.includes('purchase cost') || lower.includes('custo')) &&
      best.inputCount >= 2 &&
      (metricsVisible || /\bfba\b/.test(lower));

    return {
      panelDetected: best.score >= 0,
      calculatorReady,
      loading,
      loginRequired,
      inputCount: best.inputCount || 0,
      textSample: text.slice(0, 600),
      metricsVisible
    };
  }, AZINSIGHT_ROOT_SELECTORS).catch(() => ({
    panelDetected: false,
    calculatorReady: false,
    loading: false,
    loginRequired: false,
    inputCount: 0,
    textSample: '',
    metricsVisible: false
  }));
}

async function waitForAzInsightSnapshot(frame, timeoutMs) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  let lastSnapshot = await getAzInsightPanelSnapshot(frame);
  while (Date.now() < deadline) {
    if (lastSnapshot.calculatorReady || lastSnapshot.loginRequired) break;
    await sleep(700);
    lastSnapshot = await getAzInsightPanelSnapshot(frame);
  }
  return lastSnapshot;
}

async function resolveCurrentAmazonAsin(page) {
  const fromUrl = String(page?.url?.() || '').match(/\/dp\/([A-Z0-9]{10})/i)?.[1];
  if (fromUrl) return fromUrl.toUpperCase();
  try {
    const fromDom = await page.evaluate(() => {
      const value = document.querySelector('#ASIN, input[name="ASIN"]')?.value || '';
      return String(value || '').trim();
    });
    if (/^[A-Z0-9]{10}$/i.test(fromDom)) return fromDom.toUpperCase();
  } catch {}
  return null;
}

export async function recoverAzInsightCalculator(page, options = {}) {
  const allowReload = options.allowReload !== false;
  const context = options.context || 'runtime';
  const settleMs = Number(options.settleMs || process.env.FBA_AZINSIGHT_RECOVERY_SETTLE_MS || 2200);
  const waitAfterActionMs = Number(options.waitAfterActionMs || process.env.FBA_AZINSIGHT_RECOVERY_WAIT_MS || 12000);
  const result = {
    context,
    recovered: false,
    authIssue: page?.__azInsightAuthIssue || null,
    initial: null,
    final: null,
    attempts: []
  };

  let frame = await resolveAzInsightFrameOrMain(page);
  await scrollAzInsightPanelIntoView(frame);
  await sleep(Math.max(700, settleMs));
  result.initial = await getAzInsightPanelSnapshot(frame);

  if (result.authIssue || result.initial.loginRequired) {
    result.final = result.initial;
    return result;
  }

  if (result.initial.calculatorReady) {
    result.recovered = true;
    result.final = result.initial;
    return result;
  }

  const refreshed = await clickAzInsightRefreshControl(frame);
  result.attempts.push({
    action: 'panel-refresh',
    executed: true,
    success: refreshed
  });
  if (refreshed) {
    await sleep(Math.max(1200, settleMs));
    const afterRefresh = await waitForAzInsightSnapshot(frame, waitAfterActionMs);
    if (afterRefresh.calculatorReady || afterRefresh.loginRequired) {
      result.recovered = afterRefresh.calculatorReady;
      result.final = afterRefresh;
      return result;
    }
  }

  if (allowReload) {
    let reloadOk = false;
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);
      await dismissCommonOverlays(page);
      reloadOk = true;
    } catch (error) {
      result.attempts.push({
        action: 'page-reload',
        executed: true,
        success: false,
        error: error.message
      });
    }

    if (reloadOk) {
      result.attempts.push({
        action: 'page-reload',
        executed: true,
        success: true
      });
      frame = await resolveAzInsightFrameOrMain(page);
      await scrollAzInsightPanelIntoView(frame);
      await sleep(Math.max(1200, settleMs));
      const afterReload = await waitForAzInsightSnapshot(frame, waitAfterActionMs);
      if (afterReload.calculatorReady || afterReload.loginRequired) {
        result.recovered = afterReload.calculatorReady;
        result.final = afterReload;
        return result;
      }
    }
  }

  const asin = await resolveCurrentAmazonAsin(page);
  if (asin) {
    const canonicalUrl = `https://www.amazon.com/dp/${asin}`;
    let canonicalOk = false;
    try {
      await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);
      await dismissCommonOverlays(page);
      canonicalOk = true;
    } catch (error) {
      result.attempts.push({
        action: 'open-canonical-dp',
        executed: true,
        success: false,
        asin,
        error: error.message
      });
    }

    if (canonicalOk) {
      result.attempts.push({
        action: 'open-canonical-dp',
        executed: true,
        success: true,
        asin
      });
      frame = await resolveAzInsightFrameOrMain(page);
      await scrollAzInsightPanelIntoView(frame);
      await sleep(Math.max(1200, settleMs));
      const afterCanonical = await waitForAzInsightSnapshot(frame, waitAfterActionMs);
      if (afterCanonical.calculatorReady || afterCanonical.loginRequired) {
        result.recovered = afterCanonical.calculatorReady;
        result.final = afterCanonical;
        return result;
      }
    }
  }

  result.final = await getAzInsightPanelSnapshot(frame);
  return result;
}

async function dismissCommonOverlays(page) {
  if (!page || page.isClosed()) return;

  try {
    const result = await page.evaluate(() => {
      const patterns = [
        'accept',
        'accept all',
        'allow all',
        'agree',
        'got it',
        'continue',
        'ok',
        'aceitar',
        'aceitar tudo',
        'aceito',
        'concordo',
        'entendi',
        'fechar'
      ];

      const matchesPattern = value => {
        const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return patterns.some(pattern => text === pattern || text.startsWith(`${pattern} `));
      };

      const clicked = [];
      const clickSelectors = [
        '#onetrust-accept-btn-handler',
        '.onetrust-close-btn-handler',
        '[aria-label*="cookie" i]',
        '[aria-label*="consent" i]',
        '[id*="cookie"] button',
        '[class*="cookie"] button',
        '[id*="consent"] button',
        '[class*="consent"] button',
        '[id*="gdpr"] button',
        '[class*="gdpr"] button',
        '[data-testid*="cookie"] button',
        '[data-testid*="consent"] button'
      ];

      for (const selector of clickSelectors) {
        for (const element of document.querySelectorAll(selector)) {
          if (!(element instanceof HTMLElement)) continue;
          const label = [
            element.innerText,
            element.getAttribute('value'),
            element.getAttribute('aria-label'),
            element.getAttribute('title')
          ].find(Boolean);
          if (!matchesPattern(label)) continue;
          element.click();
          clicked.push(label.trim());
        }
      }

      const overlaySelectors = [
        '[id*="cookie"][role="dialog"]',
        '[class*="cookie"][role="dialog"]',
        '[id*="consent"][role="dialog"]',
        '[class*="consent"][role="dialog"]',
        '#onetrust-banner-sdk',
        '.onetrust-pc-dark-filter',
        '.cc-window',
        '.cookie-banner'
      ];

      let hidden = 0;
      for (const selector of overlaySelectors) {
        for (const element of document.querySelectorAll(selector)) {
          if (!(element instanceof HTMLElement)) continue;
          element.style.setProperty('display', 'none', 'important');
          element.style.setProperty('visibility', 'hidden', 'important');
          element.style.setProperty('pointer-events', 'none', 'important');
          hidden += 1;
        }
      }

      return { clicked, hidden };
    });

    if (result.clicked.length || result.hidden) {
      log.info(
        `Overlay tratado automaticamente: ${result.clicked.length} clique(s), ${result.hidden} bloqueio(s) ocultado(s).`
      );
    }
  } catch (error) {
    log.debug(`Falha ao tratar overlay: ${error.message}`);
  }
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

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTokenText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenizeValue(value) {
  return normalizeTokenText(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !RECOVERY_STOPWORDS.has(token));
}

function stripTrailingSellerSuffix(productName) {
  const raw = normalizeText(productName);
  if (!raw.includes(' - ')) return raw;

  const parts = raw.split(/\s+-\s+/);
  const tail = parts.at(-1) || '';
  const tailWords = tail.split(/\s+/).filter(Boolean);
  if (tailWords.length <= 4 && !/\d/.test(tail)) {
    return parts.slice(0, -1).join(' - ').trim();
  }

  return raw;
}

function absolutizeUrl(rawUrl, baseUrl) {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return String(rawUrl).trim();
  }
}

function inspectHtmlAccess(html, source = 'page', currentUrl = '') {
  const $ = cheerio.load(html || '');
  const title = normalizeText($('title').first().text());
  const bodyText = normalizeText($('body').text()).slice(0, 5000);
  const text = `${title} ${bodyText}`.toLowerCase();
  const hasRecaptcha = $('.g-recaptcha, iframe[src*="recaptcha"], [name="g-recaptcha-response"]').length > 0;
  const hasAmazonCaptcha = $('#captchacharacters').length > 0;
  const hasCloudflareChallenge = $(
    '#challenge-running, #cf-challenge-running, .cf-browser-verification, ' +
    '[name="cf-turnstile-response"], iframe[src*="challenges.cloudflare.com"]'
  ).length > 0;
  const hasProductTitle = $(
    'h1, .productView-title, .product__title, .product-title, [itemprop="name"], [data-product-title]'
  ).length > 0;
  const hasProductPrice = $(
    'meta[property="product:price:amount"], meta[itemprop="price"], [itemprop="price"], ' +
    '.productView-price, .product__price, .product-price, .price .money, .money'
  ).length > 0;
  const hasAddToCart = $(
    'input[value*="Add to Cart"], button[id*="add"], button[name*="add"], form[action*="cart"] [type="submit"]'
  ).length > 0;
  const hasSearchResults = $('[data-component-type="s-search-result"]').length > 0;
  const hasReviewRecaptcha = $(
    'form[action*="review"] .g-recaptcha, form[action*="post_review"] .g-recaptcha, ' +
    '.productReview-form .g-recaptcha, [id*="modal-review-form"] .g-recaptcha'
  ).length > 0;
  const hasStrongContentSignals = Boolean(
    hasProductTitle || hasProductPrice || hasAddToCart || hasSearchResults
  );
  const hasCommerceSignals = Boolean(hasProductPrice || hasAddToCart || hasSearchResults);

  const snapshot = {
    title,
    url: currentUrl,
    bodyText
  };

  if (hasAmazonCaptcha || text.includes('enter the characters you see below')) {
    return buildAccessIssue(source, snapshot, 'captcha', 'CAPTCHA detectado na página');
  }

  if (
    hasCloudflareChallenge ||
    text.includes('verify you are human') ||
    text.includes('checking if the site connection is secure') ||
    text.includes('attention required')
  ) {
    return buildAccessIssue(source, snapshot, 'challenge', 'Desafio anti-bot detectado');
  }

  if (
    hasRecaptcha &&
    !hasReviewRecaptcha &&
    !hasStrongContentSignals &&
    (
      text.includes('g-recaptcha') ||
      text.includes('i am human') ||
      text.includes('verify you are human') ||
      text.includes('robot or human')
    )
  ) {
    return buildAccessIssue(source, snapshot, 'captcha', 'reCAPTCHA detectado na página');
  }

  if (
    !hasCommerceSignals &&
    (
      /\b404\b/.test(title.toLowerCase()) ||
      title.toLowerCase().includes('page not found') ||
      /\b404\b/.test(text) ||
      text.includes('page not found') ||
      text.includes('the page can’t be found') ||
      text.includes("the page can't be found") ||
      text.includes('requested url was not found')
    )
  ) {
    return buildAccessIssue(source, snapshot, 'not_found', 'Página do fornecedor não encontrada');
  }

  if (
    (!hasStrongContentSignals && text.includes('your connection needs to be verified')) ||
    (!hasStrongContentSignals && text.includes('access denied')) ||
    (!hasStrongContentSignals && text.includes('temporarily blocked')) ||
    (!hasStrongContentSignals && text.includes('unusual traffic')) ||
    (!hasStrongContentSignals && text.includes('robot or human'))
  ) {
    return buildAccessIssue(source, snapshot, 'blocked', 'Acesso bloqueado pelo site');
  }

  return null;
}

function looksLikeProductishUrl(candidateUrl) {
  const lower = String(candidateUrl || '').toLowerCase();

  if (
    lower.includes('/about') ||
    lower.includes('/contact') ||
    lower.includes('/privacy') ||
    lower.includes('/policy') ||
    lower.includes('/terms') ||
    lower.includes('/shipping') ||
    lower.includes('/refund') ||
    lower.includes('/feed') ||
    lower.includes('/comments') ||
    lower.includes('wp-content') ||
    lower.includes('wp-json')
  ) {
    return false;
  }

  return (
    lower.includes('/products/') ||
    lower.includes('/product/') ||
    lower.includes('/catalog/product/') ||
    lower.includes('/dp/') ||
    lower.endsWith('.html') ||
    lower.endsWith('/')
  );
}

function buildSupplierRecoveryQueries({ productName, productCodeVariants = [] } = {}) {
  const queries = new Set();
  const strippedName = stripTrailingSellerSuffix(productName);
  const nameTokens = tokenizeValue(strippedName);

  if (strippedName) queries.add(strippedName);
  if (nameTokens.length) {
    queries.add(nameTokens.slice(0, 8).join(' '));
    queries.add(nameTokens.slice(0, 5).join(' '));
  }

  for (const code of productCodeVariants || []) {
    const cleaned = String(code || '').trim();
    if (cleaned && cleaned.length >= 6) queries.add(cleaned);
  }

  return [...queries]
    .map(item => normalizeText(item))
    .filter(Boolean)
    .slice(0, 3);
}

function buildSupplierRecoveryOrigins(supplierUrl, origin) {
  const origins = new Set([origin]);

  try {
    const parsed = new URL(supplierUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'bossenimp.com') {
      origins.add(`${parsed.protocol}//www.bossenimp.com`);
    }

    if (hostname === 'www.bossenimp.com') {
      origins.add(`${parsed.protocol}//bossenimp.com`);
    }
  } catch {}

  return [...origins];
}

function buildSupplierRecoverySearchUrls(supplierUrl, origin, query) {
  const lowerUrl = String(supplierUrl || '').toLowerCase();
  const encoded = encodeURIComponent(query);
  const origins = buildSupplierRecoveryOrigins(supplierUrl, origin);
  const urls = [];

  const addUrl = candidate => {
    if (!candidate || urls.includes(candidate)) return;
    urls.push(candidate);
  };

  if (lowerUrl.includes('/catalog/product/') || lowerUrl.includes('/index.php/')) {
    for (const searchOrigin of origins) {
      addUrl(`${searchOrigin}/index.php/catalogsearch/result/?q=${encoded}`);
      addUrl(`${searchOrigin}/catalogsearch/result/?q=${encoded}`);
    }
    return urls;
  }

  if (lowerUrl.includes('/products/')) {
    for (const searchOrigin of origins) {
      addUrl(`${searchOrigin}/search?q=${encoded}&type=product`);
      addUrl(`${searchOrigin}/search?type=product&q=${encoded}`);
    }
    return urls;
  }

  if (lowerUrl.includes('/product/')) {
    for (const searchOrigin of origins) {
      addUrl(`${searchOrigin}/?s=${encoded}&post_type=product`);
      addUrl(`${searchOrigin}/search?q=${encoded}`);
    }
    return urls;
  }

  for (const searchOrigin of origins) {
    addUrl(`${searchOrigin}/search?q=${encoded}`);
    addUrl(`${searchOrigin}/?s=${encoded}&post_type=product`);
  }

  return urls;
}

function scoreRecoveryCandidate(candidate, productName, productCodeVariants = []) {
  const normalizedName = normalizeTokenText(productName);
  const haystack = normalizeTokenText(`${candidate.text} ${candidate.href}`);
  const productTokens = tokenizeValue(productName);

  let score = 0;

  if (normalizedName && haystack.includes(normalizedName)) {
    score += 12;
  }

  for (const token of productTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 5 ? 2 : 1;
    }
  }

  for (const code of productCodeVariants || []) {
    const cleaned = String(code || '').trim();
    if (cleaned && haystack.includes(cleaned.toLowerCase())) {
      score += 8;
    }
  }

  if (looksLikeProductishUrl(candidate.href)) score += 3;
  if (!candidate.text) score -= 2;
  if (candidate.href.includes('catalogsearch')) score -= 4;

  return score;
}

function extractRecoveryCandidates(html, baseUrl, productName, productCodeVariants = []) {
  const $ = cheerio.load(html || '');
  const seen = new Set();
  const baseOrigin = new URL(baseUrl).origin;
  const candidates = [];

  $('a[href]').each((_, element) => {
    const href = absolutizeUrl($(element).attr('href'), baseUrl);
    if (!href || seen.has(href)) return;

    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      return;
    }

    if (parsed.origin !== baseOrigin) return;
    if (!looksLikeProductishUrl(href)) return;

    const text = normalizeText($(element).text());
    const score = scoreRecoveryCandidate({ href, text }, productName, productCodeVariants);
    if (score < 5) return;

    seen.add(href);
    candidates.push({ href, text, score });
  });

  return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
}

async function findRecoveredSupplierUrl(supplierUrl, options = {}) {
  const { productName, productCodeVariants = [] } = options;
  if (!productName) return null;

  let origin;
  try {
    origin = new URL(supplierUrl).origin;
  } catch {
    return null;
  }

  const queries = buildSupplierRecoveryQueries({ productName, productCodeVariants });
  for (const query of queries) {
    const searchUrls = buildSupplierRecoverySearchUrls(supplierUrl, origin, query);

    for (const searchUrl of searchUrls) {
      try {
        const response = await fetch(searchUrl, {
          headers: {
            'user-agent': DEFAULT_USER_AGENT,
            'accept-language': 'en-US,en;q=0.9',
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(8000)
        });

        const html = await response.text();
        const finalUrl = response.url || searchUrl;
        const accessIssue = inspectHtmlAccess(html, 'supplier-search', finalUrl);
        if (accessIssue && accessIssue.type !== 'not_found') continue;

        const candidates = extractRecoveryCandidates(html, finalUrl, productName, productCodeVariants);
        const best = candidates[0] || null;
        if (!best) continue;

        log.info(`URL do fornecedor recuperada por busca interna (${query}): ${best.href}`);
        return {
          recoveredUrl: best.href,
          searchUrl: finalUrl,
          query,
          score: best.score
        };
      } catch (error) {
        log.debug(`Falha na busca interna do fornecedor (${query}): ${error.message}`);
      }
    }
  }

  return null;
}

function extractSupplierDataFromHtml(html, pageUrl) {
  const $ = cheerio.load(html || '');
  const titleSelectors = [
    'h1',
    '.productView-title',
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
    '.productView-price',
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

  const getFirstText = selectors => {
    for (const selector of selectors) {
      const text = normalizeText($(selector).first().text());
      if (text) return text;
    }
    return null;
  };

  const getFirstAttr = (selectors, attrs = ['content', 'value']) => {
    for (const selector of selectors) {
      const element = $(selector).first();
      if (!element.length) continue;
      for (const attr of attrs) {
        const value = normalizeText(element.attr(attr));
        if (value) return value;
      }
    }
    return null;
  };

  const collectPriceCandidates = (selectors, candidateType) => {
    const candidates = [];
    for (const selector of selectors) {
      $(selector).slice(0, 20).each((_, el) => {
        const element = $(el);
        const context = `${selector} ${element.attr('class') || ''} ${element.attr('id') || ''}`.toLowerCase();
        if (
          candidateType === 'current' &&
          /(compare|was|save|old|original|msrp|list|strike|before)/.test(context)
        ) {
          return;
        }

        const raw = normalizeText(
          element.attr('content') ||
          element.attr('data-price') ||
          element.attr('value') ||
          element.text()
        );
        if (!raw) return;

        const parsed = normalizePrice(raw);
        if (parsed === null) return;

        candidates.push({
          value: parsed,
          text: raw.slice(0, 120),
          source: selector,
          context: context.slice(0, 120)
        });
      });
    }
    return candidates;
  };

  const currentCandidates = collectPriceCandidates(currentPriceSelectors, 'current');
  const previousCandidates = collectPriceCandidates(previousPriceSelectors, 'previous');
  const current = currentCandidates.find(candidate => candidate.value > 0) || null;
  const previous = previousCandidates.find(candidate => candidate.value > 0) || null;

  const addToCartElement = $(
    '#form-action-addToCart, input[value*="Add to Cart"], button[value*="Add to Cart"], form[action*="cart"] [type="submit"]'
  ).first();
  const hasEnabledAddToCart = Boolean(
    addToCartElement.length &&
    !addToCartElement.attr('disabled') &&
    addToCartElement.attr('aria-disabled') !== 'true'
  );

  const availabilityMetaValue = normalizeText(
    $('meta[itemprop="availability"], link[itemprop="availability"]').first().attr('content') ||
    $('meta[itemprop="availability"], link[itemprop="availability"]').first().attr('href')
  ).toLowerCase();
  const availabilityText = normalizeText([
    getFirstText(['[data-availability]', '[class*="availability"]', '[id*="availability"]']),
    getFirstText(['[data-stock]', '[class*="stock"]', '[id*="stock"]'])
  ].filter(Boolean).join(' '));
  const availabilityCorpus = `${availabilityMetaValue} ${availabilityText}`.toLowerCase();

  let availabilityStatus = 'unknown';
  let available = null;
  if (hasEnabledAddToCart) {
    availabilityStatus = 'in_stock';
    available = true;
  } else if (/outofstock|out of stock|sold out|currently unavailable|backorder/.test(availabilityCorpus)) {
    availabilityStatus = 'out_of_stock';
    available = false;
  } else if (/preorder|pre-order|pre order/.test(availabilityCorpus)) {
    availabilityStatus = 'preorder';
    available = true;
  } else if (/instock|in stock|available to ship|ships in/.test(availabilityCorpus)) {
    availabilityStatus = 'in_stock';
    available = true;
  }

  const title = getFirstText(titleSelectors) || normalizeText($('title').first().text());
  const brand = normalizeText(
    getFirstText(['[itemprop="brand"]', '[data-brand]', '[class*="brand"]']) ||
    getFirstAttr(['meta[property="product:brand"]', 'meta[name="brand"]', 'meta[property="og:brand"]']) ||
    $('meta[property="og:site_name"]').first().attr('content')
  );
  const category = $('nav.breadcrumb a, .breadcrumb a, [aria-label*="breadcrumb"] a')
    .toArray()
    .map(el => normalizeText($(el).text()))
    .filter(Boolean)
    .join(' > ');
  const imageUrl = absolutizeUrl(
    $('meta[property="og:image"]').first().attr('content') ||
    $('img[itemprop="image"]').first().attr('src') ||
    $('[data-product-image] img').first().attr('src') ||
    $('img[src*="product"]').first().attr('src'),
    pageUrl
  );

  return {
    title,
    price: current ? current.value : null,
    priceCurrent: current ? current.value : null,
    priceCurrentText: current ? current.text : '',
    pricePrevious: previous ? previous.value : null,
    pricePreviousText: previous ? previous.text : '',
    priceSource: current ? current.source : '',
    priceConfidence: current ? 'high' : 'none',
    priceStatus: current ? 'ok' : 'missing',
    available,
    availabilityStatus,
    availabilityText: availabilityText.slice(0, 200),
    sku: normalizeText(getFirstText(['[itemprop="sku"]', '[data-sku]', '[class*="sku"]', '[id*="sku"]'])),
    brand,
    category,
    imageUrl,
    extractionDiagnostics: {
      currentCandidatesFound: currentCandidates.length,
      previousCandidatesFound: previousCandidates.length
    },
    url: pageUrl
  };
}

export async function fetchSupplierDataFallback(supplierUrl) {
  try {
    const response = await fetch(supplierUrl, {
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
        'accept-language': 'en-US,en;q=0.9',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });

    const html = await response.text();
    const finalUrl = response.url || supplierUrl;
    const accessIssue = inspectHtmlAccess(html, 'supplier-http', finalUrl);
    if (accessIssue) {
      return { error: accessIssue.type, accessIssue, supplier: null, finalUrl };
    }

    const supplier = extractSupplierDataFromHtml(html, finalUrl);
    return { error: null, accessIssue: null, supplier, finalUrl, fetchedVia: 'http-fallback' };
  } catch (error) {
    return {
      error: 'http-fallback',
      accessIssue: {
        source: 'supplier-http',
        type: 'http-fallback',
        reason: `Falha no fallback HTTP do fornecedor: ${error.message}`,
        title: '',
        url: supplierUrl,
        excerpt: ''
      },
      supplier: null,
      finalUrl: supplierUrl
    };
  }
}

async function navigate(page, url, label) {
  let lastError = null;

  for (const attempt of NAVIGATION_ATTEMPTS) {
    try {
      await page.goto(url, { waitUntil: attempt.waitUntil, timeout: attempt.timeout });
      await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);
      await dismissCommonOverlays(page);
      await page.waitForNetworkIdle({ idleTime: 750, timeout: 5000 }).catch(() => null);
      if (attempt.settleMs) {
        await new Promise(resolve => setTimeout(resolve, attempt.settleMs));
      }
      log.info(`Navegação ${label} concluída via ${attempt.label}.`);
      return { error: null, accessIssue: null, strategy: attempt.label };
    } catch (err) {
      lastError = err;
      log.warn(`Falha na navegação ${label} via ${attempt.label}: ${err.message}`);
    }
  }

  const accessIssue = {
    source: label,
    type: 'navigation',
    reason: `Falha ao abrir ${label}: ${lastError?.message || 'erro desconhecido'}`,
    title: '',
    url,
    excerpt: ''
  };
  log.error(accessIssue.reason);
  return { error: 'navigation', accessIssue };
}

/**
 * Lança o Chrome com o perfil do usuário que tem Keepa e AZInsight instalados.
 * IMPORTANTE: O Chrome deve estar fechado no servidor antes de lançar com perfil real.
 */
export async function launchBrowser(options = {}) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const headlessMode = resolveHeadlessMode();
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

  if (!hasDisplay && isDisplayRequired()) {
    throw new Error(
      'DISPLAY ausente e FBA_REQUIRE_DISPLAY=true. Inicie o Xvfb antes do Chrome para rodar em modo visual.'
    );
  }

  if (!hasDisplay && !headlessMode) {
    throw new Error('Modo visual solicitado, mas DISPLAY/WAYLAND_DISPLAY não está definido.');
  }

  const launchOptions = {
    headless: headlessMode,
    ignoreDefaultArgs: true,
    protocolTimeout: 180000,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1920,1080',
      '--disable-gpu',
      '--disable-dev-shm-usage'
    ],
    defaultViewport: { width: 1920, height: 1080 },
    ...options
  };

  if (config.chrome.executablePath && fs.existsSync(config.chrome.executablePath)) {
    launchOptions.executablePath = config.chrome.executablePath;
    log.info(`Usando executavel do Chrome: ${config.chrome.executablePath}`);
  } else {
    log.warn('Executavel do Google Chrome nao encontrado. O Puppeteer vai usar o navegador padrao dele.');
  }

  if (headlessMode) {
    launchOptions.args.push('--headless=new');
    log.warn('DISPLAY ausente; iniciando Chrome em modo headless (FBA_HEADLESS=true).');
  } else {
    log.info(`Chrome em modo visual. DISPLAY=${process.env.DISPLAY || process.env.WAYLAND_DISPLAY}`);
  }

  if (config.chrome.userDataDir && fs.existsSync(config.chrome.userDataDir)) {
    let effectiveUserDataDir = config.chrome.userDataDir;
    const chromeProfileName = config.chrome.profile || 'Default';
    const profileStrategy = (process.env.FBA_CHROME_PROFILE_STRATEGY || 'snapshot').trim().toLowerCase();
    const sourceProfileState = inspectProfileExtensionsState(config.chrome.userDataDir, chromeProfileName);
    log.info(
      `Extensoes no perfil fonte (${sourceProfileState.profile}): ` +
      `Keepa[dir=${sourceProfileState.keepa.dir ? 'ok' : 'nao'},prefs=${sourceProfileState.keepa.prefs ? 'ok' : 'nao'}] ` +
      `AZInsight[dir=${sourceProfileState.azInsight.dir ? 'ok' : 'nao'},prefs=${sourceProfileState.azInsight.prefs ? 'ok' : 'nao'}]`
    );

    if (!sourceProfileState.keepa.prefs || !sourceProfileState.azInsight.prefs) {
      log.warn(
        'Perfil fonte do Chrome sem registro completo de Keepa/AZInsight em Preferences. ' +
        'Abra o chrome://extensions no perfil usado pela automação e confirme instalação/ativação.'
      );
    }

    if (launchOptions.executablePath && launchOptions.executablePath.includes('google-chrome')) {
      if (profileStrategy === 'snapshot' || profileStrategy === 'clone') {
        effectiveUserDataDir = syncChromeProfileSnapshot(
          config.chrome.userDataDir,
          CHROME_RUNTIME_PROFILE_DIR,
          chromeProfileName
        ) || effectiveUserDataDir;
        if (effectiveUserDataDir !== config.chrome.userDataDir) {
          log.info(`Usando copia de trabalho do perfil Chrome: ${effectiveUserDataDir}`);
        }
      } else if (parseBooleanFlag(process.env.FBA_CLEAN_CHROME_LOCKS) === true) {
        cleanupChromeLockFiles(effectiveUserDataDir);
        cleanupChromeLockFiles(path.join(effectiveUserDataDir, chromeProfileName));
      }
    }

    launchOptions.userDataDir = effectiveUserDataDir;
    launchOptions.args = removeArg(launchOptions.args, '--user-data-dir=');
    launchOptions.args.push(`--user-data-dir=${effectiveUserDataDir}`);
    launchOptions.args.push(`--profile-directory=${chromeProfileName}`);
    log.info(`Usando perfil Chrome efetivo: ${effectiveUserDataDir} (${chromeProfileName})`);

    const runtimeProfileState = inspectProfileExtensionsState(effectiveUserDataDir, chromeProfileName);
    log.info(
      `Extensoes no perfil runtime (${runtimeProfileState.profile}): ` +
      `Keepa[dir=${runtimeProfileState.keepa.dir ? 'ok' : 'nao'},prefs=${runtimeProfileState.keepa.prefs ? 'ok' : 'nao'}] ` +
      `AZInsight[dir=${runtimeProfileState.azInsight.dir ? 'ok' : 'nao'},prefs=${runtimeProfileState.azInsight.prefs ? 'ok' : 'nao'}]`
    );
  } else {
    log.warn('Perfil Chrome não encontrado. Keepa/AZInsight podem não funcionar.');
  }

  try {
    const useBrowserUrlLaunch = parseBooleanFlag(process.env.FBA_CHROME_BROWSER_URL_LAUNCH) !== false;
    const shouldLaunchViaBrowserUrl = useBrowserUrlLaunch &&
      launchOptions.executablePath &&
      launchOptions.executablePath.includes('google-chrome');
    const browser = shouldLaunchViaBrowserUrl
      ? await launchChromeViaBrowserUrl(launchOptions)
      : await puppeteer.launch(launchOptions);
    log.info('Browser lançado com sucesso.');
    return browser;
  } catch (error) {
    const message = String(error?.message || '');
    if (
      message.includes('The browser is already running for') ||
      (message.includes('Failed to create') && message.includes('Singleton')) ||
      message.includes('profile appears to be in use')
    ) {
      throw new Error(
        'O Chrome real do Ubuntu ja esta aberto com esse mesmo perfil. Feche o Google Chrome do servidor e tente de novo.'
      );
    }
    throw error;
  }
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
  if (!page) return null;
  const screenshotsEnabled = parseBooleanFlag(process.env.FBA_SCREENSHOTS_ENABLED);
  if (screenshotsEnabled !== true) return null;

  try {
    if (typeof page.isClosed === 'function' && page.isClosed()) {
      return null;
    }

    const browser = typeof page.browser === 'function' ? page.browser() : null;
    if (browser && browser.connected === false) {
      return null;
    }

    const auditScreenshots = parseBooleanFlag(process.env.FBA_AUDIT_SCREENSHOTS) === true;
    const rawFormat = String(process.env.FBA_SCREENSHOT_FORMAT || (auditScreenshots ? 'jpeg' : 'png')).trim().toLowerCase();
    const format = rawFormat === 'jpg' ? 'jpeg' : rawFormat;
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const filepath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.${ext}`);
    const defaultTimeoutMs = auditScreenshots ? 60000 : 20000;
    const timeoutMs = Number(process.env.FBA_SCREENSHOT_TIMEOUT_MS || defaultTimeoutMs);
    const jpegQuality = Number(process.env.FBA_SCREENSHOT_JPEG_QUALITY || 80);

    if (typeof page.bringToFront === 'function') {
      await page.bringToFront().catch(() => null);
    }

    const shotOptions = {
      path: filepath,
      type: format === 'jpeg' ? 'jpeg' : 'png',
      fullPage: false,
      captureBeyondViewport: false,
      fromSurface: true
    };

    if (format === 'jpeg') {
      shotOptions.quality = jpegQuality;
    }

    const screenshotPromise = page.screenshot(shotOptions);
    screenshotPromise.catch(() => null);

    await Promise.race([
      screenshotPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`screenshot-timeout-${timeoutMs}ms`)), timeoutMs))
    ]);
    log.debug(`Screenshot salvo: ${filepath}`);
    return filepath;
  } catch (error) {
    const message = error?.message || String(error);
    const recoverable =
      message.includes('Session closed') ||
      message.includes('Target closed') ||
      message.includes('Protocol error') ||
      message.includes('Most likely the page has been closed');

    if (recoverable) {
      log.warn(`Screenshot ignorado porque a página/browser já estava fechando (${name}).`);
      return null;
    }

    log.warn(`Falha ao salvar screenshot ${name}: ${message}`);
    return null;
  }
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
    ),
    hasProductTitle: Boolean(document.querySelector(
      'h1, .productView-title, .product__title, .product-title, [itemprop="name"], [data-product-title]'
    )),
    hasProductPrice: Boolean(document.querySelector(
      'meta[property="product:price:amount"], meta[itemprop="price"], [itemprop="price"], .productView-price, .product__price, .product-price, .price .money, .money'
    )),
    hasAddToCart: Boolean(document.querySelector(
      'input[value*="Add to Cart"], button[id*="add"], button[name*="add"], form[action*="cart"] [type="submit"]'
    )),
    hasSearchResults: Boolean(document.querySelector('[data-component-type="s-search-result"]')),
    hasReviewRecaptcha: Boolean(
      document.querySelector(
        'form[action*="review"] .g-recaptcha, form[action*="post_review"] .g-recaptcha, ' +
        '.productReview-form .g-recaptcha, [id*="modal-review-form"] .g-recaptcha'
      )
    )
  }));

  const text = `${snapshot.title} ${snapshot.bodyText}`.toLowerCase();
  const hasStrongContentSignals = Boolean(
    snapshot.hasProductTitle ||
    snapshot.hasProductPrice ||
    snapshot.hasAddToCart ||
    snapshot.hasSearchResults
  );
  const hasCommerceSignals = Boolean(
    snapshot.hasProductPrice ||
    snapshot.hasAddToCart ||
    snapshot.hasSearchResults
  );

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

  if (
    snapshot.hasRecaptcha &&
    !snapshot.hasReviewRecaptcha &&
    !hasStrongContentSignals &&
    (
      text.includes('g-recaptcha') ||
      text.includes('i am human') ||
      text.includes('verify you are human') ||
      text.includes('robot or human')
    )
  ) {
    return buildAccessIssue(source, snapshot, 'captcha', 'reCAPTCHA detectado na página');
  }

  if (
    !hasCommerceSignals &&
    (
      /\b404\b/.test((snapshot.title || '').toLowerCase()) ||
      (snapshot.title || '').toLowerCase().includes('page not found') ||
      /\b404\b/.test(text) ||
      text.includes('page not found') ||
      text.includes('the page can’t be found') ||
      text.includes("the page can't be found") ||
      text.includes('requested url was not found')
    )
  ) {
    return buildAccessIssue(source, snapshot, 'not_found', 'Página do fornecedor não encontrada');
  }

  if (
    !hasStrongContentSignals &&
    text.includes('your connection needs to be verified') ||
    !hasStrongContentSignals &&
    text.includes('access denied') ||
    !hasStrongContentSignals &&
    text.includes('temporarily blocked') ||
    !hasStrongContentSignals &&
    text.includes('unusual traffic') ||
    !hasStrongContentSignals &&
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
    const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const absolutizeUrl = rawUrl => {
      if (!rawUrl) return '';
      try {
        return new URL(rawUrl, location.origin).toString();
      } catch {
        return String(rawUrl).trim();
      }
    };
    const firstMatch = (root, selectors = []) => {
      for (const selector of selectors) {
        const element = root.querySelector(selector);
        if (element) return { element, selector };
      }
      return { element: null, selector: '' };
    };
    const items = document.querySelectorAll('[data-component-type="s-search-result"][data-asin]');
    const sanitizeAmazonUrl = (rawUrl, asin) => {
      const absolute = absolutizeUrl(rawUrl);
      if (!absolute) {
        return asin ? `https://www.amazon.com/dp/${encodeURIComponent(asin)}` : '';
      }
      if (/^javascript:/i.test(absolute) || absolute.includes('void(0)')) {
        return asin ? `https://www.amazon.com/dp/${encodeURIComponent(asin)}` : '';
      }
      if (!/^https?:\/\//i.test(absolute)) {
        return asin ? `https://www.amazon.com/dp/${encodeURIComponent(asin)}` : '';
      }
      return absolute;
    };

    return Array.from(items).slice(0, 5).map(item => {
      const asin = normalizeText(item.getAttribute('data-asin'));
      const { element: titleEl } = firstMatch(item, [
        '[data-cy="title-recipe"] h2 span',
        '[data-cy="title-recipe"] a h2 span',
        'h2 span',
        'img.s-image'
      ]);
      const { element: linkEl } = firstMatch(item, [
        '[data-cy="title-recipe"] a[href]',
        'a.a-link-normal.s-line-clamp-4[href]',
        'a.a-link-normal.s-line-clamp-2[href]',
        'a[href*="/dp/"]'
      ]);
      const priceOffscreen = item.querySelector('.a-price .a-offscreen');
      const priceWhole = item.querySelector('.a-price-whole');
      const priceFraction = item.querySelector('.a-price-fraction');

      let price = null;
      if (priceOffscreen?.textContent) {
        const parsed = Number.parseFloat(priceOffscreen.textContent.replace(/[^0-9.]/g, ''));
        price = Number.isFinite(parsed) ? parsed : null;
      } else if (priceWhole) {
        const whole = priceWhole.textContent.replace(/[^0-9]/g, '');
        const fraction = priceFraction ? priceFraction.textContent.replace(/[^0-9]/g, '') : '00';
        const parsed = Number.parseFloat(`${whole}.${fraction}`);
        price = Number.isFinite(parsed) ? parsed : null;
      }

      const title = titleEl
        ? normalizeText(titleEl.textContent || titleEl.getAttribute('alt') || '')
        : '';
      const rawUrl = linkEl ? (linkEl.getAttribute('href') || '') : '';
      const url = sanitizeAmazonUrl(rawUrl, asin);

      return {
        asin,
        title,
        price,
        url
      };
    }).filter(result => result.asin && result.url && result.title);
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
    const screenshotPath = await saveScreenshot(page, `amazon-${type}-navigation-error`);
    return {
      error: navigation.error,
      accessIssue: navigation.accessIssue ? { ...navigation.accessIssue, screenshotPath } : null,
      screenshotPath,
      results: []
    };
  }

  const accessIssue = await inspectPageAccess(page, `amazon-${type}`);
  if (accessIssue) {
    log.warn(`Bloqueio na Amazon (${type}): ${accessIssue.reason}`);
    const screenshotPath = await saveScreenshot(page, `amazon-${type}-${accessIssue.type}`);
    return {
      error: accessIssue.type,
      accessIssue: { ...accessIssue, screenshotPath },
      screenshotPath,
      results: []
    };
  }

  try {
    await page.waitForFunction(() => {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      return (
        document.querySelectorAll('[data-component-type="s-search-result"][data-asin]').length > 0 ||
        bodyText.includes('no results for') ||
        bodyText.includes('did not match any products')
      );
    }, { timeout: 8000 });
  } catch {}

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
      const addToCartElement = document.querySelector(
        '#form-action-addToCart, input[value*="Add to Cart"], button[value*="Add to Cart"], form[action*="cart"] [type="submit"]'
      );
      const hasEnabledAddToCart = Boolean(
        addToCartElement &&
        !addToCartElement.hasAttribute('disabled') &&
        addToCartElement.getAttribute('aria-disabled') !== 'true'
      );

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

      if (hasEnabledAddToCart) {
        return { availabilityStatus: 'in_stock', available: true, availabilityText };
      }

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
export async function openSupplierPage(page, supplierUrl, options = {}) {
  log.info(`Abrindo fornecedor: ${supplierUrl}`);
  const recoveryMeta = options.recoveryMeta || null;

  const navigation = await navigate(page, supplierUrl, 'supplier');
  if (navigation.error) {
    if (!options.disableRecovery) {
      const recovered = await findRecoveredSupplierUrl(supplierUrl, options);
      if (recovered?.recoveredUrl) {
        return openSupplierPage(page, recovered.recoveredUrl, {
          ...options,
          disableRecovery: true,
          recoveryMeta: {
            fromUrl: supplierUrl,
            searchUrl: recovered.searchUrl,
            query: recovered.query
          }
        });
      }
    }

    const fallback = await fetchSupplierDataFallback(supplierUrl);
    if (!fallback.error && fallback.supplier) {
      log.info(`Fornecedor recuperado via fallback HTTP: ${fallback.finalUrl}`);
      return {
        error: null,
        accessIssue: null,
        supplier: fallback.supplier,
        pageUrl: fallback.finalUrl,
        fetchedVia: fallback.fetchedVia,
        recoveryMeta
      };
    }

    const screenshotPath = await saveScreenshot(page, 'supplier-navigation-error');
    return {
      error: navigation.error,
      accessIssue: navigation.accessIssue ? { ...navigation.accessIssue, screenshotPath } : null,
      screenshotPath,
      supplier: null
    };
  }

  const accessIssue = await inspectPageAccess(page, 'supplier');
  if (accessIssue) {
    if (accessIssue.type === 'not_found' && !options.disableRecovery) {
      const recovered = await findRecoveredSupplierUrl(supplierUrl, options);
      if (recovered?.recoveredUrl) {
        return openSupplierPage(page, recovered.recoveredUrl, {
          ...options,
          disableRecovery: true,
          recoveryMeta: {
            fromUrl: supplierUrl,
            searchUrl: recovered.searchUrl,
            query: recovered.query
          }
        });
      }
    }

    const fallback = await fetchSupplierDataFallback(supplierUrl);
    if (!fallback.error && fallback.supplier) {
      log.info(`Fornecedor recuperado via fallback HTTP após bloqueio visual: ${fallback.finalUrl}`);
      return {
        error: null,
        accessIssue: null,
        supplier: fallback.supplier,
        pageUrl: fallback.finalUrl,
        fetchedVia: fallback.fetchedVia,
        recoveryMeta
      };
    }

    log.warn(`Bloqueio no fornecedor: ${accessIssue.reason}`);
    const screenshotPath = await saveScreenshot(page, `supplier-${accessIssue.type}`);
    return {
      error: accessIssue.type,
      accessIssue: { ...accessIssue, screenshotPath },
      screenshotPath,
      supplier: null
    };
  }

  const supplier = await extractSupplierData(page);
  let finalSupplier = supplier;
  let fetchedVia = 'browser';

  if (supplier.price === null) {
    const fallback = await fetchSupplierDataFallback(page.url());
    if (!fallback.error && fallback.supplier?.price !== null) {
      finalSupplier = {
        ...fallback.supplier,
        ...supplier,
        price: fallback.supplier.price,
        priceCurrent: fallback.supplier.priceCurrent ?? fallback.supplier.price,
        priceCurrentText: fallback.supplier.priceCurrentText || supplier.priceCurrentText,
        pricePrevious: fallback.supplier.pricePrevious ?? supplier.pricePrevious,
        pricePreviousText: fallback.supplier.pricePreviousText || supplier.pricePreviousText,
        priceSource: fallback.supplier.priceSource || supplier.priceSource || 'http-fallback',
        priceConfidence: fallback.supplier.priceConfidence || supplier.priceConfidence || 'high',
        priceStatus: 'ok',
        priceMissing: false
      };
      fetchedVia = 'browser+http-fallback';
      log.info(`Preço do fornecedor recuperado via fallback HTTP: $${finalSupplier.price.toFixed(2)}`);
    }
  }

  if (finalSupplier.price !== null) {
    log.info(
      `Fornecedor carregado: $${finalSupplier.price.toFixed(2)} ` +
      `(${finalSupplier.priceSource || 'DOM'} | status=${finalSupplier.priceStatus || 'ok'})`
    );
  } else {
    log.warn(
      `Preço do fornecedor não encontrado automaticamente ` +
      `(status=${finalSupplier.priceStatus || 'missing'} | source=${finalSupplier.priceSource || 'n/a'}).`
    );
  }

  return {
    error: null,
    accessIssue: null,
    supplier: finalSupplier,
    fetchedVia,
    recoveryMeta
  };
}

/**
 * Aguarda as extensões Keepa e AZInsight carregarem.
 */
export async function waitForMarketplaceExtensions(page) {
  const extensionState = {
    keepaLoaded: false,
    keepaReady: false,
    azInsightLoaded: false,
    azInsightCalculatorReady: false
  };

  const keepaTimeoutMs = Number(process.env.FBA_KEEPA_WAIT_MS || 30000);
  const azInsightTimeoutMs = Number(process.env.FBA_AZINSIGHT_WAIT_MS || 60000);
  const azSettleMs = Number(process.env.FBA_AZINSIGHT_SETTLE_MS || 1500);
  const azRecoveryAfterMs = Number(process.env.FBA_AZINSIGHT_RECOVERY_AFTER_MS || 12000);
  const azReloadAfterMs = Number(process.env.FBA_AZINSIGHT_RELOAD_AFTER_MS || 25000);
  const azLoopStartedAt = Date.now();
  let azRefreshTried = false;
  let azReloadTried = false;

  try {
    await page.waitForSelector('#keepa_box, iframe[src*="keepa"]', { timeout: keepaTimeoutMs });
    extensionState.keepaLoaded = true;
    extensionState.keepaReady = await page.evaluate(() => {
      const keepaBox = document.querySelector('#keepa_box');
      const text = (keepaBox?.textContent || '').replace(/\s+/g, ' ').trim();
      return Boolean(
        document.querySelector('iframe[src*="keepa"]') ||
        text.includes('Sales Rank') ||
        text.includes('BSR') ||
        text.length > 80
      );
    }).catch(() => false);
    log.info(`Keepa carregado na página (${extensionState.keepaReady ? 'pronto' : 'sem dados visiveis ainda'}).`);
  } catch {
    log.warn(`Keepa não carregou em ${Math.round(keepaTimeoutMs / 1000)}s. Extensão pode não estar ativa.`);
  }

  const azDeadline = Date.now() + azInsightTimeoutMs;
  while (Date.now() < azDeadline) {
    const frame = await resolveAzInsightFrameOrMain(page);
    const hasPanel = await frame.evaluate((sels) => {
      for (const sel of sels) {
        try {
          if (document.querySelector(sel)) return true;
        } catch {
          continue;
        }
      }
      return false;
    }, AZINSIGHT_ROOT_SELECTORS).catch(() => false);

    if (hasPanel) {
      extensionState.azInsightLoaded = true;
      await scrollAzInsightPanelIntoView(frame);
      await sleep(azSettleMs);
      extensionState.azInsightCalculatorReady = await isAzInsightCalculatorReadyOnFrame(frame);
      if (extensionState.azInsightCalculatorReady) {
        log.info('AZInsight carregado na página (calculadora pronta).');
        break;
      }
      const elapsedMs = Date.now() - azLoopStartedAt;

      if (!azRefreshTried && elapsedMs >= azRecoveryAfterMs) {
        const refreshed = await clickAzInsightRefreshControl(frame);
        azRefreshTried = true;
        if (refreshed) {
          log.warn('AZInsight estava em loading prolongado; acionei refresh interno do painel.');
        } else {
          log.warn('AZInsight em loading prolongado; botão refresh não encontrado no painel.');
        }
      }

      if (!azReloadTried && elapsedMs >= azReloadAfterMs) {
        azReloadTried = true;
        log.warn('AZInsight ainda em loading; recarregando página Amazon 1x para recuperar painel.');
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);
          await dismissCommonOverlays(page);
        } catch (error) {
          log.warn(`Falha ao recarregar Amazon para recuperar AZInsight: ${error.message}`);
        }
      }

      log.debug('AZInsight: painel detectado, aguardando calculadora preencher…');
    }
    await sleep(650);
  }

  if (!extensionState.azInsightLoaded) {
    log.warn(`AZInsight não carregou em ${Math.round(azInsightTimeoutMs / 1000)}s. Extensão pode não estar ativa.`);
  } else if (!extensionState.azInsightCalculatorReady) {
    log.warn(
      `AZInsight: painel visivel, mas calculadora nao confirmada em ${Math.round(azInsightTimeoutMs / 1000)}s. ` +
      'Verifique login da extensao no Chrome do servidor.'
    );
  }

  return extensionState;
}

/**
 * Navega para a página do produto na Amazon e valida acesso.
 */
export async function goToProductPage(page, amazonUrl) {
  log.info(`Navegando para produto: ${amazonUrl}`);

  const navigation = await navigate(page, amazonUrl, 'amazon-product');
  if (navigation.error) {
    const screenshotPath = await saveScreenshot(page, 'amazon-product-navigation-error');
    return {
      error: navigation.error,
      accessIssue: navigation.accessIssue ? { ...navigation.accessIssue, screenshotPath } : null,
      screenshotPath
    };
  }

  const accessIssue = await inspectPageAccess(page, 'amazon-product');
  if (accessIssue) {
    const screenshotPath = await saveScreenshot(page, `amazon-product-${accessIssue.type}`);
    return {
      error: accessIssue.type,
      accessIssue: { ...accessIssue, screenshotPath },
      screenshotPath
    };
  }

  const extensionState = await waitForMarketplaceExtensions(page);
  return { error: null, accessIssue: null, extensionState };
}

export async function extractAmazonProductIdentity(page) {
  return page.evaluate(() => {
    const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const parseWeightLb = rawValue => {
      const value = normalizeText(rawValue).toLowerCase().replace(',', '.');
      if (!value) return null;
      const match = value.match(/([0-9]+(?:\.[0-9]+)?)\s*(lb|lbs|pounds|oz|ounces|kg|kgs|g|grams)\b/i);
      if (!match) return null;
      const amount = Number.parseFloat(match[1]);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const unit = match[2].toLowerCase();
      if (unit === 'lb' || unit === 'lbs' || unit === 'pounds') return Number(amount.toFixed(3));
      if (unit === 'oz' || unit === 'ounces') return Number((amount / 16).toFixed(3));
      if (unit === 'kg' || unit === 'kgs') return Number((amount * 2.20462).toFixed(3));
      if (unit === 'g' || unit === 'grams') return Number((amount / 453.592).toFixed(3));
      return null;
    };

    const getText = selectors => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const text = normalizeText(
          element?.textContent ||
          element?.getAttribute?.('content') ||
          element?.getAttribute?.('value') ||
          ''
        );
        if (text) return text;
      }
      return '';
    };

    const pushPair = (pairs, seen, rawLabel, rawValue) => {
      const label = normalizeText(rawLabel).replace(/:$/, '');
      const value = normalizeText(rawValue);
      if (!label || !value) return;
      const key = `${label}::${value}`;
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push({ label, value });
    };

    const detailPairs = [];
    const seenPairs = new Set();

    for (const row of document.querySelectorAll(
      '#productDetails_detailBullets_sections1 tr, ' +
      '#productDetails_techSpec_section_1 tr, ' +
      '#technicalSpecifications_section_1 tr, ' +
      '#productOverview_feature_div tr'
    )) {
      const label = row.querySelector('th, td.a-span3, td.a-text-bold')?.textContent || '';
      const valueCell = row.querySelector('td:not(.a-span3):not(.a-text-bold), td:last-child');
      const value = valueCell?.textContent || '';
      pushPair(detailPairs, seenPairs, label, value);
    }

    for (const item of document.querySelectorAll(
      '#detailBullets_feature_div li, ' +
      '[data-feature-name="detailBullets"] li, ' +
      '#detailBulletsWrapper_feature_div li'
    )) {
      const label = item.querySelector('.a-text-bold')?.textContent || '';
      const fullText = normalizeText(item.textContent || '');
      const value = label ? fullText.replace(normalizeText(label), '').trim() : fullText;
      pushPair(detailPairs, seenPairs, label, value);
    }

    const extractCodes = values => {
      const codes = [];
      for (const value of values) {
        const matches = String(value || '').match(/\b\d{12,14}\b/g) || [];
        for (const match of matches) codes.push(match);
      }
      return [...new Set(codes)];
    };

    const title = getText([
      '#productTitle',
      '[data-feature-name="title"] h1',
      'h1.a-size-large',
      'meta[property="og:title"]'
    ]) || normalizeText(document.title || '');

    const rawBrand = getText([
      '#bylineInfo',
      '#brand',
      '[data-feature-name="bylineInfo"] a',
      '[data-feature-name="bylineInfo"]'
    ]) || (
      detailPairs.find(pair => /brand/i.test(pair.label))?.value || ''
    );

    const brand = normalizeText(
      rawBrand
        .replace(/^visit the\s+/i, '')
        .replace(/\s+store$/i, '')
        .replace(/^brand\s+/i, '')
    );

    const modelNumbers = [...new Set(
      detailPairs
        .filter(pair => /item model number|model number|manufacturer part number|part number|mpn/i.test(pair.label))
        .map(pair => normalizeText(pair.value))
        .filter(Boolean)
    )];

    const productCodes = extractCodes([
      ...modelNumbers,
      ...detailPairs
        .filter(pair => /upc|ean|gtin|isbn/i.test(pair.label))
        .map(pair => pair.value)
    ]);

    const bullets = [...new Set(
      Array.from(document.querySelectorAll(
        '#feature-bullets li span.a-list-item, #feature-bullets li, [data-feature-name="featurebullets"] li'
      ))
        .map(item => normalizeText(item.textContent || ''))
        .filter(text => text && text.length >= 5)
    )].slice(0, 12);

    const asinFromUrl = (location.href.match(/\/dp\/([A-Z0-9]{10})/i) || [])[1] || '';
    const asin = normalizeText(
      document.querySelector('#ASIN')?.getAttribute('value') ||
      asinFromUrl
    );

    const detailValues = detailPairs.map(pair => `${pair.label} ${pair.value}`);
    const itemWeightRaw = detailPairs.find(pair => /item weight/i.test(pair.label))?.value || '';
    const packageWeightRaw = detailPairs.find(pair => /shipping weight|package weight/i.test(pair.label))?.value || '';
    const fallbackWeightRaw = detailValues.find(value => /(weight)/i.test(value)) || '';
    const itemWeightLb = parseWeightLb(itemWeightRaw) || parseWeightLb(fallbackWeightRaw);
    const packageWeightLb = parseWeightLb(packageWeightRaw) || parseWeightLb(fallbackWeightRaw);

    return {
      title,
      brand,
      asin,
      modelNumbers,
      productCodes,
      bullets,
      itemWeightLb,
      packageWeightLb,
      url: location.href
    };
  });
}

/**
 * Tenta extrair dados do Keepa da página do produto.
 */
export async function extractKeepaData(page, options = {}) {
  log.info('Extraindo dados do Keepa...');
  await saveScreenshot(page, 'keepa-section');

  const extensionData = await page.evaluate(() => {
    const keepaBox = document.querySelector('#keepa_box');
    if (!keepaBox) return null;

    const text = (keepaBox.textContent || '').replace(/\s+/g, ' ').trim();
    const parseNear = label => {
      const pattern = new RegExp(`${label}[^0-9-]*(\\d+[\\d,]*)`, 'i');
      const match = text.match(pattern);
      if (!match) return null;
      const parsed = Number.parseInt(match[1].replace(/,/g, ''), 10);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const bsrDrops = parseNear('BSR Drops') || parseNear('Sales Rank Drops') || null;
    const monthlySold = parseNear('Bought in past month') || parseNear('Monthly Sales') || null;
    const salesRank = parseNear('BSR') || parseNear('Sales Rank') || null;

    return {
      available: true,
      source: 'keepa-extension',
      rawText: text.substring(0, 2000),
      hasBSRData: text.includes('Sales Rank') || text.includes('BSR'),
      bsrDrops,
      bsrDrops30: bsrDrops,
      salesYearEstimate: bsrDrops !== null ? Math.max(0, Math.round(bsrDrops * 12)) : null,
      monthlySold,
      salesRankCurrent: salesRank
    };
  });

  const apiData = await fetchKeepaApiData(options.asin || '');

  if (apiData?.available) {
    return {
      ...(extensionData || {}),
      ...apiData,
      source: extensionData?.available ? 'keepa-api+extension' : 'keepa-api',
      extensionAvailable: extensionData?.available === true
    };
  }

  if (extensionData) {
    if (apiData?.apiError) {
      extensionData.apiError = apiData.apiError;
    }
    return extensionData;
  }

  log.warn('Não foi possível extrair dados do Keepa.');
  return {
    available: false,
    source: apiData?.source || 'none',
    apiError: apiData?.apiError || null
  };
}

/**
 * Extrai dados do AZInsight/AsinZen da página do produto.
 */
export async function extractAZInsightData(page) {
  log.info('Extraindo dados do AZInsight...');
  await saveScreenshot(page, 'azinsight-section');

  const authIssue = page?.__azInsightAuthIssue || null;
  if (authIssue) {
    log.warn('AZInsight respondeu unauthorized. Extensão provavelmente não está logada no servidor.');
    return { available: false, authIssue };
  }

  const azFrame = await resolveAzInsightFrameOrMain(page);
  await scrollAzInsightPanelIntoView(azFrame);

  const azData = await azFrame.evaluate(sels => {
    const allNodes = [];
    for (const sel of sels) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(sel));
      } catch {
        nodes = [];
      }
      for (const el of nodes) allNodes.push(el);
    }
    const azPanel = allNodes
      .map(el => {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 140 && rect.height > 100;
        if (!visible) return { el, score: -1 };
        const lower = text.toLowerCase();
        const hasSignature =
          lower.includes('supplier tracker') ||
          /buy\s*cost|purchase\s*cost|custo/.test(lower) ||
          /sell price based on roi|sell price based on profit/.test(lower) ||
          (/\bfbm\b/.test(lower) && /\bfba\b/.test(lower));
        if (!hasSignature) return { el, score: -1 };
        const inputs = Array.from(el.querySelectorAll('input, textarea'))
          .filter(input => {
            const inputRect = input.getBoundingClientRect();
            return inputRect.width > 10 && inputRect.height > 10;
          });
        if (text.length < 24 && inputs.length === 0) return { el, score: -1 };
        let score = inputs.length * 3;
        if (lower.includes('supplier tracker')) score += 10;
        if (lower.includes('buy cost')) score += 10;
        if (lower.includes('fba')) score += 4;
        return { el, score };
      })
      .filter(item => item.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.el || null;
    if (!azPanel) return null;

    const text = (azPanel.innerText || azPanel.textContent || '').replace(/\s+/g, ' ').trim();
    const parseMoney = value => {
      const match = String(value || '').match(/-?\$?\s*([0-9]+(?:[.,][0-9]{1,2})?)/);
      if (!match) return null;
      const parsed = Number.parseFloat(match[1].replace(',', ''));
      return Number.isFinite(parsed) ? parsed : null;
    };
    const parsePercent = value => {
      const match = String(value || '').match(/(-?[0-9]+(?:[.,][0-9]+)?)\s*%/);
      if (!match) return null;
      const parsed = Number.parseFloat(match[1].replace(',', ''));
      return Number.isFinite(parsed) ? parsed : null;
    };
    const visibleInputs = Array.from(azPanel.querySelectorAll('input, textarea'))
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          index,
          value: parseMoney(el.value),
          rawValue: el.value || '',
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      })
      .filter(item => item.width > 10 && item.height > 10)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const extractNumber = label => {
      const regex = new RegExp(`(?:${label})[:\\s]*\\$?([\\d.,]+)`, 'i');
      const match = text.match(regex);
      if (!match || !match[1]) return null;
      return parseFloat(match[1].replace(',', ''));
    };
    const extractLineMoneyValues = label => {
      const regex = new RegExp(`${label}[^\\n]*`, 'i');
      const line = (text.match(regex) || [])[0] || '';
      return (line.match(/-?\$\s*[0-9]+(?:[.,][0-9]{1,2})?/g) || [])
        .map(parseMoney)
        .filter(value => value !== null);
    };
    const extractLinePercentValues = label => {
      const regex = new RegExp(`${label}[^\\n]*`, 'i');
      const line = (text.match(regex) || [])[0] || '';
      return (line.match(/-?[0-9]+(?:[.,][0-9]+)?\s*%/g) || [])
        .map(parsePercent)
        .filter(value => value !== null);
    };

    const fbaSellPrice = visibleInputs[1]?.value ?? visibleInputs[0]?.value ?? null;
    const fbaBuyCost = visibleInputs[3]?.value ?? visibleInputs.at(-1)?.value ?? null;
    const profitValues = extractLineMoneyValues('Profit');
    const roiValues = extractLinePercentValues('ROI');
    const marginValues = extractLinePercentValues('Margin');
    const estimatedProfit = extractNumber('Profit|Net') ?? profitValues.at(-1) ?? null;
    const amazonPrice = extractNumber('Amazon Price|Buy Box|Price') ?? fbaSellPrice;
    const fbaFeeFromProfit = (
      amazonPrice !== null &&
      fbaBuyCost !== null &&
      estimatedProfit !== null
    )
      ? Number((amazonPrice - fbaBuyCost - estimatedProfit).toFixed(2))
      : null;

    const panelSignature =
      /supplier\s*tracker|buy\s*cost|purchase\s*cost|sell\s*price\s*based\s*on\s*(roi|profit)|\bfbm\b/i.test(text);

    return {
      available: true,
      amazonPrice,
      fbaFee: extractNumber('FBA Fee|Fulfillment') ?? fbaFeeFromProfit,
      referralFee: extractNumber('Referral Fee'),
      estimatedProfit,
      roi: extractNumber('ROI') ?? roiValues.at(-1) ?? null,
      margin: extractNumber('Margin') ?? marginValues.at(-1) ?? null,
      fbaBuyCost,
      fbaSellPrice,
      calculatorReady: text.toLowerCase().includes('supplier tracker') && visibleInputs.length >= 2,
      inputCount: visibleInputs.length,
      rawText: text.substring(0, 2000),
      panelSignature,
      amazonSells: text.toLowerCase().includes('amazon') &&
        (text.toLowerCase().includes('sells') || text.toLowerCase().includes('offer'))
    };
  }, AZINSIGHT_ROOT_SELECTORS);

  if (!azData) {
    log.warn('Não foi possível extrair dados do AZInsight.');
    return { available: false };
  }

  const rawLower = String(azData.rawText || '').toLowerCase();
  const looksAmazonShell = rawLower.startsWith('skip to main content') || rawLower.includes('search alt + /');
  if (looksAmazonShell || azData.panelSignature !== true) {
    return { available: false };
  }

  if (Number.isFinite(azData.fbaFee) && azData.fbaFee < 0) {
    azData.fbaFee = null;
  }
  if (Number.isFinite(azData.fbaBuyCost) && azData.fbaBuyCost <= 0) {
    azData.fbaBuyCost = null;
  }
  const looksLoading = /sales data is loading|hold tight|carregando/.test(rawLower);
  const hasAnyMetric = [azData.amazonPrice, azData.fbaFee, azData.estimatedProfit, azData.roi, azData.margin]
    .some(value => value !== null && value !== undefined);
  if (looksLoading && !hasAnyMetric) {
    azData.loading = true;
    log.warn('AZInsight ainda em loading (sem métricas).');
  }

  return azData;
}

/**
 * Insere o Buy Cost no campo do AZInsight para calcular lucro real.
 */
export async function inputBuyCostInAZInsight(page, buyCost, options = {}) {
  log.info(`Inserindo Buy Cost no AZInsight: $${buyCost.toFixed(2)}`);

  const azFrame = await resolveAzInsightFrameOrMain(page);
  await scrollAzInsightPanelIntoView(azFrame);

  const sellPrice = normalizeFinitePositiveNumber(options.sellPrice);
  if (sellPrice !== null) {
    await inputAzInsightValueByVisualCoordinates(page, azFrame, sellPrice, 'fbaSellPrice');
  }

  const marked = await azFrame.evaluate((sels) => {
    for (const el of document.querySelectorAll('[data-fba-temp-bc]')) {
      el.removeAttribute('data-fba-temp-bc');
    }

    const allRoots = [];
    for (const sel of sels) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(sel));
      } catch {
        nodes = [];
      }
      for (const el of nodes) allRoots.push(el);
    }

    const root =
      allRoots
        .map(el => {
          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const hasSignature =
            text.includes('supplier tracker') ||
            /buy\s*cost|purchase\s*cost|custo/.test(text) ||
            /sell price based on roi|sell price based on profit/.test(text) ||
            (/\bfbm\b/.test(text) && /\bfba\b/.test(text));
          if (!hasSignature) return { el, score: -1 };
          const inputs = Array.from(el.querySelectorAll('input, textarea')).filter(input => {
            const rect = input.getBoundingClientRect();
            return rect.width > 10 && rect.height > 10;
          });
          let score = inputs.length * 3;
          if (text.includes('supplier tracker')) score += 10;
          if (text.includes('buy cost')) score += 10;
          if (text.includes('fba')) score += 4;
          return { el, score };
        })
        .filter(item => item.score >= 0)
        .sort((a, b) => b.score - a.score)[0]?.el || null;

    const scope = root || document.body;
    if (!scope || typeof scope.querySelectorAll !== 'function') {
      return false;
    }
    const inputs = Array.from(scope.querySelectorAll('input, textarea')).filter(el => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      const rect = el.getBoundingClientRect();
      return (
        (!type || type === 'text' || type === 'number') &&
        rect.width > 10 &&
        rect.height > 10
      );
    });

    const getTextNodeRects = (subRoot, pattern) => {
      const walker = document.createTreeWalker(subRoot, NodeFilter.SHOW_TEXT);
      const rects = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!pattern.test(text)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          rects.push(rect);
        }
      }
      return rects;
    };

    const buyCostRects = getTextNodeRects(scope, /buy\s*cost|custo/i);
    const fbaRects = getTextNodeRects(scope, /\bFBA\b/i);
    const buyCostY = buyCostRects.at(-1)
      ? buyCostRects.at(-1).top + (buyCostRects.at(-1).height / 2)
      : null;
    const fbaX = fbaRects.length
      ? Math.max(...fbaRects.map(rect => rect.left + (rect.width / 2)))
      : null;

    const scoreInput = el => {
      const rect = el.getBoundingClientRect();
      const attrs = [
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.getAttribute('name'),
        el.id
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      let score = 0;
      if (attrs.includes('buy cost')) score += 5;
      if (attrs.includes('cost')) score += 2;
      if (attrs.includes('buy')) score += 1;
      if (buyCostY !== null) {
        const y = rect.top + (rect.height / 2);
        const distance = Math.abs(y - buyCostY);
        if (distance < 30) score += 8;
        else if (distance < 70) score += 3;
      }
      if (fbaX !== null) {
        const x = rect.left + (rect.width / 2);
        if (x >= fbaX - 40) score += 5;
      }
      return score;
    };

    let best =
      inputs
        .map(el => ({ el, score: scoreInput(el) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.el || null;

    if (!best && inputs.length >= 4) best = inputs[3];
    if (!best && inputs.length >= 2) best = inputs.at(-1);

    if (best) {
      best.setAttribute('data-fba-temp-bc', '1');
      return true;
    }
    return false;
  }, AZINSIGHT_ROOT_SELECTORS).catch(() => false);

  let target = marked ? await azFrame.$('[data-fba-temp-bc="1"]') : null;
  if (target) {
    await target.evaluate(el => el.removeAttribute('data-fba-temp-bc'));
  }

  if (!target) {
    const visualFallback = await inputAzInsightValueByVisualCoordinates(page, azFrame, buyCost, 'fbaBuyCost');
    if (visualFallback) return true;
    log.warn('Campo de Buy Cost do AZInsight não encontrado.');
    return false;
  }

  await target.click({ clickCount: 3 });
  await target.type(String(buyCost.toFixed(2)), { delay: 20 });
  await target.press('Tab');

  const valueStr = buyCost.toFixed(2);
  const updated = await target.evaluate((el, value) => {
    const setter =
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;

    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' }));
    return true;
  }, valueStr);

  if (!updated) {
    log.warn('Campo de Buy Cost do AZInsight não encontrado.');
    return false;
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  await saveScreenshot(page, 'azinsight-after-cost');
  return true;
}

async function inputAzInsightValueByVisualCoordinates(page, azFrame, value, field) {
  const targetPoint = await azFrame.evaluate((sels, targetField) => {
    const visibleRect = el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 200) return null;
      if (rect.bottom < 0 || rect.right < 0) return null;
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
    };

    const all = [];
    for (const sel of sels) {
      try {
        all.push(...Array.from(document.querySelectorAll(sel)));
      } catch {
        continue;
      }
    }

    const panel = all
      .map(el => {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const rect = visibleRect(el);
        const hasSignature =
          text.includes('supplier tracker') ||
          /buy\s*cost|purchase\s*cost|custo/.test(text) ||
          /sell price based on roi|sell price based on profit/.test(text) ||
          (/\bfbm\b/.test(text) && /\bfba\b/.test(text));
        let score = 0;
        if (rect) score += 10;
        if (!hasSignature) score -= 50;
        if (text.includes('supplier tracker')) score += 20;
        if (text.includes('buy cost') || text.includes('custo')) score += 20;
        if (text.includes('fba')) score += 8;
        return { rect, score };
      })
      .filter(item => item.rect)
      .sort((a, b) => b.score - a.score)[0]?.rect || null;

    if (panel) {
      return {
        x: Math.round(panel.left + panel.width * 0.78),
        y: Math.round(panel.top + panel.height * (targetField === 'fbaSellPrice' ? 0.56 : 0.68)),
        source: 'az-panel'
      };
    }

    return {
      x: Math.round(window.innerWidth * 0.70),
      y: Math.round(window.innerHeight * (targetField === 'fbaSellPrice' ? 0.724 : 0.795)),
      source: 'viewport-fallback'
    };
  }, AZINSIGHT_ROOT_SELECTORS, field).catch(() => null);

  if (!targetPoint) return false;

  targetPoint.x = Math.max(0, Math.min(targetPoint.x, 1910));
  targetPoint.y = Math.max(0, Math.min(targetPoint.y, 1070));

  log.warn(
    `Campo ${field === 'fbaSellPrice' ? 'FBA Sell Price' : 'FBA Buy Cost'} inacessivel pelo DOM; ` +
    `usando clique visual em ${targetPoint.x},${targetPoint.y} (${targetPoint.source}).`
  );

  await page.mouse.click(targetPoint.x, targetPoint.y, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value.toFixed(2), { delay: 20 });
  await page.keyboard.press('Tab');
  await sleep(500);
  await saveScreenshot(page, field === 'fbaSellPrice' ? 'azinsight-after-sell-price-visual' : 'azinsight-after-cost-visual');
  return true;
}

export async function waitForAZInsightCalculation(page, buyCost) {
  const timeoutMs = Number(process.env.FBA_AZINSIGHT_CALC_WAIT_MS || 60000);
  const expectedBuyCost = Number(buyCost.toFixed(2));
  const azFrame = await resolveAzInsightFrameOrMain(page);

  try {
    await azFrame.waitForFunction(
      (sels, expected) => {
        const roots = [];
        for (const sel of sels) {
          try {
            roots.push(...Array.from(document.querySelectorAll(sel)));
          } catch {
            continue;
          }
        }
        const root =
          roots
            .map(el => {
              const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
              const hasSignature =
                text.includes('supplier tracker') ||
                /buy\s*cost|purchase\s*cost|custo/.test(text) ||
                /sell price based on roi|sell price based on profit/.test(text) ||
                (/\bfbm\b/.test(text) && /\bfba\b/.test(text));
              if (!hasSignature) return { el, score: -1 };
              const inputCount = el.querySelectorAll('input, textarea').length;
              let score = inputCount * 3;
              if (text.includes('supplier tracker')) score += 10;
              if (text.includes('buy cost')) score += 10;
              if (text.includes('fba')) score += 4;
              return { el, score };
            })
            .filter(item => item.score >= 0)
            .sort((a, b) => b.score - a.score)[0]?.el || null;
        if (!root) return false;
        const text = (root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim();
        const inputValues = Array.from(root.querySelectorAll('input, textarea'))
          .map(el => Number.parseFloat(String(el.value || '').replace(/[^0-9.-]/g, '')))
          .filter(Number.isFinite);
        const hasBuyCost = inputValues.some(value => Math.abs(value - expected) < 0.02);
        const hasProfit =
          /(profit|lucro)/i.test(text) &&
          ((/profit[^$-]*-?\$\s*\d/i.test(text)) || (/lucro[^$-]*-?\$\s*\d/i.test(text)));
        const hasRoiOrMargin =
          /(roi|margin|margem)/i.test(text) && /-?\d+(?:\.\d+)?\s*%/.test(text);
        return hasBuyCost && (hasProfit || hasRoiOrMargin);
      },
      { timeout: timeoutMs },
      AZINSIGHT_ROOT_SELECTORS,
      expectedBuyCost
    );
    log.info('AZInsight recalculou lucro após Buy Cost.');
    return true;
  } catch {
    log.warn(`AZInsight não confirmou cálculo em ${Math.round(timeoutMs / 1000)}s após Buy Cost.`);
    return false;
  }
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
