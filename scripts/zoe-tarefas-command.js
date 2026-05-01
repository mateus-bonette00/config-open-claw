#!/usr/bin/env node
import { handleTaskCommand } from '../agents/zoe-tarefas-prioridade/index.js';

const args = process.argv.slice(2);
const phoneFlagIndex = args.indexOf('--phone');
const phone = phoneFlagIndex >= 0
  ? args[phoneFlagIndex + 1]
  : process.env.WHATSAPP_TAREFAS_OWNER_PHONE
    || process.env.WHATSAPP_AFAZERES_OWNER_PHONE
    || process.env.WHATSAPP_LEMBRETES_OWNER_PHONE
    || process.env.WHATSAPP_REMINDER_DEFAULT_PHONE
    || '553598183459';

const textArgs = phoneFlagIndex >= 0
  ? args.filter((_, idx) => idx !== phoneFlagIndex && idx !== phoneFlagIndex + 1)
  : args;

const text = textArgs.join(' ').trim();

if (!text) {
  console.error('Uso: node scripts/zoe-tarefas-command.js "/afazer-add pagar boleto" --phone 553598183459');
  process.exit(1);
}

try {
  const result = handleTaskCommand({ text, phone });
  console.log(result);
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
