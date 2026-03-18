---
name: openclaw-config-zoe-agents
description: Skill principal para qualquer solicitacao dentro de /home/mateus/Documentos/Projetos/config-open-claw envolvendo organizacao, criacao, refatoracao ou troubleshooting de agentes OpenClaw/Zoe Bot. Use quando precisar analisar arquitetura do projeto, padronizar estrutura dos agentes, corrigir problemas de VPN, token, API, scheduler, estado, deploy, tunnel SSH e integracoes entre componentes dos Zoibots do WhatsApp.
---

# OpenClaw Config Zoe Agents

## Overview
Usar esta skill como padrao unico para trabalhar no projeto `config-open-claw`.
Executar sempre com foco em estabilidade operacional, consistencia da estrutura e baixo risco de regressao.

## Inicio Obrigatorio
1. Confirmar pasta de trabalho: `/home/mateus/Documentos/Projetos/config-open-claw`.
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
