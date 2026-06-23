import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { createLogger, StateManager, config, getSecretOrThrow } from '../../core/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

const log = createLogger('zoe-conhecimento');
const indexState = new StateManager('zoe-conhecimento-index');

const STATE_JSON_SOURCES = [
  { file: 'storage/state/fba.json', label: 'fba.json' },
  { file: 'storage/state/zoe-tarefas-prioridade.json', label: 'zoe-tarefas-prioridade.json' },
  { file: 'storage/state/whatsapp-lembretes.json', label: 'whatsapp-lembretes.json', fallbackBak: true },
];

const MARKDOWN_SOURCES = [
  'storage/state/COMMANDS.md',
  'docs/RUNBOOK.md',
  'docs/Guia-Para-Open-Claw.md',
];

function readJsonSource({ file, fallbackBak }) {
  const absPath = path.join(ROOT_DIR, file);
  if (fs.existsSync(absPath)) {
    return JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  }
  if (fallbackBak && fs.existsSync(`${absPath}.bak`)) {
    log.info(`${file} ausente, usando .bak como fallback.`);
    return JSON.parse(fs.readFileSync(`${absPath}.bak`, 'utf-8'));
  }
  log.warn(`Fonte ausente, ignorando: ${file}`);
  return null;
}

function chunksFromFba(data, label) {
  const products = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
  return products.map((product, idx) => ({
    id: `${label}-${product.id ?? idx}`,
    source: label,
    text: [
      `Produto: ${product.title ?? product.name ?? 'sem titulo'}`,
      `Status: ${product.status ?? product.approved ? 'aprovado' : 'rejeitado'}`,
      `Motivo: ${product.reason ?? product.rejectionReason ?? 'nao informado'}`,
      `Margem: ${product.margin ?? 'nao informado'}`,
      `ROI: ${product.roi ?? 'nao informado'}`,
      `Preco de custo: ${product.costPrice ?? 'nao informado'}`,
      `Preco Amazon: ${product.amazonPrice ?? 'nao informado'}`,
    ].join('\n'),
    metadata: { source: label, productId: product.id ?? idx },
  }));
}

function chunksFromTaskState(data, label) {
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  return tasks.map((task, idx) => ({
    id: `${label}-${task.id ?? idx}`,
    source: label,
    text: [
      `Tarefa: ${task.title ?? 'sem titulo'}`,
      `Prioridade: ${task.priority ?? 'nao definida'}`,
      `Importancia: ${task.importance ?? 'nao definida'}`,
      `Status: ${task.status ?? (task.completed ? 'concluida' : 'pendente')}`,
      `Criada em: ${task.createdAt ?? 'nao informado'}`,
    ].join('\n'),
    metadata: { source: label, taskId: task.id ?? idx },
  }));
}

async function chunksFromMarkdown(relPath, splitter) {
  const absPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(absPath)) {
    log.warn(`Markdown ausente, ignorando: ${relPath}`);
    return [];
  }
  const content = fs.readFileSync(absPath, 'utf-8');
  const docs = await splitter.splitText(content);
  return docs.map((text, idx) => ({
    id: `${relPath}-${idx}`,
    source: relPath,
    text,
    metadata: { source: relPath, chunkIndex: idx },
  }));
}

async function embedInBatches(embeddings, chunks, batchSize = 20) {
  const vectors = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchVectors = await embeddings.embedDocuments(batch.map((c) => c.text));
    vectors.push(...batchVectors);
    log.info(`Embeddings gerados: ${Math.min(i + batchSize, chunks.length)}/${chunks.length}`);
  }
  return vectors;
}

async function main() {
  getSecretOrThrow('GOOGLE_GENAI_API_KEY');

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 100 });
  let chunks = [];

  for (const source of STATE_JSON_SOURCES) {
    const data = readJsonSource(source);
    if (!data) continue;
    if (source.file.includes('fba.json')) chunks.push(...chunksFromFba(data, source.label));
    else chunks.push(...chunksFromTaskState(data, source.label));
  }

  for (const relPath of MARKDOWN_SOURCES) {
    chunks.push(...(await chunksFromMarkdown(relPath, splitter)));
  }

  if (chunks.length === 0) {
    log.warn('Nenhum chunk gerado. Verifique se as fontes de dados existem.');
    return;
  }

  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: config.googleGenAI.apiKey,
    model: config.googleGenAI.embeddingModel,
  });

  log.info(`Gerando embeddings para ${chunks.length} chunks com ${config.googleGenAI.embeddingModel}...`);
  const vectors = await embedInBatches(embeddings, chunks);

  const indexed = chunks.map((chunk, idx) => ({ ...chunk, embedding: vectors[idx] }));

  indexState.setMany({
    chunks: indexed,
    meta: {
      builtAt: new Date().toISOString(),
      embeddingModel: config.googleGenAI.embeddingModel,
      totalChunks: indexed.length,
    },
  });

  log.info(`Indice salvo em storage/state/zoe-conhecimento-index.json com ${indexed.length} chunks.`);
}

main().catch((err) => {
  log.error(`Falha na ingestao: ${err.message}`);
  process.exit(1);
});
