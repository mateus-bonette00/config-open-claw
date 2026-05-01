---
name: openclaw-fba-pipeline-ops
description: Use para operar e resolver problemas do agente FBA (parse, browser, regras, relatorio, resume/manual/dry-run). Acione sempre que houver erro no FBA, no HTML de entrada, na VPN, ou em modo resume/manual.
---

# OpenClaw FBA Pipeline Ops (agente fba)

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


## Objetivo (1 frase)
Rodar o FBA com seguranca e conseguir retomar sem perder estado.

## Formato de resposta (obrigatorio)
1. Responder sempre em passos numerados.
2. Linguagem simples e direta.
3. Sempre incluir 1 exemplo pratico no final.
4. Se envolver site/painel, incluir link direto.

## Quando usar (gatilhos)
1. FBA travou, deu erro ou parou no meio.
2. HTML de entrada nao foi lido.
3. Problema no browser/captcha.
4. Precisa usar `resume` ou `manual`.

## Antes de comecar (perguntas obrigatorias)
1. Qual modo voce quer: `dry-run`, `auto`, `manual` ou `resume`?
2. Qual e o arquivo HTML de entrada?
3. Qual erro apareceu (texto exato)?

## Arquivos principais (abrir primeiro)
1. `agents/fba/index.js`
2. `agents/fba/parser.js`
3. `scripts/run-fba-from-html.sh`
4. `.env`
5. `storage/logs/fba-agent.log`
6. `storage/state/fba.json`

## Guia rapido (passo a passo)
1. Confirme o HTML e o modo de execucao.
2. Confira no `.env` se `VPN_REQUIRED=true` (se for o caso).
3. Rode o parse: `npm run fba:parse`.
4. Rode o `dry-run` primeiro: `bash scripts/run-fba-from-html.sh --mode dry-run`.
5. Veja o log em `storage/logs/fba-agent.log`.
6. Veja o estado em `storage/state/fba.json`.
7. Se estiver OK, rode o modo real (auto/manual/resume).
8. Registre o resultado e o proximo passo.

## Fluxos comuns (passo a passo)
### 1) Rodar do zero com seguranca
1. Rode `npm run fba:parse`.
2. Rode `bash scripts/run-fba-from-html.sh --mode dry-run`.
3. Se passar, rode `npm run fba`.
Exemplo: se o dry-run passar sem erros, rode o modo auto para processar tudo.

### 2) Retomar depois de erro
1. Veja o log em `storage/logs/fba-agent.log`.
2. Confira `storage/state/fba.json` (ultimo indice).
3. Rode `npm run fba:resume`.
Exemplo: se parou por erro, use `resume` para continuar do ultimo ponto.

### 3) Browser travou ou captcha
1. Confirme a VPN (se exigida).
2. Rode `bash scripts/run-fba-from-html.sh --mode manual`.
3. Siga as instrucoes do terminal e responda as perguntas do modo manual.
Exemplo: se o captcha aparecer, use `manual` para confirmar os passos.

## Comandos prontos (copiar e colar)
1. `npm run fba:parse`
2. `bash scripts/run-fba-from-html.sh --mode dry-run`
3. `npm run fba:resume`
4. `npm run fba:manual`

## O que nao fazer
1. Nao apagar `storage/state/fba.json` sem pedido.
2. Nao pular o `dry-run` quando houver duvida.
3. Nao rodar sem VPN quando `VPN_REQUIRED=true`.

## Exemplo pratico
Se o FBA parou no meio, veja o log, confira o estado e rode `npm run fba:resume` para continuar.
