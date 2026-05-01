---
name: openclaw-whatsapp-lembretes-ops
description: Use para operar e resolver problemas do agente whatsapp-lembretes (comandos, textos, lembretes, tarefas e follow-ups). Acione sempre que o usuario falar de WhatsApp, comandos com "/", telefone nao autorizado, ou falha no envio.
---

# OpenClaw WhatsApp Lembretes Ops (agente whatsapp-lembretes)

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


## Objetivo (1 frase)
Manter os comandos e lembretes do WhatsApp funcionando com seguranca e previsibilidade.

## Formato de resposta (obrigatorio)
1. Responder sempre em passos numerados.
2. Linguagem simples e direta.
3. Sempre incluir 1 exemplo pratico no final.
4. Se envolver site/painel, incluir link direto.

## Quando usar (gatilhos)
1. Zoe nao responde a comandos como `/comandos`.
2. Erro ao salvar/ver/apagar comando ou texto.
3. Lembrete ou follow-up nao envia.
4. Mensagem de "phone nao autorizado".

## Antes de comecar (perguntas obrigatorias)
1. Qual comando foi enviado (copie e cole)?
2. Qual telefone foi usado?
3. Qual erro apareceu (texto exato)?

## Arquivos principais (abrir primeiro)
1. `agents/whatsapp-lembretes/index.js`
2. `scripts/whatsapp-lembretes-command.js`
3. `.env`
4. `storage/logs/whatsapp-lembretes.log`
5. `storage/state/whatsapp-lembretes.json`

## Guia rapido (passo a passo)
1. Confirme o comando e o telefone usado.
2. Abra `.env` e confira `WHATSAPP_API_URL`, `WHATSAPP_API_TOKEN`, `WHATSAPP_INSTANCE` e `WHATSAPP_LEMBRETES_OWNER_PHONE` (ou `WHATSAPP_REMINDER_DEFAULT_PHONE`).
3. Abra o log do agente: `storage/logs/whatsapp-lembretes.log` (use `tail -n 100 ...`).
4. Abra o estado: `storage/state/whatsapp-lembretes.json` e veja `reminders`, `tasks`, `followUps`.
5. Teste local com o comando CLI: `npm run wa:cmd -- "/comandos" --phone 553598183459`.
6. Se falhar, revise a funcao `handleSlashCommand` em `agents/whatsapp-lembretes/index.js`.
7. Aplique a mudanca minima e teste de novo.
8. Registre o resultado e o proximo passo.

## Fluxos comuns (passo a passo)
### 1) Zoe nao responde a `/comandos`
1. Confirme se o texto comeca com `/`.
2. Confirme se o telefone e o do dono (mesmo numero do `.env`).
3. Rode: `npm run wa:cmd -- "/comandos" --phone 553598183459`.
4. Se falhar, veja o log em `storage/logs/whatsapp-lembretes.log`.
5. Corrija apenas o ponto exato e teste de novo.
Exemplo: se o erro for "phone nao autorizado", ajuste `WHATSAPP_LEMBRETES_OWNER_PHONE` no `.env` e teste novamente.

### 2) Phone nao autorizado
1. Abra `.env` e confira `WHATSAPP_LEMBRETES_OWNER_PHONE`.
2. Garanta que o telefone esta so com numeros (ex.: 553598183459).
3. Rode o teste: `npm run wa:cmd -- "/comandos" --phone 553598183459`.
Exemplo: se o telefone tiver espacos ou +55, remova e teste de novo.

### 3) Lembrete ou follow-up nao envia
1. Confirme `WHATSAPP_API_URL` e `WHATSAPP_API_TOKEN` no `.env`.
2. Veja se `WHATSAPP_REMINDER_DEFAULT_PHONE` existe.
3. Abra o log em `storage/logs/whatsapp-lembretes.log` e busque por erro.
4. Se estiver em producao, confirme se o processo do agente esta rodando (systemd/docker/pm2). Se nao souber, pergunte.
Exemplo: se o log mostrar "WhatsApp API nao configurado", preencha as variaveis no `.env` e reteste.

## Comandos prontos (copiar e colar)
1. `npm run wa:cmd -- "/comandos" --phone 553598183459`
2. `node scripts/whatsapp-lembretes-command.js "/ver-comando NOME" --phone 553598183459`
3. `node scripts/whatsapp-lembretes-command.js "/salvar-texto TITULO: conteudo" --phone 553598183459`

## O que nao fazer
1. Nao apagar `storage/state/whatsapp-lembretes.json` sem pedido explicito.
2. Nao expor token do WhatsApp em logs ou resposta.
3. Nao alterar comandos de outros agentes.

## Exemplo pratico
Se voce manda `/comandos` e nao responde, rode `npm run wa:cmd -- "/comandos" --phone 553598183459`, veja o log em `storage/logs/whatsapp-lembretes.log` e ajuste o `.env` se faltar token.
