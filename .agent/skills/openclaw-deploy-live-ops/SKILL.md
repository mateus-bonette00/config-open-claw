---
name: openclaw-deploy-live-ops
description: Use para deploy seguro do projeto no servidor, incluindo sync, install remoto, rebuild/restart e validacao final.
---

# OpenClaw Deploy Live Ops

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


## Objetivo
Executar deploy com risco controlado e checklist claro de pre, durante e pos deploy.

## Quando Usar
- Deploy no servidor de producao/lab.
- Ajuste em `deploy.sh` e `deploy-live.sh`.
- Validacao de restart do gateway e Docker.
- Registro/reativacao de agentes no servidor.

## Arquivos Foco
1. `scripts/deploy.sh`
2. `scripts/deploy-live.sh`
3. `scripts/register-agents.sh`
4. `scripts/remote-disable-autodeploy.sh`

## Fluxo Obrigatorio
1. Validar SSH antes de qualquer mudanca.
2. Validar exclusoes do `rsync`.
3. Confirmar install remoto (`npm install --omit=dev`).
4. Rodar deploy live.
5. Validar Docker e status do `openclaw-gateway`.
6. Se necessario, registrar agentes.

## Comandos De Validacao
- `bash scripts/deploy.sh`
- `bash scripts/deploy-live.sh`
- `bash scripts/register-agents.sh`
- `bash scripts/remote-disable-autodeploy.sh`

## Regras De Seguranca
- Nao alterar `.env` de producao automaticamente sem consentimento.
- Nao executar comando destrutivo remoto.
- Sempre validar status final apos deploy.

## Formato De Entrega
1. O que foi deployado.
2. Verificacoes executadas.
3. Status final de servicos.
4. Pendencias.

## Exemplos De Prompt
- `Use $openclaw-deploy-live-ops. Revisar deploy-live e melhorar validacao final do gateway.`
- `Use $openclaw-deploy-live-ops. Diagnosticar falha de SSH no deploy e sugerir acao minima.`

