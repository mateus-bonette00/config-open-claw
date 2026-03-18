#!/usr/bin/env node
import { handleSlashCommand } from '../agents/whatsapp-lembretes/index.js';

const args = process.argv.slice(2);
const phoneFlagIndex = args.indexOf('--phone');
const phone = phoneFlagIndex >= 0 ? args[phoneFlagIndex + 1] : process.env.WHATSAPP_LEMBRETES_OWNER_PHONE || '553598183459';
const textArgs = phoneFlagIndex >= 0 ? args.filter((_, idx) => idx !== phoneFlagIndex && idx !== phoneFlagIndex + 1) : args;
const text = textArgs.join(' ').trim();

if (!text) {
  console.error('Uso: node scripts/whatsapp-lembretes-command.js \"/comandos\" --phone 553598183459');
  process.exit(1);
}

try {
  const result = handleSlashCommand({ text, phone });
  if (!result) {
    console.error('Comando invalido. Use /comandos para ajuda.');
    process.exit(1);
  }
  console.log(result);
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
