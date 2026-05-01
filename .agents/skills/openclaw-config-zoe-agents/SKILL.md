---
name: openclaw-config-zoe-agents
description: Skill principal para qualquer solicitacao dentro de /home/mateus/Documentos/Projetos/config-open-claw envolvendo organizacao, criacao, refatoracao ou troubleshooting de agentes OpenClaw/Zoe Bot. Use quando precisar analisar arquitetura do projeto, padronizar estrutura dos agentes, corrigir problemas de VPN, token, API, scheduler, estado, deploy, tunnel SSH e integracoes entre componentes dos Zoibots do WhatsApp.
---

# OpenClaw Config Zoe Agents

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.

## Onde ficam as configuracoes (caminhos certinhos no servidor)
1. Entrar no servidor: `ssh openclaw-server`
2. Pasta do projeto (onde roda): `/home/bonette/openclaw-agents`
3. Config dos agentes (variaveis): `/home/bonette/openclaw-agents/.env`
4. Config dos agentes (arquivos): `/home/bonette/openclaw-agents/config/`
5. Codigo dos agentes: `/home/bonette/openclaw-agents/agents/`
6. Logs e estado: `/home/bonette/openclaw-agents/storage/logs/` e `/home/bonette/openclaw-agents/storage/state/`
7. Config do Open Claw (plataforma): `/home/bonette/.openclaw/openclaw.json`
8. Workspaces do Open Claw (1 por agente): `/home/bonette/.openclaw/workspace-<agent_id>/` (ex.: `/home/bonette/.openclaw/workspace-whatsapp-lembretes/`)
9. Servico do gateway (systemd user): `/home/bonette/.config/systemd/user/openclaw-gateway.service` (porta `127.0.0.1:18789` no servidor)
10. Scripts do Open Claw (workspace): `/home/bonette/.openclaw/workspace/scripts/`

## Overview
Usar esta skill como padrao unico para trabalhar no projeto `config-open-claw`.
Executar sempre com foco em estabilidade operacional, consistencia da estrutura e baixo risco de regressao.

## Inicio Obrigatorio
1. Confirmar onde voce esta:
   - Notebook (repo): `/home/mateus/Documentos/Projetos/config-open-claw`.
   - Servidor (producao): `/home/bonette/openclaw-agents`.
2. Ler mapa rapido do projeto em [references/project-map.md](references/project-map.md).
3. Validar stack real antes de alterar codigo.
4. Seguir fluxo de mudanca em [references/change-workflow.md](references/change-workflow.md).

## Regra De Stack
- Nao assumir Python como stack principal.
- Confirmar no codigo que o projeto e majoritariamente Node.js/JavaScript (`agents/*.js`, `core/*.js`).
- Tratar Python como suporte operacional em scripts especificos.

## Como Estruturar Ou Ajustar Agentes
1. Aplicar padrao tecnico em [references/agent-structure-standard.md](references/agent-structure-standard.md).
2. Reutilizar `core/logger.js`, `core/state.js`, `core/secrets.js` e `core/scheduler.js`.
3. Padronizar tratamento de erro com mensagem operacional clara.
4. Preservar compatibilidade de comandos e scripts existentes.

## Como Resolver Problemas Recorrentes
Usar playbook em [references/ops-issue-playbook.md](references/ops-issue-playbook.md) para:
- VPN nao iniciar.
- Token/API invalido.
- Falha de integracao entre agentes.
- Resposta inconsistente de agente.
- Falha de deploy/tunnel/gateway.

## Como Entregar Mudancas
1. Informar o que foi alterado e por que.
2. Informar arquivos tocados.
3. Informar validacoes executadas.
4. Informar riscos residuais e proximo passo.

## Limites De Seguranca
- Nunca expor segredo real em resposta.
- Mascarar token/chave ao relatar erro.
- Se detectar segredo real em arquivo de exemplo, recomendar saneamento imediato.

## Padrao Reforcado De Agentes
Para criar, corrigir ou revisar agentes OpenClaw/Zoe Bot com validacao ponta a ponta, use tambem a skill global `openclaw-agent-ops`.
Ela define o checklist de comando, parser, estado, scheduler, WhatsApp, workspace, deploy e validacao real no servidor.
