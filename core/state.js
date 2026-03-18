import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.STATE_DIR || path.join(__dirname, '..', 'storage', 'state');

/**
 * Persistência de estado para agentes — permite pausar e retomar processamento.
 * Salva JSON em disco, com backup automático antes de cada escrita.
 */
export class StateManager {
  constructor(agentName) {
    this.agentName = agentName;
    this.filePath = path.join(STATE_DIR, `${agentName}.json`);
    this.data = this._load();
  }

  _ensureDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch (err) {
      console.error(`[StateManager] Erro ao carregar estado de ${this.agentName}:`, err.message);
    }
    return {};
  }

  save() {
    this._ensureDir();
    // Backup antes de salvar
    if (fs.existsSync(this.filePath)) {
      fs.copyFileSync(this.filePath, this.filePath + '.bak');
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  get(key, defaultValue = undefined) {
    return this.data[key] ?? defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
    return this;
  }

  /**
   * Para o agente FBA: rastreia quais produtos já foram processados.
   * Retorna o índice do último produto processado (-1 se nenhum).
   */
  getLastProcessedIndex() {
    return this.get('lastProcessedIndex', -1);
  }

  setLastProcessedIndex(index) {
    this.set('lastProcessedIndex', index);
    this.set('lastProcessedAt', new Date().toISOString());
  }

  /**
   * Registra resultado de um produto individual
   */
  addProductResult(index, result) {
    const results = this.get('productResults', {});
    results[index] = {
      ...result,
      processedAt: new Date().toISOString()
    };
    this.set('productResults', results);
  }

  getStats() {
    const results = this.get('productResults', {});
    const values = Object.values(results);
    return {
      total: values.length,
      approved: values.filter(r => r.status === 'approved').length,
      rejected: values.filter(r => r.status === 'rejected').length,
      skipped: values.filter(r => r.status === 'skipped').length,
      errors: values.filter(r => r.status === 'error').length
    };
  }

  reset() {
    this.data = {};
    this.save();
  }
}
