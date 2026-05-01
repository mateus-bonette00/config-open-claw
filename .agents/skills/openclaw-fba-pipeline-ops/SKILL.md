---
name: openclaw-fba-pipeline-ops
description: Use para operar e resolver problemas do agente FBA no Open Claw (parser de HTML + navegador via Puppeteer + relatorio). Use sempre que houver falha no FBA, VPN, extensoes, logs ou pastas de entrada/saida.
---

# OpenClaw FBA Pipeline Ops (agente `fba-amazon` / visivel: LUCAS1)

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.

## Onde ficam as configuracoes (caminhos certinhos no servidor)
1. Entrar no servidor: `ssh openclaw-server`
2. Pasta do projeto (onde roda): `/home/bonette/openclaw-agents`
3. Config do agente (variaveis): `/home/bonette/openclaw-agents/.env`
4. HTMLs de entrada (FBA_INPUT_DIR): `/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html`
5. Saida (FBA_OUTPUT_DIR): `/home/bonette/openclaw-agents/amazon-fba/produtos-encontrados`
6. Logs do FBA: `/home/bonette/openclaw-agents/storage/logs/` (ex.: `fba-agent.log`, `fba-browser.log`, `fba-parser.log`)
7. Estado do FBA: `/home/bonette/openclaw-agents/storage/state/fba.json`
8. Open Claw (config interna): `/home/bonette/.openclaw/openclaw.json`
9. Gateway (systemd user): `/home/bonette/.config/systemd/user/openclaw-gateway.service` (porta `127.0.0.1:18789` no servidor)

## Objetivo (1 frase)
Manter o FBA rodando de forma previsivel: ler HTML, navegar na Amazon, extrair dados e gerar saida sem travar.

## Formato de resposta (obrigatório)
1. Responder sempre em passos numerados estilo Tutorial.
2. Linguagem simples, direta e objetiva, sem introduções.
3. Se envolver pasta/arquivo, sempre informar o caminho absoluto dentro de `/home/bonette/openclaw-agents/`.

## Quando usar (gatilhos)
1. Usuario mencionar "FBA", "Amazon", "LUCAS1", "parser", "HTML", "VPN", "Keepa" ou "AZInsight".
2. O FBA nao gera saida em `/home/bonette/openclaw-agents/amazon-fba/produtos-encontrados`.
3. Erro de VPN (pais fora do permitido).
4. Erro no browser (extensao Keepa/AZInsight nao carrega, captcha, bloqueio, timeout).

## Arquivos principais (abrir primeiro)
1. `/home/bonette/openclaw-agents/agents/fba/index.js`
2. `/home/bonette/openclaw-agents/agents/fba/parser.js`
3. `/home/bonette/openclaw-agents/agents/fba/browser.js`
4. `/home/bonette/openclaw-agents/agents/fba/rules.js`
5. `/home/bonette/openclaw-agents/scripts/run-fba-from-html.sh`
6. `/home/bonette/openclaw-agents/.env`

## Guia rapido (passo a passo)
1. Entre no servidor: `ssh openclaw-server`.
2. Entre na pasta do projeto: `cd /home/bonette/openclaw-agents`.
3. Rode o runner para ver a ajuda e confirmar opcoes: `bash scripts/run-fba-from-html.sh --help`.
4. Rode o FBA em modo normal: `bash scripts/run-fba-from-html.sh --mode auto`.
5. Se quiser so testar sem navegar pesado: `bash scripts/run-fba-from-html.sh --mode dry-run`.
6. Se travou e quer retomar: `bash scripts/run-fba-from-html.sh --mode resume`.
7. Se precisar operar manualmente (TTY): `bash scripts/run-fba-from-html.sh --mode manual`.
8. Veja logs: `tail -n 200 storage/logs/fba-agent.log` e `tail -n 200 storage/logs/fba-browser.log`.
9. Veja o estado: `cat storage/state/fba.json`.
10. Ajuste minimo no arquivo certo e rode de novo.

## Comandos uteis (copiar e colar)
1. `cd /home/bonette/openclaw-agents && bash scripts/run-fba-from-html.sh --help`
2. `cd /home/bonette/openclaw-agents && bash scripts/run-fba-from-html.sh --mode auto`
3. `cd /home/bonette/openclaw-agents && bash scripts/run-fba-from-html.sh --mode dry-run`
4. `cd /home/bonette/openclaw-agents && bash scripts/run-fba-from-html.sh --mode resume`
5. `cd /home/bonette/openclaw-agents && bash scripts/run-fba-from-html.sh --mode manual`

## O que NÃO Fazer
1. Nao apagar `storage/state/fba.json` sem pedido explicito.
2. Nao expor tokens/keys do `.env` em resposta, log ou print.
3. Nao rodar fora de `/home/bonette/openclaw-agents` quando o objetivo for producao.
