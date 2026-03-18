import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../../core/logger.js';
import { config } from '../../core/secrets.js';

const log = createLogger('google-sheets');

let sheetsApi = null;

/**
 * Inicializa a conexão com Google Sheets usando Service Account.
 * Requer arquivo de credenciais JSON em config/google-credentials.json
 */
async function getSheets() {
  if (sheetsApi) return sheetsApi;

  const credPath = path.resolve(config.google.credentialsPath);
  if (!fs.existsSync(credPath)) {
    throw new Error(`Arquivo de credenciais Google não encontrado: ${credPath}\nSiga o guia para criar uma Service Account e baixar o JSON.`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const client = await auth.getClient();
  sheetsApi = google.sheets({ version: 'v4', auth: client });
  log.info('Conexão com Google Sheets estabelecida.');
  return sheetsApi;
}

/**
 * Headers padrão para a planilha de produtos aprovados FBA.
 */
const FBA_HEADERS = [
  'Data', 'Indice', 'Nome Produto', 'UPC', 'ASIN',
  'Fornecedor', 'URL Fornecedor', 'URL Amazon',
  'Preco Fornecedor ($)', 'Buy Cost ($)', 'Preco Amazon ($)',
  'FBA Fees ($)', 'Lucro ($)', 'Margem (%)', 'ROI (%)',
  'Amazon Vende', 'Keepa Disponivel', 'AZInsight Disponivel',
  'Status', 'Observacoes'
];

/**
 * Garante que os headers existem na planilha.
 */
async function ensureHeaders() {
  const sheets = await getSheets();
  const spreadsheetId = config.google.spreadsheetId;
  const sheetName = config.google.sheetName;

  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID não configurado no .env');
  }

  // Verificar se a primeira linha já tem headers
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:T1`
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:T1`,
      valueInputOption: 'RAW',
      requestBody: { values: [FBA_HEADERS] }
    });
    log.info('Headers inseridos na planilha.');
  }
}

/**
 * Adiciona um produto aprovado à planilha.
 */
export async function appendProduct(product) {
  const sheets = await getSheets();
  const spreadsheetId = config.google.spreadsheetId;
  const sheetName = config.google.sheetName;

  await ensureHeaders();

  const row = [
    new Date().toISOString().split('T')[0], // Data
    product.index || '',
    product.name || product.amazonTitle || '',
    product.upc || '',
    product.asin || '',
    product.supplierDomain || '',
    product.supplierUrl || '',
    product.amazonUrl || '',
    product.supplierPrice || '',
    product.buyCost || '',
    product.amazonPrice || '',
    product.fbaFees || '',
    product.profit || '',
    product.margin || '',
    product.roi || '',
    product.amazonSells ? 'SIM' : 'NAO',
    product.keepaAvailable ? 'SIM' : 'NAO',
    product.azInsightAvailable ? 'SIM' : 'NAO',
    product.status || '',
    (product.reasons || []).join('; ')
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:T`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });

  log.info(`Produto adicionado à planilha: [${product.asin}] ${product.name || product.amazonTitle}`);
}

/**
 * Adiciona múltiplos produtos de uma vez (batch).
 */
export async function appendProducts(products) {
  const sheets = await getSheets();
  const spreadsheetId = config.google.spreadsheetId;
  const sheetName = config.google.sheetName;

  await ensureHeaders();

  const rows = products.map(p => [
    new Date().toISOString().split('T')[0],
    p.index || '', p.name || p.amazonTitle || '', p.upc || '', p.asin || '',
    p.supplierDomain || '', p.supplierUrl || '', p.amazonUrl || '',
    p.supplierPrice || '', p.buyCost || '', p.amazonPrice || '',
    p.fbaFees || '', p.profit || '', p.margin || '', p.roi || '',
    p.amazonSells ? 'SIM' : 'NAO',
    p.keepaAvailable ? 'SIM' : 'NAO',
    p.azInsightAvailable ? 'SIM' : 'NAO',
    p.status || '', (p.reasons || []).join('; ')
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:T`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  });

  log.info(`${products.length} produtos adicionados à planilha em batch.`);
}
