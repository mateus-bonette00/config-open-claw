import fs from 'fs';
import { spawn } from 'node:child_process';
import { createLogger, StateManager } from '../../core/index.js';

const AGENT_NAME = 'varredor-fornecedores';
const DEFAULT_PROFILE = process.env.SUPPLIER_SWEEP_PROFILE || 'varrer-fornecedores';
const DEFAULT_COMMAND = process.env.SUPPLIER_SWEEP_COMMAND || '/home/bonette/.openclaw/workspace/scripts/fba-automation-bot-command.sh';
const DEFAULT_LOG_PATH = process.env.SUPPLIER_SWEEP_LOG_PATH || '/home/bonette/apps/fba-automation/backend/logs/automation_run.log';
const DEFAULT_TABS = parseInt(process.env.SUPPLIER_SWEEP_DEFAULT_TABS || '10', 10);
const DEFAULT_MIN_PRICE = parseFloat(process.env.SUPPLIER_SWEEP_DEFAULT_MIN_PRICE || '0');
const DEFAULT_MAX_PRICE = parseFloat(process.env.SUPPLIER_SWEEP_DEFAULT_MAX_PRICE || '85');

const log = createLogger(AGENT_NAME);
const state = new StateManager(AGENT_NAME);

function normalizeInteger(value, fieldName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) throw new Error(`${fieldName} deve ser um numero inteiro.`);
  if (parsed < min) throw new Error(`${fieldName} deve ser maior ou igual a ${min}.`);
  if (parsed > max) throw new Error(`${fieldName} deve ser menor ou igual a ${max}.`);
  return parsed;
}

function normalizeMoney(value, fieldName, { min = 0, max = 999999 } = {}) {
  const normalized = String(value).trim().replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} deve ser um numero valido.`);
  if (parsed < min) throw new Error(`${fieldName} deve ser maior ou igual a ${min}.`);
  if (parsed > max) throw new Error(`${fieldName} deve ser menor ou igual a ${max}.`);
  return Number(parsed.toFixed(2));
}

function createRunId() {
  return `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function persistRun(run) {
  const runs = state.get('runs', []);
  runs.unshift(run);
  state.set('runs', runs.slice(0, 50));
  state.set('lastRun', run);
  return run;
}

function updateRun(runId, updates) {
  const runs = state.get('runs', []);
  const idx = runs.findIndex(run => run.id === runId);
  if (idx === -1) return null;
  runs[idx] = { ...runs[idx], ...updates, updatedAt: new Date().toISOString() };
  state.set('runs', runs);
  state.set('lastRun', runs[idx]);
  return runs[idx];
}

export function validateSweepRequest(input = {}) {
  const startIndex = normalizeInteger(input.startIndex ?? input.indiceInicial, 'indice inicial', { min: 1, max: 999999 });
  const endIndex = normalizeInteger(input.endIndex ?? input.indiceFinal, 'indice final', { min: 1, max: 999999 });
  const minPrice = normalizeMoney(input.minPrice ?? input.precoMinimo ?? DEFAULT_MIN_PRICE, 'preco minimo', { min: 0, max: 999999 });
  const maxPrice = normalizeMoney(input.maxPrice ?? input.precoMaximo ?? DEFAULT_MAX_PRICE, 'preco maximo', { min: 0, max: 999999 });
  const tabs = normalizeInteger(input.tabs ?? input.abas ?? DEFAULT_TABS, 'quantidade de abas', { min: 1, max: 50 });
  const profile = String(input.profile || input.perfil || DEFAULT_PROFILE).trim();

  if (!profile) throw new Error('perfil da automacao e obrigatorio.');
  if (startIndex > endIndex) throw new Error('indice inicial nao pode ser maior que o indice final.');
  if (minPrice > maxPrice) throw new Error('preco minimo nao pode ser maior que o preco maximo.');

  return {
    startIndex,
    endIndex,
    minPrice,
    maxPrice,
    tabs,
    profile
  };
}

export function buildSweepPrompt(params) {
  const request = validateSweepRequest(params);
  return [
    `iniciar ${request.profile}`,
    `indice-inicial=${request.startIndex}`,
    `indice-final=${request.endIndex}`,
    `preco-minimo=${request.minPrice.toFixed(2)}`,
    `preco-maximo=${request.maxPrice.toFixed(2)}`,
    `abas=${request.tabs}`
  ].join(' ');
}

export function getSweepStatus() {
  const lastRun = state.get('lastRun', null);
  const commandPath = process.env.SUPPLIER_SWEEP_COMMAND || DEFAULT_COMMAND;
  const logPath = process.env.SUPPLIER_SWEEP_LOG_PATH || DEFAULT_LOG_PATH;
  const logExists = fs.existsSync(logPath);

  return {
    commandPath,
    commandExists: fs.existsSync(commandPath),
    logPath,
    logExists,
    lastRun
  };
}

