import { createLogger } from '../../core/logger.js';
import { appendProduct } from '../../integrations/google-sheets/index.js';

const log = createLogger('fba-sheets-sync');

function isDisabled() {
  return ['0', 'false', 'no', 'off'].includes(
    String(process.env.FBA_SYNC_SHEETS || 'true').toLowerCase()
  );
}

function compact(value) {
  return String(value || '').trim();
}

export function buildSheetSyncKey(product) {
  const asin = compact(product.asin);
  const upc = compact(product.upc);
  const supplierUrl = compact(product.supplierUrl);
  const index = compact(product.index);

  return [asin || 'no-asin', upc || 'no-upc', supplierUrl || index || 'no-index'].join('|');
}

export function getApprovedProductsFromState(state) {
  const results = state.get('productResults', {});
  return Object.entries(results)
    .filter(([, result]) => result.status === 'approved')
    .map(([index, result]) => ({
      index: parseInt(index, 10),
      ...result
    }))
    .sort((a, b) => (b.profit || 0) - (a.profit || 0));
}

function markProductSynced(state, product, syncKey, syncedAt) {
  const syncedKeys = state.get('sheetSyncedKeys', {});
  state.setMany({
    sheetSyncedKeys: {
      ...syncedKeys,
      [syncKey]: {
        productIndex: product.index,
        asin: product.asin || '',
        name: product.name || product.amazonTitle || '',
        syncedAt
      }
    }
  });
  state.updateProductResult(product.index, {
    sheetSyncStatus: 'synced',
    sheetSyncedAt: syncedAt,
    sheetSyncKey: syncKey
  });
}

function isAlreadySynced(state, product, syncKey) {
  const syncedKeys = state.get('sheetSyncedKeys', {});
  return Boolean(
    syncedKeys[syncKey] ||
    product.sheetSyncedAt ||
    product.sheetSyncStatus === 'synced'
  );
}

export async function syncApprovedProductsToSheets({ state, approvedProducts, updateStatus = () => {} }) {
  const approved = approvedProducts || getApprovedProductsFromState(state);

  if (isDisabled()) {
    state.setMany({
      sheetSyncStatus: 'disabled',
      sheetRowsWritten: 0
    });
    updateStatus({ sheetSyncStatus: 'disabled', sheetRowsWritten: 0 });
    log.info('Sincronizacao Google Sheets desativada por FBA_SYNC_SHEETS.');
    return { status: 'disabled', rowsWritten: 0, skipped: approved.length };
  }

  if (approved.length === 0) {
    state.setMany({
      sheetSyncStatus: 'skipped-no-approved',
      sheetRowsWritten: 0
    });
    updateStatus({ sheetSyncStatus: 'skipped-no-approved', sheetRowsWritten: 0 });
    log.info('Google Sheets: nenhum produto aprovado para sincronizar.');
    return { status: 'skipped-no-approved', rowsWritten: 0, skipped: 0 };
  }

  const unsynced = approved
    .map(product => ({ product, syncKey: buildSheetSyncKey(product) }))
    .filter(({ product, syncKey }) => !isAlreadySynced(state, product, syncKey));

  if (unsynced.length === 0) {
    state.setMany({
      sheetSyncStatus: 'up-to-date',
      sheetRowsWritten: 0
    });
    updateStatus({ sheetSyncStatus: 'up-to-date', sheetRowsWritten: 0 });
    log.info('Google Sheets: todos os aprovados ja estavam sincronizados.');
    return { status: 'up-to-date', rowsWritten: 0, skipped: approved.length };
  }

  state.setMany({
    sheetSyncStatus: 'running',
    sheetRowsWritten: 0
  });
  updateStatus({
    currentStep: 'sheets-sync',
    sheetSyncStatus: 'running',
    sheetRowsWritten: 0
  });

  let rowsWritten = 0;
  for (const { product, syncKey } of unsynced) {
    try {
      await appendProduct({
        ...product,
        sheetSyncKey: syncKey
      });

      rowsWritten += 1;
      const syncedAt = new Date().toISOString();
      markProductSynced(state, product, syncKey, syncedAt);
      state.setMany({
        sheetSyncStatus: 'running',
        sheetRowsWritten: rowsWritten
      });
      updateStatus({
        sheetSyncStatus: 'running',
        sheetRowsWritten: rowsWritten
      });
    } catch (err) {
      const message = err.message || String(err);
      const errorPayload = {
        step: 'sheets-sync',
        at: new Date().toISOString(),
        message,
        nonFatal: true
      };

      state.setMany({
        sheetSyncStatus: 'error',
        sheetRowsWritten: rowsWritten,
        lastError: errorPayload
      });
      updateStatus({
        sheetSyncStatus: 'error',
        sheetRowsWritten: rowsWritten,
        lastError: errorPayload
      });

      log.warn(`Google Sheets falhou, mas o agente vai continuar: ${message}`);
      return { status: 'error', rowsWritten, skipped: approved.length - rowsWritten, error: message };
    }
  }

  state.setMany({
    sheetSyncStatus: 'synced',
    sheetRowsWritten: rowsWritten,
    lastError: null
  });
  updateStatus({
    sheetSyncStatus: 'synced',
    sheetRowsWritten: rowsWritten,
    lastError: null
  });
  log.info(`Google Sheets: ${rowsWritten} produtos aprovados sincronizados.`);
  return { status: 'synced', rowsWritten, skipped: approved.length - rowsWritten };
}
