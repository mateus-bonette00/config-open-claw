import fs from 'fs';
import path from 'path';
import { createLogger } from '../../core/logger.js';

const log = createLogger('fba-report');

function toFiniteNumber(value, { allowZero = true } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!allowZero && parsed <= 0) return null;
  if (allowZero && parsed < 0) return null;
  return parsed;
}

function formatMoney(value) {
  const numeric = toFiniteNumber(value, { allowZero: true });
  return numeric === null ? '-' : `$${numeric.toFixed(2)}`;
}

function formatPercent(value) {
  const numeric = toFiniteNumber(value, { allowZero: true });
  return numeric === null ? '-' : `${numeric.toFixed(1)}%`;
}

/**
 * Gera relatório HTML dos produtos aprovados.
 * Estilo: tabela fixa 225x65, cabecalho laranja, textos centralizados.
 */
export function generateApprovedHTML(approvedProducts, outputPath) {
  const HEADER_ORANGE = '#ff8c00';
  const HEADER_ORANGE_BORDER = '#e67e00';
  const CELL_BORDER = '#c8c8c8';
  const TEXT_COLOR = '#1f1f1f';
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const columns = [
    { key: 'index', label: 'Indice' },
    { key: 'name', label: 'Produto' },
    { key: 'supplierDomain', label: 'Fornecedor' },
    { key: 'supplierUrl', label: 'Link Fornecedor' },
    { key: 'amazonTitle', label: 'Titulo Amazon' },
    { key: 'asin', label: 'ASIN' },
    { key: 'amazonUrl', label: 'Link Amazon' },
    { key: 'upc', label: 'UPC' },
    { key: 'supplierPrice', label: 'Preco Fornecedor ($)' },
    { key: 'amazonPrice', label: 'Preco Amazon ($)' },
    { key: 'buyCost', label: 'Buy Cost ($)' },
    { key: 'fbaFees', label: 'FBA Fees ($)' },
    { key: 'margin', label: 'Margem (%)' },
    { key: 'roi', label: 'ROI (%)' },
    { key: 'profit', label: 'Lucro ($)' },
    { key: 'keepaDrops30d', label: 'Quedas BSR (30d)' },
    { key: 'supplierPriceSource', label: 'Origem Preco Fornecedor' },
  ];

  const headerCells = columns.map(col =>
    `<th>${col.label}</th>`
  ).join('\n            ');

  const validProfitValues = approvedProducts
    .map(product => toFiniteNumber(product.profit, { allowZero: true }))
    .filter(value => value !== null);
  const validMarginValues = approvedProducts
    .map(product => toFiniteNumber(product.margin, { allowZero: true }))
    .filter(value => value !== null);

  const totalProfit = validProfitValues.reduce((sum, value) => sum + value, 0);
  const averageMargin = validMarginValues.length
    ? (validMarginValues.reduce((sum, value) => sum + value, 0) / validMarginValues.length)
    : null;

  const bodyRows = approvedProducts.map((p, i) => {
    const rowBg = i % 2 === 0 ? '#FFFFFF' : '#F5F7FA';
    const cells = columns.map(col => {
      let value = p[col.key] ?? '-';

      if (col.key === 'supplierPrice' || col.key === 'amazonPrice' || col.key === 'buyCost' || col.key === 'profit' || col.key === 'fbaFees') {
        value = formatMoney(value);
      }
      if (col.key === 'margin' || col.key === 'roi') {
        value = formatPercent(value);
      }
      if (col.key === 'amazonUrl' || col.key === 'supplierUrl') {
        if (value && value !== '-') {
          const short = value.length > 56 ? value.substring(0, 56) + '...' : value;
          value = `<a href="${value}" target="_blank" style="color:${TEXT_COLOR};text-decoration:underline;font-weight:700;">${short}</a>`;
        }
      }

      return `<td>${value}</td>`;
    }).join('\n              ');

    return `          <tr style="background:${rowBg};">
              ${cells}
          </tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Produtos Aprovados - FBA Amazon</title>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Montserrat', sans-serif;
      font-size: 14px;
      background: #f7f7f7;
      padding: 30px;
      color: ${TEXT_COLOR};
    }

    .header {
      text-align: center;
      margin-bottom: 25px;
    }

    .header h1 {
      font-size: 24px;
      color: ${TEXT_COLOR};
      margin-bottom: 5px;
    }

    .header p {
      font-size: 14px;
      color: #666;
    }

    .stats {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin-bottom: 25px;
    }

    .stats .stat-box {
      background: #ffffff;
      color: ${TEXT_COLOR};
      padding: 15px 30px;
      border-radius: 8px;
      text-align: center;
      font-weight: 700;
      min-width: 150px;
      border: 1px solid ${CELL_BORDER};
    }

    .stats .stat-box .number {
      font-size: 28px;
      display: block;
    }

    .stats .stat-box .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.85;
    }

    .table-wrapper {
      overflow-x: auto;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    }

    table {
      border-collapse: collapse;
      width: 100%;
      min-width: 1800px;
      table-layout: fixed;
    }

    th {
      background: ${HEADER_ORANGE};
      color: #ffffff;
      font-weight: 700;
      font-size: 14px;
      padding: 8px;
      text-align: center;
      vertical-align: middle;
      border: 1px solid ${HEADER_ORANGE_BORDER};
      width: 225px;
      min-width: 225px;
      max-width: 225px;
      height: 65px;
      min-height: 65px;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      line-height: 1.25;
    }

    td {
      font-size: 14px;
      padding: 8px;
      text-align: center;
      vertical-align: middle;
      border: 1px solid ${CELL_BORDER};
      height: 65px;
      min-height: 65px;
      width: 225px;
      min-width: 225px;
      max-width: 225px;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      line-height: 1.25;
    }

    tr:hover td {
      background: #E8EDFF !important;
    }

    .footer {
      text-align: center;
      margin-top: 20px;
      font-size: 12px;
      color: #999;
    }

    @media print {
      body { padding: 10px; background: #FFF; }
      .stats .stat-box { border: 2px solid ${CELL_BORDER}; }
      .table-wrapper { box-shadow: none; }
    }
  </style>
</head>
<body>

  <div class="header">
    <h1>Produtos Aprovados — FBA Amazon</h1>
    <p>Gerado em ${now} | Total: ${approvedProducts.length} produtos aprovados</p>
  </div>

  <div class="stats">
    <div class="stat-box">
      <span class="number">${approvedProducts.length}</span>
      <span class="label">Aprovados</span>
    </div>
    <div class="stat-box">
      <span class="number">${approvedProducts.length > 0 ? `$${totalProfit.toFixed(2)}` : '-'}</span>
      <span class="label">Lucro Total Estimado</span>
    </div>
    <div class="stat-box">
      <span class="number">${averageMargin !== null ? `${averageMargin.toFixed(1)}%` : '-'}</span>
      <span class="label">Margem Media</span>
    </div>
  </div>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
            ${headerCells}
        </tr>
      </thead>
      <tbody>
${bodyRows || '          <tr><td colspan="' + columns.length + '" style="padding:40px;color:#999;">Nenhum produto aprovado nesta execucao.</td></tr>'}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Open Claw — Agente FBA Amazon | Relatorio automatico
  </div>

</body>
</html>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf-8');
  log.info(`Relatorio HTML salvo: ${outputPath} (${approvedProducts.length} produtos)`);
  return outputPath;
}
