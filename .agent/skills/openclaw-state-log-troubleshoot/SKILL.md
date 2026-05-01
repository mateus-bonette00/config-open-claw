---
name: openclaw-state-log-troubleshoot
description: Use para diagnostico operacional por estado e logs dos agentes, com foco em causa raiz e recuperacao segura.
---

# OpenClaw State Log Troubleshoot

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


## Objetivo
Encontrar causa raiz de falhas usando `storage/state` e `storage/logs` sem acoes destrutivas.

## Quando Usar
- Agente parou no meio e nao sabe de onde retomar.
- Resultado inconsistente entre execucoes.
- Erro recorrente sem causa clara.
- Necessidade de entender historico de tentativas/falhas.

## Arquivos Foco
1. `core/state.js`
2. `core/logger.js`
3. `storage/state/<agente>.json`
4. `storage/logs/<agente>.log`
5. `storage/logs/errors.log`

## Fluxo Obrigatorio
1. Identificar agente e horario aproximado da falha.
2. Ler log do agente e `errors.log`.
3. Cruzar com estado salvo do agente.
4. Determinar causa raiz provavel.
5. Propor recuperacao minima (`resume`, ajuste de entrada, correcoes locais).
6. Validar com execucao curta.

## Regras De Seguranca
- Nao apagar estado antes de tentativa de recuperacao.
- Nao mascarar erro sem explicar causa.
- Nao expor dados sensiveis em evidencias.

## Formato De Entrega
1. Evidencia de log.
2. Evidencia de estado.
3. Causa raiz.
4. Acao corretiva.
5. Como validar.

## Exemplos De Prompt
- `Use $openclaw-state-log-troubleshoot. Investigar por que o agente fba parou no meio e como retomar sem perder progresso.`
- `Use $openclaw-state-log-troubleshoot. Cruza errors.log com state do whatsapp-lembretes e proponha correcao minima.`

