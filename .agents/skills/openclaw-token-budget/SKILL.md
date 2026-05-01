---
name: openclaw-token-budget
description: Use para reduzir consumo de tokens em tarefas do projeto config-open-claw sem perder qualidade tecnica. Ideal para diagnostico rapido, ajustes pequenos, leitura controlada e respostas objetivas.
---

# OpenClaw Token Budget

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.

## Onde ficam as configuracoes (caminhos certinhos no servidor)
1. Entrar no servidor: `ssh openclaw-server`
2. Pasta do projeto (onde roda): `/home/bonette/openclaw-agents`
3. Config dos agentes (variaveis): `/home/bonette/openclaw-agents/.env`
4. Config do Open Claw (plataforma): `/home/bonette/.openclaw/openclaw.json`
5. Gateway (systemd user): `/home/bonette/.config/systemd/user/openclaw-gateway.service`
6. Workspaces (1 por agente): `/home/bonette/.openclaw/workspace-<agent_id>/`

## Objetivo
Entregar resultado util com baixo custo de contexto e baixo retrabalho.

## Quando Usar
- Tarefas de manutencao rapida.
- Ajustes pequenos em 1 ou 2 arquivos.
- Duvidas objetivas sobre um fluxo especifico.
- Revisao curta de comando de script.

## Quando Nao Usar
- Refatoracao grande.
- Investigacao longa com muitos modulos.
- Mudanca arquitetural.
- Auditoria completa de seguranca.

## Escopo Prioritario Do Projeto
Priorizar leitura nesta ordem:
1. `package.json` (scripts oficiais).
2. `agents/<agente>/index.js` do fluxo alvo.
3. `core/logger.js`, `core/state.js`, `core/secrets.js`, `core/scheduler.js`.
4. `scripts/*.sh` relacionados ao pedido.
5. `integrations/*` apenas se houver integracao envolvida.

Evitar leitura de pastas grandes sem necessidade:
- `node_modules`, `dist`, `build`, `coverage`, `logs`, `data`, `backups`, `storage` inteiro.

## Fluxo Obrigatorio
1. Reescrever o objetivo em 1 frase simples.
2. Listar no maximo 2 arquivos para abrir primeiro.
3. Ler somente esses arquivos.
4. Entregar diagnostico curto com:
   - Fato confirmado.
   - Risco principal.
   - Acao minima recomendada.
5. Se faltar contexto, pedir liberacao de no maximo +2 arquivos e explicar por que.
6. Quando editar, fazer mudanca minima e localizada.
7. Sugerir validacao local curta (1 ou 2 comandos).
8. Finalizar com proximo passo unico e objetivo.

## Limites De Resposta
- Maximo 8 passos.
- Frases curtas.
- Sem repetir contexto ja conhecido.
- Sem listar alternativas demais quando uma ja resolve.

## Formato De Saida Recomendado
1. Objetivo.
2. Arquivos lidos.
3. Diagnostico.
4. Ajuste sugerido/aplicado.
5. Como validar.
6. Proximo passo.

## Regras De Seguranca
- Nunca expor segredo real.
- Sempre mascarar token/chave (`***`).
- Nao sugerir comando destrutivo sem confirmacao.

## Exemplos De Prompt
- `Use $openclaw-token-budget. Objetivo: corrigir falha no deploy. Leia apenas scripts/deploy.sh e package.json. Responda em 6 passos.`
- `Use $openclaw-token-budget. Objetivo: ajustar mensagem de erro no agente WhatsApp. Leia somente agents/whatsapp-lembretes/index.js e core/logger.js.`
- `Use $openclaw-token-budget. Objetivo: validar script de tunnel. Leia apenas scripts/ssh-tunnel.sh e scripts/deploy-live.sh.`
