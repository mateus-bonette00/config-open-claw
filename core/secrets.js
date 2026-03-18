import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/**
 * Acesso centralizado a segredos / variáveis de ambiente.
 * Nunca loga valores de secrets.
 */
export function getSecret(key, required = false) {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
  return value || '';
}

export function getSecretOrThrow(key) {
  return getSecret(key, true);
}

function getBooleanSecret(key, fallback = false) {
  const value = getSecret(key);
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function getListSecret(key, fallback = []) {
  const value = getSecret(key);
  if (!value) return fallback;
  return value
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter(Boolean);
}

export const config = {
  openclaw: {
    server: getSecret('OPENCLAW_SERVER') || '192.168.0.173',
    port: parseInt(getSecret('OPENCLAW_PORT') || '18789', 10),
    token: getSecret('OPENCLAW_TOKEN'),
  },
  chrome: {
    userDataDir: getSecret('CHROME_USER_DATA_DIR') || '/home/bonette/.config/google-chrome',
    profile: getSecret('CHROME_PROFILE') || 'Default',
  },
  vpn: {
    required: getBooleanSecret('VPN_REQUIRED', false),
    allowedCountries: getListSecret('VPN_ALLOWED_COUNTRIES', ['US']),
    checkUrl: getSecret('VPN_CHECK_URL') || 'https://ipwho.is/',
  },
  google: {
    credentialsPath: getSecret('GOOGLE_SHEETS_CREDENTIALS_PATH') || './config/google-credentials.json',
    spreadsheetId: getSecret('GOOGLE_SHEETS_SPREADSHEET_ID'),
    sheetName: getSecret('GOOGLE_SHEETS_SHEET_NAME') || 'Produtos Aprovados',
  },
  whatsapp: {
    apiUrl: getSecret('WHATSAPP_API_URL'),
    apiToken: getSecret('WHATSAPP_API_TOKEN'),
    instance: getSecret('WHATSAPP_INSTANCE'),
  },
  meta: {
    accessToken: getSecret('META_ACCESS_TOKEN'),
    pageId: getSecret('META_PAGE_ID'),
    instagramAccountId: getSecret('INSTAGRAM_ACCOUNT_ID'),
  },
  hubspot: {
    apiKey: getSecret('HUBSPOT_API_KEY'),
    portalId: getSecret('HUBSPOT_PORTAL_ID'),
  },
  general: {
    logLevel: getSecret('LOG_LEVEL') || 'info',
    logDir: getSecret('LOG_DIR') || './storage/logs',
    stateDir: getSecret('STATE_DIR') || './storage/state',
    timezone: getSecret('TIMEZONE') || 'America/Sao_Paulo',
  }
};
