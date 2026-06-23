import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createLogger, config } from '../../core/index.js';
import { retrieveContext, getIndexMeta } from './retriever.js';

const log = createLogger('zoe-conhecimento');

const DEFAULT_ALLOWED_OWNER_PHONES = ['5535998183459', '553598183459'];

function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function getAllowedPhones() {
  const fromEnv = (process.env.WHATSAPP_TAREFAS_ALLOWED_PHONES || '')
    .split(',')
    .map((value) => normalizePhone(value))
    .filter(Boolean);
  return [...new Set([...fromEnv, ...DEFAULT_ALLOWED_OWNER_PHONES])];
}

function ensureOwnerPhone(value) {
  const normalized = normalizePhone(value);
  if (!normalized) throw new Error('Telefone é obrigatório.');
  if (!getAllowedPhones().includes(normalized)) {
    throw new Error('Telefone não autorizado a usar /zoe-sabe.');
  }
  return normalized;
}

function parseCommandPayload(input, prefixes = []) {
  for (const prefix of prefixes) {
    if (!input.startsWith(prefix)) continue;
    return input.slice(prefix.length).trim();
  }
  return null;
}

const RAG_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    'Você é a Zoe respondendo com base apenas no contexto fornecido, extraído do histórico real do usuário. ' +
      'Se a resposta não estiver no contexto, diga claramente que não tem essa informação — nunca invente. ' +
      'Responda em português, direto, sem rodeios.',
  ],
  [
    'human',
    'Contexto:\n{context}\n\nPergunta: {question}',
  ],
]);

function formatContext(chunks) {
  return chunks.map((c, idx) => `[${idx + 1}] (${c.source})\n${c.text}`).join('\n\n');
}

function formatSources(chunks) {
  const unique = [...new Set(chunks.map((c) => c.source))];
  return unique.length > 0 ? `\n\nFontes: ${unique.join(', ')}` : '';
}

export async function handleSlashCommand({ text, phone }) {
  const input = String(text ?? '').trim();
  const question = parseCommandPayload(input, ['/zoe-sabe ', '/pergunta ']);
  if (question === null) return null;
  if (!question) return 'Formato inválido. Use: /zoe-sabe SUA PERGUNTA';

  ensureOwnerPhone(phone);

  const meta = getIndexMeta();
  if (!meta?.totalChunks) {
    return 'Base de conhecimento ainda não foi indexada. Rode "npm run conhecimento:ingest" no servidor.';
  }

  try {
    const chunks = await retrieveContext(question, { topK: 4 });
    if (chunks.length === 0) {
      return 'Não encontrei nada relacionado a isso na base de conhecimento.';
    }

    const chatModel = new ChatGoogleGenerativeAI({
      apiKey: config.googleGenAI.apiKey,
      model: config.googleGenAI.chatModel,
      temperature: 0,
    });

    const prompt = await RAG_PROMPT.formatMessages({
      context: formatContext(chunks),
      question,
    });
    const response = await chatModel.invoke(prompt);

    return `${response.content}${formatSources(chunks)}`;
  } catch (err) {
    log.error(`Falha ao responder /zoe-sabe: ${err.message}`);
    return 'Deu erro ao consultar a base de conhecimento. Verifique os logs do zoe-conhecimento.';
  }
}

if (process.argv[1]?.endsWith('zoe-conhecimento/index.js')) {
  const question = process.argv.slice(2).join(' ') || '/zoe-sabe teste';
  const phone = process.env.WHATSAPP_REMINDER_DEFAULT_PHONE || '553598183459';
  handleSlashCommand({ text: question, phone })
    .then((result) => {
      console.log(result);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
