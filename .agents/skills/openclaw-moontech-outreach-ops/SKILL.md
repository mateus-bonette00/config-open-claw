---
name: openclaw-moontech-outreach-ops
description: Use para operar e resolver problemas do agente moontech-prospecting e do outreach (HubSpot, email, WhatsApp). Acione sempre que o usuario falar de Moontech, leads, HubSpot, ou envio de mensagens.
---

# OpenClaw Moontech Outreach Ops (agente moontech-prospecting)

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.

## Onde ficam as configuracoes (caminhos certinhos no servidor)
1. Entrar no servidor: `ssh openclaw-server`
2. Pasta do projeto (onde roda): `/home/bonette/openclaw-agents`
3. Config do agente (variaveis): `/home/bonette/openclaw-agents/.env`
4. Logs/estado do agente: `/home/bonette/openclaw-agents/storage/logs/` e `/home/bonette/openclaw-agents/storage/state/`
5. Open Claw (config interna): `/home/bonette/.openclaw/openclaw.json`
6. Scripts do Open Claw (workspace): `/home/bonette/.openclaw/workspace/scripts/`

## Objetivo (1 frase)
Fazer outreach com seguranca, sempre com dry-run antes do envio real.

## Formato de resposta (obrigatorio)
1. Responder sempre em passos numerados.
2. Linguagem simples e direta.
3. Sempre incluir 1 exemplo pratico no final.
4. Se envolver site/painel, incluir link direto.

## Quando usar (gatilhos)
1. Erro ao buscar contatos no HubSpot.
2. Problema ao enviar email ou WhatsApp.
3. Duvida sobre compliance (horario, opt-out, limite diario).
4. Precisa rodar outreach em `dry-run`.

## Antes de comecar (perguntas obrigatorias)
1. Voce quer enviar email, WhatsApp, ou ambos?
2. Quantos contatos quer processar (`--limit`)?
3. Vai ser `dry-run` ou envio real?

## Arquivos principais (abrir primeiro)
1. `/home/bonette/openclaw-agents/agents/moontech-prospecting/index.js`
2. `/home/bonette/openclaw-agents/scripts/run-moontech-outreach.sh`
3. `/home/bonette/openclaw-agents/scripts/moontech-outreach-hubspot.py`
4. `/home/bonette/openclaw-agents/.env`
5. `/home/bonette/openclaw-agents/storage/logs/moontech-prospecting.log`
6. `/home/bonette/openclaw-agents/storage/state/moontech-prospecting.json`

## Guia rapido (passo a passo)
1. Entre no servidor: `ssh openclaw-server`.
2. Entre na pasta do projeto: `cd /home/bonette/openclaw-agents`.
3. Confirme se vai ser `dry-run` (sem envio real).
4. Abra `/home/bonette/openclaw-agents/.env` e confira `HUBSPOT_API_KEY`.
5. Se for email, confira `ZOHO_SMTP_USER` e `ZOHO_SMTP_APP_PASSWORD`.
6. Se for WhatsApp, confira `WHATSAPP_API_URL`, `WHATSAPP_API_TOKEN`, `WHATSAPP_INSTANCE`.
7. Rode um lote pequeno: `bash scripts/run-moontech-outreach.sh --limit 3 --send-whatsapp`.
8. Veja o log em `/home/bonette/openclaw-agents/storage/logs/moontech-prospecting.log`.
9. Se estiver OK, aumente o `--limit`.
10. Para envio real, so use `--commit --confirm-send "ENVIAR AGORA"` com confirmacao explicita.

## Fluxos comuns (passo a passo)
### 1) Dry-run com WhatsApp
1. Rode `bash scripts/run-moontech-outreach.sh --limit 3 --send-whatsapp`.
2. Confirme se aparece "Modo: DRY-RUN".
3. Veja erros no log se houver.
Exemplo: se aparecer "WHATSAPP_API_TOKEN ausente", preencha no `.env` e rode de novo.

### 2) Envio real (somente com confirmacao)
1. Confirme com o usuario que o envio real esta autorizado.
2. Rode `bash scripts/run-moontech-outreach.sh --limit 3 --send-whatsapp --commit --confirm-send "ENVIAR AGORA"`.
3. Verifique o relatorio final.
Exemplo: se a confirmacao nao for exatamente "ENVIAR AGORA", o envio deve ser bloqueado.

## Comandos prontos (copiar e colar)
1. `cd /home/bonette/openclaw-agents && bash scripts/run-moontech-outreach.sh --limit 3 --send-whatsapp`
2. `cd /home/bonette/openclaw-agents && bash scripts/run-moontech-outreach.sh --limit 3 --send-email`
3. `cd /home/bonette/openclaw-agents && bash scripts/run-moontech-outreach.sh --limit 3 --send-whatsapp --commit --confirm-send "ENVIAR AGORA"`

## O que nao fazer
1. Nao enviar mensagens reais sem confirmacao explicita.
2. Nao expor tokens do HubSpot, WhatsApp ou Zoho.
3. Nao ignorar regras de compliance.

## Exemplo pratico
Se voce quer testar, rode o dry-run com 3 contatos, confirme no log e so depois pense em envio real.
