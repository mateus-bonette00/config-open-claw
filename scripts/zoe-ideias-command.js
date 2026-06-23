#!/usr/bin/env node
import { handleIdeiaCommand } from '../agents/ideias/index.js';

const args = process.argv.slice(2);
const phoneFlagIndex = args.indexOf('--phone');
const phone = phoneFlagIndex >= 0
  ? args[phoneFlagIndex + 1]
  : process.env.WHATSAPP_OWNER_PHONE
    || '553598183459';

const textArgs = phoneFlagIndex >= 0
  ? args.filter((_, idx) => idx !== phoneFlagIndex && idx !== phoneFlagIndex + 1)
  : args;

const text = textArgs.join(' ').trim();

if (!text) {
  console.error('Uso: node scripts/zoe-ideias-command.js "criar um app de produtividade" --phone 553598183459');
  process.exit(1);
}

try {
  const result = handleIdeiaCommand({ text, phone });
  console.log(result);
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
