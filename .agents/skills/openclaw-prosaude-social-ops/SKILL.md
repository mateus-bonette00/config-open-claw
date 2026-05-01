---
name: openclaw-prosaude-social-ops
description: Use para operar e resolver problemas do agente prosaude-social (remocao de fundo, composicao, aprovacao e publicacao Meta). Acione sempre que houver erro em removebg/rembg, template, aprovacao manual ou publicacao.
---

# OpenClaw Prosaude Social Ops (agente prosaude-social)

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.

## Onde ficam as configuracoes (caminhos certinhos no servidor)
1. Entrar no servidor: `ssh openclaw-server`
2. Pasta do projeto (onde roda): `/home/bonette/openclaw-agents`
3. Config do agente (variaveis): `/home/bonette/openclaw-agents/.env`
4. Codigo do agente: `/home/bonette/openclaw-agents/agents/prosaude-social/`
5. Templates (arquivos): `/home/bonette/openclaw-agents/config/prosaude-templates/`
6. Logs do agente: `/home/bonette/openclaw-agents/storage/logs/prosaude-social.log`
7. Estado do agente: `/home/bonette/openclaw-agents/storage/state/prosaude-social.json`
8. Open Claw (config interna): `/home/bonette/.openclaw/openclaw.json`
9. Gateway (systemd user): `/home/bonette/.config/systemd/user/openclaw-gateway.service` (porta `127.0.0.1:18789` no servidor)

## Objetivo (1 frase)
Gerar e publicar artes com estabilidade, sem publicar sem querer.

## Formato de resposta (obrigatorio)
1. Responder sempre em passos numerados.
2. Linguagem simples e direta.
3. Sempre incluir 1 exemplo pratico no final.
4. Se envolver site/painel, incluir link direto.

## Quando usar (gatilhos)
1. Erro ao remover fundo.
2. Problema ao compor a imagem no template.
3. Falha ao publicar no Instagram/Facebook.
4. Duvida sobre aprovacao manual.

## Antes de comecar (perguntas obrigatorias)
1. Qual imagem e qual nome do produto?
2. Voce quer publicar agora ou deixar em aprovacao manual?
3. Qual erro apareceu (texto exato)?

## Arquivos principais (abrir primeiro)
1. `/home/bonette/openclaw-agents/agents/prosaude-social/index.js`
2. `/home/bonette/openclaw-agents/.env`
3. `/home/bonette/openclaw-agents/storage/logs/prosaude-social.log`
4. `/home/bonette/openclaw-agents/storage/state/prosaude-social.json`
5. `/home/bonette/openclaw-agents/scripts/sync-prosaude-artes.sh`

## Guia rapido (passo a passo)
1. Entre no servidor: `ssh openclaw-server`.
2. Entre na pasta do projeto: `cd /home/bonette/openclaw-agents`.
3. Confirme a imagem de entrada e o nome do produto.
4. Abra `/home/bonette/openclaw-agents/.env` e confira `REMOVEBG_API_KEY` (se nao tiver `rembg` local).
5. Abra `/home/bonette/openclaw-agents/.env` e confira `META_ACCESS_TOKEN`, `META_PAGE_ID`, `INSTAGRAM_ACCOUNT_ID`.
6. Veja o log em `/home/bonette/openclaw-agents/storage/logs/prosaude-social.log`.
7. Se quiser apenas validar, rode o fluxo com `approve=true` (nao publica).
8. Se for publicar, confirme URL publica da imagem (nao usar caminho local).
9. Execute o teste minimo e valide o output em `/home/bonette/openclaw-agents/storage/prosaude-output`.
10. Registre o resultado e o proximo passo.

## Fluxos comuns (passo a passo)
### 1) Erro ao remover fundo
1. Verifique se `rembg` esta instalado (ou use `REMOVEBG_API_KEY` no `.env`).
2. Veja o log em `storage/logs/prosaude-social.log`.
3. Tente novamente com uma imagem pequena para validar.
Exemplo: se aparecer "rembg nao disponivel", configure `REMOVEBG_API_KEY` e teste de novo.

### 2) Falha ao publicar no Instagram/Facebook
1. Confirme `META_ACCESS_TOKEN`, `META_PAGE_ID`, `INSTAGRAM_ACCOUNT_ID` no `.env`.
2. Garanta que a imagem esta em URL publica.
3. Rode um teste com 1 imagem e legenda curta.
Exemplo: se o erro for "access token invalido", gere um novo token no painel Meta e atualize o `.env`.

## Comandos prontos (copiar e colar)
1. `cd /home/bonette/openclaw-agents && node agents/prosaude-social/index.js`
2. `cd /home/bonette/openclaw-agents && bash scripts/sync-prosaude-artes.sh`

## O que nao fazer
1. Nao publicar sem confirmacao explicita.
2. Nao expor `META_ACCESS_TOKEN` ou `REMOVEBG_API_KEY`.
3. Nao tratar caminho local como URL publica.

## Exemplo pratico
Se a imagem nao publica, confira o token no `.env`, valide se a imagem esta em URL publica e rode um teste com legenda curta.
