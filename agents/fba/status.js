import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.join(__dirname, '..', '..');
const STATE_DIR = process.env.STATE_DIR || path.join(PROJECT_DIR, 'storage', 'state');

export const FBA_AGENT_TECHNICAL_ID = 'fba-amazon';
export const FBA_AGENT_DISPLAY_NAME = 'LUCAS1';
export const FBA_STATUS_PATH = process.env.FBA_STATUS_PATH || path.join(STATE_DIR, 'fba-status.json');

export function createSessionId(date = new Date()) {
  return `${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${process.pid}`;
}

function nowIso() {
  return new Date().toISOString();
}

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function normalizeError(error) {
  if (!error) return null;
  if (typeof error === 'string') {
    return { message: error, at: nowIso() };
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name, at: nowIso() };
  }
  return error;
}

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function summarizeProductResults(results = {}) {
  const values = Object.values(results || {});

  return {
    processedCount: values.length,
    approvedCount: values.filter(result => result.status === 'approved').length,
    rejectedCount: values.filter(result => result.status === 'rejected').length,
    needsReviewCount: values.filter(result => result.status === 'needs_review').length,
    skippedCount: values.filter(result => result.status === 'skipped').length,
    errorCount: values.filter(result => result.status === 'error').length
  };
}

function progressPct(processedCount, totalProducts) {
  const total = Number(totalProducts) || 0;
  if (total <= 0) return 0;
  return Number(Math.min(100, (processedCount / total) * 100).toFixed(2));
}

export function createFbaStatusWriter({
  sessionId = createSessionId(),
  sessionStart = nowIso(),
  mode = 'auto',
  inputHtmlPath = '',
  totalProducts = 0,
  statusPath = FBA_STATUS_PATH
} = {}) {
  let snapshot = {
    agentTechnicalId: FBA_AGENT_TECHNICAL_ID,
    agentDisplayName: FBA_AGENT_DISPLAY_NAME,
    status: 'stopped',
    currentStep: 'stopped',
    mode,
    sessionId,
    sessionStart,
    updatedAt: sessionStart,
    lastProcessedIndex: -1,
    totalProducts,
    processedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    needsReviewCount: 0,
    skippedCount: 0,
    errorCount: 0,
    progressPct: 0,
    lastError: null,
    reportPath: null,
    inputHtmlPath,
    sheetSyncStatus: 'not-started',
    sheetRowsWritten: 0
  };

  const write = patch => {
    const normalizedPatch = cleanUndefined(patch || {});
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'lastError')) {
      normalizedPatch.lastError = normalizeError(normalizedPatch.lastError);
    }

    snapshot = {
      ...snapshot,
      ...normalizedPatch,
      updatedAt: nowIso()
    };

    writeJsonAtomic(statusPath, snapshot);
    return snapshot;
  };

  return {
    filePath: statusPath,
    getSnapshot() {
      return snapshot;
    },
    update(patch = {}) {
      return write(patch);
    },
    updateFromState(state, patch = {}) {
      const data = state?.data || {};
      const stats = summarizeProductResults(data.productResults || {});
      const total = patch.totalProducts ?? data.totalProducts ?? snapshot.totalProducts;
      const hasStateLastError = Object.prototype.hasOwnProperty.call(data, 'lastError');
      const nextPatch = {
        lastProcessedIndex: data.lastProcessedIndex ?? snapshot.lastProcessedIndex,
        totalProducts: total,
        ...stats,
        progressPct: progressPct(stats.processedCount, total),
        lastError: hasStateLastError ? data.lastError : snapshot.lastError,
        reportPath: data.reportPath ?? snapshot.reportPath,
        inputHtmlPath: data.htmlFile ?? snapshot.inputHtmlPath,
        sheetSyncStatus: data.sheetSyncStatus ?? snapshot.sheetSyncStatus,
        sheetRowsWritten: data.sheetRowsWritten ?? snapshot.sheetRowsWritten,
        ...patch
      };

      return write(nextPatch);
    }
  };
}
