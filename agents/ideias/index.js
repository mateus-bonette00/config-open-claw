import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { createLogger, StateManager, schedule } from '../../core/index.js';

const AGENT_ID = 'ideias';
const DISPLAY_NAME = 'Zoe Ideias';
const log = createLogger(AGENT_ID);
const state = new StateManager(AGENT_ID);

const OPENCLAW_SEND_TIMEOUT_MS = 25000;

const CATEGORIES = {
  INNOVATION: { emoji: '🚀', name: 'Inovação & Loucuras' },
  CONTENT: { emoji: '📝', name: 'Conteúdo & Escrita' },
  IMPROVEMENT: { emoji: '🔧', name: 'Melhorias' },
  BUSINESS: { emoji: '💼', name: 'Negócios & Grana' },
  RANDOM: { emoji: '🎲', name: 'Ideia Aleatória' }
};

let schedulerStarted = false;

function resolveOpenClawBin() {
  const home = process.env.HOME || os.homedir() || '/home/bonette';
  const candidates = [
    process.env.OPENCLAW_BIN,
    path.join(home, 'bin/openclaw'),
    path.join(home, '.nvm/current/bin/openclaw'),
    path.join(home, '.local/openclaw-node22/current/bin/openclaw'),
    path.join(home, '.local/openclaw-node22/bin/openclaw'),
    '/home/bonette/bin/openclaw',
    '/home/bonette/.nvm/current/bin/openclaw'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (err) {
      log.warn(`Falha ao verificar OpenClaw bin em ${candidate}: ${err.message}`);
    }
  }

  return 'openclaw';
}

function resolveConfiguredOwnerPhone() {
  return String(
    process.env.WHATSAPP_IDEIAS_OWNER_PHONE ||
    process.env.WHATSAPP_OWNER_PHONE ||
    '553598183459'
  ).replace(/\D/g, '');
}

async function sendViaOpenClaw(phone, message) {
  const target = `+${phone}`;
  const bin = process.env.OPENCLAW_BIN || resolveOpenClawBin();
  const args = [
    'message',
    'send',
    '--channel', process.env.WHATSAPP_IDEIAS_CHANNEL || 'whatsapp',
    '--account', process.env.WHATSAPP_IDEIAS_ACCOUNT || 'default',
    '--target', target,
    '--message', message,
    '--json'
  ];

  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      timeout: OPENCLAW_SEND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env }
    }, (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function sendIdeasSummary() {
  const ideas = state.get('ideias', []);
  const phone = resolveConfiguredOwnerPhone();
  
  if (ideas.length === 0) {
    log.info('Sem ideias para enviar no resumo diário.');
    return;
  }

  let response = "🌟 *Seu Resumo de Ideias Brilhantes:*\n\n";
  ideas.forEach((item, index) => {
    response += `${index + 1}. ${item.categoryEmoji} - ${item.text}\n`;
  });

  try {
    await sendViaOpenClaw(phone, response);
    log.info(`Resumo de ideias enviado para ${phone}`);
  } catch (error) {
    log.error(`Erro ao enviar resumo de ideias: ${error.message}`);
  }
}

function classifyIdea(text) {
  const lowerText = text.toLowerCase();
  if (lowerText.match(/app|ia|sistema|software|tecnologia|inventar|criar algo novo/)) {
    return CATEGORIES.INNOVATION;
  }
  if (lowerText.match(/video|post|artigo|escrever|livro|canal|youtube|instagram|tiktok/)) {
    return CATEGORIES.CONTENT;
  }
  if (lowerText.match(/melhorar|otimizar|arrumar|consertar|jeito melhor|processo/)) {
    return CATEGORIES.IMPROVEMENT;
  }
  if (lowerText.match(/vender|produto|servico|dinheiro|cliente|empresa|startup/)) {
    return CATEGORIES.BUSINESS;
  }
  return CATEGORIES.RANDOM;
}

function generateCreativeResponse(idea, category) {
  const responses = [
    `Uau! Guardei essa na gaveta de ${category.name} ${category.emoji}. A semente foi plantada! 🌱`,
    `Hmm, genial! A categoria ${category.name} ${category.emoji} acabou de ficar mais rica.`,
    `Anotado! ${category.emoji} A sua ideia foi para o cofre de ${category.name}. Quem sabe quando ela vai germinar? 🌳`,
    `Incrível. ${category.name} ${category.emoji} ganhou uma nova perspectiva hoje.`
  ];
  const response = responses[Math.floor(Math.random() * responses.length)];
  return `💡 *Ideia Capturada!*\n\n"${idea}"\n\n${response}`;
}

export function handleIdeiaCommand({ text, phone }) {
  log.info(`Recebida nova ideia de ${phone}: ${text.substring(0, 50)}...`);
  
  if (!text) {
    return "💡 Você esqueceu de me contar a ideia! Mande algo como: 'Zoe tive uma ideia sobre...'";
  }

  const lowerText = text.trim().toLowerCase();

  // Comandos especiais: listar ideias
  if (
    lowerText === 'listar' || 
    lowerText === '/ideia-listar' || 
    lowerText === 'listar ideias' || 
    lowerText === 'lista as ideias' || 
    lowerText === 'zoe listar ideias' ||
    lowerText === 'zoe, listar ideias' ||
    lowerText === 'zoe lista ideias'
  ) {
    const ideas = state.get('ideias', []);
    if (ideas.length === 0) {
      return "🌪️ Sua gaveta de ideias está vazia no momento. Que tal colocar algo lá?";
    }

    let response = "📚 *Sua Gaveta de Ideias:*\n\n";
    ideas.forEach((item, index) => {
      response += `${index + 1}. ${item.categoryEmoji} - ${item.text}\n`;
    });
    return response;
  }

  // Remove prefixos comuns de adição
  let ideaText = text.trim();
  const prefixes = [
    /^zoe[, ]*tive uma ideia[:\s]*/i,
    /^zoe[, ]*adiciona a ideia[:\s]*/i,
    /^zoe[, ]*adiciona uma ideia[:\s]*/i,
    /^tive uma ideia[:\s]*/i,
    /^adiciona a ideia[:\s]*/i,
    /^adiciona uma ideia[:\s]*/i,
    /^\/ideia-add\s+/i
  ];
  for (const prefix of prefixes) {
    if (prefix.test(ideaText)) {
      ideaText = ideaText.replace(prefix, '').trim();
      break;
    }
  }

  if (!ideaText) {
    return "💡 Você esqueceu de me contar a ideia! Mande algo como: 'Zoe tive uma ideia sobre...'";
  }

  const category = classifyIdea(ideaText);
  const newIdea = {
    text: ideaText,
    categoryName: category.name,
    categoryEmoji: category.emoji,
    createdAt: new Date().toISOString(),
    phone: phone
  };

  const ideas = state.get('ideias', []);
  ideas.push(newIdea);
  state.set('ideias', ideas);

  return generateCreativeResponse(ideaText, category);
}

export function startScheduler() {
  if (schedulerStarted) return;
  const timezone = process.env.WHATSAPP_TIMEZONE || 'America/Sao_Paulo';

  schedule('zoe-ideias-summary-morning', '30 10 * * *', sendIdeasSummary, timezone);
  schedule('zoe-ideias-summary-afternoon', '30 14 * * *', sendIdeasSummary, timezone);

  schedulerStarted = true;
  log.info(`Scheduler iniciado para ${DISPLAY_NAME} (10:30 e 14:30 no timezone ${timezone}).`);
}
