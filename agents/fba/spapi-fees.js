import { createHmac, createHash } from 'node:crypto';
import { createLogger } from '../../core/index.js';

const log = createLogger('spapi-fees');

const LWA_ENDPOINT = 'https://api.amazon.com/auth/o2/token';
const FEES_PATH = '/products/fees/v0/feesEstimate';
const BATCH_SIZE = 20;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 2000;

let tokenCache = null;
const feesCache = new Map();

function env(key, fallback = '') {
  return process.env[key] || fallback;
}

function hasCredentials() {
  return Boolean(
    env('AMZ_LWA_CLIENT_ID') &&
    env('AMZ_LWA_CLIENT_SECRET') &&
    env('AMZ_REFRESH_TOKEN') &&
    env('AMZ_AWS_ACCESS_KEY_ID') &&
    env('AMZ_AWS_SECRET_ACCESS_KEY')
  );
}

function round2(v) {
  return Number(Number(v || 0).toFixed(2));
}

function toAmount(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  if (typeof v === 'object') {
    for (const k of ['Amount', 'amount', 'CurrencyAmount', 'Value', 'value']) {
      const n = Number(v[k]); if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function feeDetailAmount(detail) {
  for (const key of ['FinalFee', 'FeeAmount', 'EstimatedFee']) {
    const val = Math.abs(toAmount(detail[key]));
    if (val > 0) return round2(val);
  }
  return 0;
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const clientId = env('AMZ_LWA_CLIENT_ID');
  const clientSecret = env('AMZ_LWA_CLIENT_SECRET');
  const refreshToken = env('AMZ_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Credenciais LWA (AMZ_LWA_CLIENT_ID / AMZ_LWA_CLIENT_SECRET / AMZ_REFRESH_TOKEN) não configuradas.');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(LWA_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LWA HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      tokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      };
      return tokenCache.token;
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }

  throw new Error('Falha ao obter token LWA após 3 tentativas.');
}

function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data) {
  return createHash('sha256').update(data || '').digest('hex');
}

function sigv4Sign({ method, url, headers, body, region, credentials }) {
  const datetime = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const date = datetime.slice(0, 8);
  const service = 'execute-api';
  const scope = `${date}/${region}/${service}/aws4_request`;

  const parsedUrl = new URL(url);
  const canonicalUri = parsedUrl.pathname;
  const canonicalQuery = [...parsedUrl.searchParams].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  const signHeaders = { ...headers, host: parsedUrl.host, 'x-amz-date': datetime };
  if (credentials.sessionToken) {
    signHeaders['x-amz-security-token'] = credentials.sessionToken;
  }

  const sortedKeys = Object.keys(signHeaders).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k.toLowerCase()}:${String(signHeaders[k]).trim()}`).join('\n') + '\n';
  const signedHeaders = sortedKeys.map(k => k.toLowerCase()).join(';');
  const payloadHash = sha256Hex(body || '');

  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', datetime, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmacSha256(`AWS4${credentials.secretAccessKey}`, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...signHeaders, authorization };
}

function parseFeesResult(raw, fallbackCurrency) {
  if (!raw || typeof raw !== 'object') return null;

  const identifier = raw.FeesEstimateIdentifier || raw.feesEstimateIdentifier || {};
  const asin = String(identifier.IdValue || identifier.idValue || raw.IdValue || raw.idValue || '').trim().toUpperCase();
  if (!asin) return null;

  const status = String(raw.Status || raw.status || 'Unknown');
  const errorObj = raw.Error || raw.error || {};
  const errorMessage = String(errorObj.Message || errorObj.message || '').trim() || null;

  const estimate = raw.FeesEstimate || raw.feesEstimate || {};
  const totalFeesEstimate = estimate.TotalFeesEstimate || estimate.totalFeesEstimate || null;
  const detailList = Array.isArray(estimate.FeeDetailList || estimate.feeDetailList)
    ? (estimate.FeeDetailList || estimate.feeDetailList)
    : [];

  const details = detailList.filter(d => d && typeof d === 'object');

  const referralFee = round2(details.reduce((acc, d) => {
    const ft = String(d.FeeType || d.feeType || '').toLowerCase();
    return ft.includes('referral') ? acc + feeDetailAmount(d) : acc;
  }, 0));

  const fbaFee = round2(details.reduce((acc, d) => {
    const ft = String(d.FeeType || d.feeType || '').toLowerCase();
    return /fba|fulfillment|pickandpack|weighthandling/.test(ft) ? acc + feeDetailAmount(d) : acc;
  }, 0));

  const totalFromEstimate = round2(Math.abs(toAmount(totalFeesEstimate)));
  const totalFromDetails = round2(details.reduce((acc, d) => acc + feeDetailAmount(d), 0));
  const totalFees = totalFromEstimate > 0 ? totalFromEstimate : totalFromDetails;

  const currencyCode = String(
    totalFeesEstimate?.CurrencyCode || totalFeesEstimate?.currencyCode || fallbackCurrency
  ).toUpperCase();

  return { asin, referralFee, fbaFee, totalFees, currencyCode, status, errorMessage };
}

function pruneCache(now) {
  for (const [k, v] of feesCache) {
    if (v.expiresAt <= now) feesCache.delete(k);
  }
  if (feesCache.size <= CACHE_MAX) return;
  let extra = feesCache.size - CACHE_MAX;
  for (const k of feesCache.keys()) {
    feesCache.delete(k);
    if (--extra <= 0) break;
  }
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchFbaFeesFromSpApi(asin, price, options = {}) {
  if (!hasCredentials()) {
    log.warn('SP-API: credenciais não configuradas, pulando consulta de fees.');
    return null;
  }

  if (!asin || !price || price <= 0) return null;

  const marketplaceId = options.marketplaceId || env('AMZ_MARKETPLACE_ID', 'ATVPDKIKX0DER');
  const region = env('AMZ_REGION', 'us-east-1');
  const endpoint = env('AMZ_SPAPI_ENDPOINT', 'https://sellingpartnerapi-na.amazon.com');
  const currencyCode = options.currencyCode || 'USD';

  const normalizedAsin = asin.trim().toUpperCase();
  const cacheKey = `${marketplaceId}|${normalizedAsin}|${round2(price)}`;
  const now = Date.now();
  pruneCache(now);

  const cached = feesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    log.info(`SP-API fees (cache): ASIN=${normalizedAsin} fba=$${cached.value.fbaFee} referral=$${cached.value.referralFee} total=$${cached.value.totalFees}`);
    return cached.value;
  }

  try {
    const accessToken = await getAccessToken();

    const requestBody = JSON.stringify([{
      FeesEstimateRequest: {
        MarketplaceId: marketplaceId,
        IsAmazonFulfilled: true,
        PriceToEstimateFees: {
          ListingPrice: { CurrencyCode: currencyCode, Amount: round2(price) },
          Shipping: { CurrencyCode: currencyCode, Amount: 0 },
        },
        Identifier: normalizedAsin,
      },
      IdType: 'ASIN',
      IdValue: normalizedAsin,
    }]);

    const fullUrl = `${endpoint}${FEES_PATH}`;
    const credentials = {
      accessKeyId: env('AMZ_AWS_ACCESS_KEY_ID'),
      secretAccessKey: env('AMZ_AWS_SECRET_ACCESS_KEY'),
      sessionToken: env('AMZ_AWS_SESSION_TOKEN') || undefined,
    };

    const baseHeaders = {
      'content-type': 'application/json',
      'x-amz-access-token': accessToken,
      'user-agent': 'OpenClaw-FBA/1.0 (Language=Node.js)',
    };

    const signedHeaders = sigv4Sign({
      method: 'POST',
      url: fullUrl,
      headers: baseHeaders,
      body: requestBody,
      region,
      credentials,
    });

    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: signedHeaders,
      body: requestBody,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log.warn(`SP-API fees HTTP ${res.status} para ASIN=${normalizedAsin}: ${text.slice(0, 300)}`);
      return null;
    }

    const data = await res.json();
    const payload = Array.isArray(data) ? data : (data?.payload || data?.FeesEstimateResultList || []);
    const rows = Array.isArray(payload) ? payload : [];

    for (const row of rows) {
      const parsed = parseFeesResult(row, currencyCode);
      if (!parsed || parsed.asin !== normalizedAsin) continue;

      if (parsed.status !== 'Success' && parsed.errorMessage) {
        log.warn(`SP-API fees erro para ${normalizedAsin}: ${parsed.errorMessage}`);
        return null;
      }

      if (parsed.totalFees <= 0) {
        log.warn(`SP-API fees retornou total=0 para ${normalizedAsin}; ignorando.`);
        return null;
      }

      feesCache.set(cacheKey, { value: parsed, expiresAt: now + CACHE_TTL_MS });
      log.info(`SP-API fees (live): ASIN=${normalizedAsin} fba=$${parsed.fbaFee} referral=$${parsed.referralFee} total=$${parsed.totalFees}`);
      return parsed;
    }

    log.warn(`SP-API fees: nenhum resultado retornado para ${normalizedAsin}.`);
    return null;
  } catch (err) {
    log.warn(`SP-API fees falhou para ${normalizedAsin}: ${err.message}`);
    return null;
  }
}

export function isSpApiConfigured() {
  return hasCredentials();
}
