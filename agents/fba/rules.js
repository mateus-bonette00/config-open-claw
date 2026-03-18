import { createLogger } from '../../core/logger.js';

const log = createLogger('fba-rules');

/**
 * Regras de negócio para aprovação de produtos FBA.
 *
 * Constantes configuráveis:
 */
const RULES = {
  PREP_FEE: 1.90,           // Taxa de preparo por unidade (USD)
  MIN_MARGIN_FBA: 0.10,     // Margem mínima FBA (10%)
  MIN_ROI: 0.15,            // ROI mínimo (15%)
  MIN_BSR_DROPS: 3,         // Mínimo de quedas de BSR no Keepa (= vendas nos últimos 30 dias)
  REJECT_IF_AMAZON_SELLS: true,  // Rejeitar se Amazon é vendedora
  MAX_SUPPLIER_PRICE: 80,   // Preço máximo do fornecedor (USD)
};

function normalizeRuleNumber(value, { allowZero = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (!allowZero && numeric <= 0) return null;
  if (allowZero && numeric < 0) return null;
  return numeric;
}

/**
 * Calcula o Buy Cost (custo total de aquisição).
 * Buy Cost = preço do fornecedor + taxa de prep
 */
export function calculateBuyCost(supplierPrice) {
  return supplierPrice + RULES.PREP_FEE;
}

/**
 * Calcula margem FBA.
 * Margem = (Amazon Price - FBA Fees - Buy Cost) / Amazon Price
 */
export function calculateMargin(amazonPrice, fbaFees, buyCost) {
  if (!amazonPrice || amazonPrice <= 0) return null;
  const profit = amazonPrice - fbaFees - buyCost;
  return profit / amazonPrice;
}

/**
 * Calcula ROI.
 * ROI = (Amazon Price - FBA Fees - Buy Cost) / Buy Cost
 */
export function calculateROI(amazonPrice, fbaFees, buyCost) {
  if (!buyCost || buyCost <= 0) return null;
  const profit = amazonPrice - fbaFees - buyCost;
  return profit / buyCost;
}

/**
 * Avalia um produto contra todas as regras de negócio.
 * Retorna decisão com motivos detalhados.
 *
 * @param {Object} product - Dados do produto
 * @param {number} product.supplierPrice - Preço no fornecedor
 * @param {number} product.amazonPrice - Preço na Amazon
 * @param {number} product.fbaFees - Taxas FBA totais
 * @param {boolean} product.amazonSells - Se Amazon vende o mesmo produto
 * @param {Object} product.keepaData - Dados do Keepa
 * @param {Object} product.azInsightData - Dados do AZInsight
 * @returns {Object} Decisão com status e motivos
 */
export function evaluateProduct(product) {
  const reasons = [];
  let status = 'approved';

  const {
    supplierPrice,
    amazonPrice,
    fbaFees,
    amazonSells = false,
    keepaData = {},
    azInsightData = {}
  } = product;

  const supplierPriceValue = normalizeRuleNumber(supplierPrice);
  const amazonPriceValue = normalizeRuleNumber(amazonPrice);
  const fbaFeesValue = normalizeRuleNumber(fbaFees, { allowZero: true });

  const markNeedsReview = reason => {
    reasons.push(reason);
    if (status !== 'rejected') status = 'needs_review';
  };

  const markRejected = reason => {
    reasons.push(reason);
    status = 'rejected';
  };

  // 1. Preço do fornecedor dentro do limite
  if (supplierPriceValue === null) {
    markNeedsReview('Preço do fornecedor ausente ou inválido para decisão automática');
  } else if (supplierPriceValue > RULES.MAX_SUPPLIER_PRICE) {
    markRejected(`Preco fornecedor ($${supplierPriceValue}) acima do limite ($${RULES.MAX_SUPPLIER_PRICE})`);
  }

  // 2. Amazon vende o produto
  if (RULES.REJECT_IF_AMAZON_SELLS && amazonSells) {
    markRejected('Amazon e vendedora direta deste produto');
  }

  if (amazonPriceValue === null) {
    markNeedsReview('Preço Amazon ausente ou inválido para cálculo de margem');
  }

  if (fbaFeesValue === null) {
    markNeedsReview('Taxas FBA ausentes ou inválidas para cálculo de margem');
  } else if (fbaFeesValue === 0) {
    markNeedsReview('Taxas FBA retornaram 0.00; confirmar AZInsight/selector antes de aprovar');
  }

  // 3. Calcular custos e margens
  const canCalculate = (
    supplierPriceValue !== null &&
    amazonPriceValue !== null &&
    fbaFeesValue !== null
  );

  const buyCost = canCalculate ? calculateBuyCost(supplierPriceValue) : null;
  const margin = canCalculate ? calculateMargin(amazonPriceValue, fbaFeesValue, buyCost) : null;
  const roi = canCalculate ? calculateROI(amazonPriceValue, fbaFeesValue, buyCost) : null;
  const profit = canCalculate ? amazonPriceValue - fbaFeesValue - buyCost : null;

  // 4. Verificar margem mínima
  if (margin !== null && margin < RULES.MIN_MARGIN_FBA) {
    markRejected(`Margem FBA (${(margin * 100).toFixed(1)}%) abaixo do minimo (${(RULES.MIN_MARGIN_FBA * 100)}%)`);
  }

  // 5. Verificar ROI mínimo
  if (roi !== null && roi < RULES.MIN_ROI) {
    markRejected(`ROI (${(roi * 100).toFixed(1)}%) abaixo do minimo (${(RULES.MIN_ROI * 100)}%)`);
  }

  // 6. Dados do Keepa — vendas históricas
  if (keepaData.available && keepaData.bsrDrops !== undefined) {
    if (keepaData.bsrDrops < RULES.MIN_BSR_DROPS) {
      markRejected(`Poucas vendas no Keepa (${keepaData.bsrDrops} quedas BSR, minimo ${RULES.MIN_BSR_DROPS})`);
    }
  }

  const decision = {
    status,
    buyCost,
    margin: margin !== null ? parseFloat((margin * 100).toFixed(2)) : null,
    roi: roi !== null ? parseFloat((roi * 100).toFixed(2)) : null,
    profit: profit !== null ? parseFloat(profit.toFixed(2)) : null,
    amazonPrice: amazonPriceValue,
    fbaFees: fbaFeesValue,
    supplierPrice: supplierPriceValue,
    supplierPriceStatus: supplierPriceValue === null ? 'missing' : 'ok',
    amazonPriceStatus: amazonPriceValue === null ? 'missing' : 'ok',
    fbaFeesStatus: (
      fbaFeesValue === null
        ? 'missing'
        : (fbaFeesValue === 0 ? 'zero_detected' : 'ok')
    ),
    amazonSells,
    reasons
  };

  const icon = status === 'approved' ? 'APROVADO' : status === 'rejected' ? 'REJEITADO' : 'REVISAO';
  log.info(
    `${icon}: margem=${decision.margin ?? 'n/a'}% roi=${decision.roi ?? 'n/a'}% ` +
    `lucro=$${decision.profit ?? 'n/a'} | ${reasons.join(' | ') || 'Sem restricoes'}`
  );

  return decision;
}

export { RULES };
