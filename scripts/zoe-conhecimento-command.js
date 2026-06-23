#!/usr/bin/env node
import { handleSlashCommand } from '../agents/zoe-conhecimento/index.js';

const args = process.argv.slice(2);
const phoneFlagIndex = args.indexOf('--phone');
const phone = phoneFlagIndex >= 0 ? args[phoneFlagIndex + 1] : process.env.WHATSAPP_REMINDER_DEFAULT_PHONE || '553598183459';
const text = phoneFlagIndex >= 0 ? args.slice(0, phoneFlagIndex).join(' ') : args.join(' ');

handleSlashCommand({ text, phone })
  .then((result) => {
    console.log(result ?? 'Comando não reconhecido.');
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