export async function startSupplierSweep(input = {}, options = {}) {
  const request = validateSweepRequest(input);
  const commandPath = process.env.SUPPLIER_SWEEP_COMMAND || DEFAULT_COMMAND;
  const prompt = buildSweepPrompt(request);
  const dryRun = Boolean(options.dryRun);

  const run = persistRun({
    id: createRunId(),
    status: dryRun ? 'dry-run' : 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prompt,
    commandPath,
    profile: request.profile,
    startIndex: request.startIndex,
    endIndex: request.endIndex,
    minPrice: request.minPrice,
    maxPrice: request.maxPrice,
    tabs: request.tabs,
    logPath: process.env.SUPPLIER_SWEEP_LOG_PATH || DEFAULT_LOG_PATH
  });

  if (dryRun) {
    log.info(`Dry-run do agente ${AGENT_NAME}: ${prompt}`);
    return {
      ...run,
      envPreview: {
        SUPPLIER_SWEEP_START_INDEX: String(request.startIndex),
        SUPPLIER_SWEEP_END_INDEX: String(request.endIndex),
        SUPPLIER_SWEEP_MIN_PRICE: request.minPrice.toFixed(2),
        SUPPLIER_SWEEP_MAX_PRICE: request.maxPrice.toFixed(2),
        SUPPLIER_SWEEP_TABS: String(request.tabs),
        SUPPLIER_SWEEP_PROFILE: request.profile
      }
    };
  }

  if (!fs.existsSync(commandPath)) {
    updateRun(run.id, { status: 'error', error: `Comando nao encontrado: ${commandPath}` });
    throw new Error(`Comando nao encontrado: ${commandPath}`);
  }

  const child = spawn(
    'bash',
    [commandPath, prompt],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        SUPPLIER_SWEEP_START_INDEX: String(request.startIndex),
        SUPPLIER_SWEEP_END_INDEX: String(request.endIndex),
        SUPPLIER_SWEEP_MIN_PRICE: request.minPrice.toFixed(2),
        SUPPLIER_SWEEP_MAX_PRICE: request.maxPrice.toFixed(2),
        SUPPLIER_SWEEP_TABS: String(request.tabs),
        SUPPLIER_SWEEP_PROFILE: request.profile
      }
    }
  );

  child.unref();

  const updatedRun = updateRun(run.id, {
    status: 'started',
    startedAt: new Date().toISOString(),
    pid: child.pid || null
  });

  log.info(
    `Varredura iniciada: perfil=${request.profile} indices=${request.startIndex}-${request.endIndex} ` +
    `preco=${request.minPrice.toFixed(2)}-${request.maxPrice.toFixed(2)} abas=${request.tabs} pid=${child.pid || 'n/a'}`
  );

  return updatedRun;
}

function printHelp() {
  console.log([
    'Uso:',
    '  node agents/varredor-fornecedores/index.js --start-index 1 --end-index 50 --min-price 0 --max-price 85 --tabs 10',
    '',
    'Opcoes:',
    '  --start-index <n>   Indice inicial da planilha',
    '  --end-index <n>     Indice final da planilha',
    '  --min-price <n>     Preco minimo',
    '  --max-price <n>     Preco maximo',
    '  --tabs <n>          Quantidade de abas abertas por vez',
    '  --profile <nome>    Perfil da automacao (padrao: varrer-fornecedores)',
    '  --dry-run           Monta a execucao, mas nao dispara comando externo',
    '  --status            Mostra ultimo status salvo do agente',
    '  --help              Mostra esta ajuda'
  ].join('\n'));
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

if (process.argv[1]?.endsWith('varredor-fornecedores/index.js')) {
  const wantsHelp = process.argv.includes('--help') || process.argv.includes('-h');
  const wantsStatus = process.argv.includes('--status');

  if (wantsHelp) {
    printHelp();
  } else if (wantsStatus) {
    console.log(JSON.stringify(getSweepStatus(), null, 2));
  } else if (process.argv.includes('--start-index') || process.argv.includes('--end-index')) {
    startSupplierSweep(
      {
        startIndex: readArg('--start-index'),
        endIndex: readArg('--end-index'),
        minPrice: readArg('--min-price'),
        maxPrice: readArg('--max-price'),
        tabs: readArg('--tabs'),
        profile: readArg('--profile')
      },
      { dryRun: process.argv.includes('--dry-run') }
    )
      .then(result => {
        console.log(JSON.stringify(result, null, 2));
      })
      .catch(err => {
        log.error(`Falha ao iniciar varredura: ${err.message}`);
        process.exitCode = 1;
      });
  } else {
    printHelp();
  }
}
