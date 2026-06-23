import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { StateManager, config } from '../../core/index.js';

const indexState = new StateManager('zoe-conhecimento-index');

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function getIndexMeta() {
  indexState.reload();
  return indexState.get('meta', { totalChunks: 0 });
}

export async function retrieveContext(query, { topK = 4 } = {}) {
  indexState.reload();
  const chunks = indexState.get('chunks', []);
  if (chunks.length === 0) return [];

  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: config.googleGenAI.apiKey,
    model: config.googleGenAI.embeddingModel,
  });
  const [queryEmbedding] = await embeddings.embedDocuments([query]);

  const ranked = chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return ranked.map(({ chunk, score }) => ({
    text: chunk.text,
    source: chunk.source,
    score,
  }));
}
