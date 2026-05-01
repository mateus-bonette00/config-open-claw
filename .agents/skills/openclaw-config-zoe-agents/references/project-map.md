# Project Map

## Visao Geral
Projeto central de configuracao e operacao dos agentes OpenClaw/Zoibots.

### Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.

## Caminhos no servidor (absolutos)
- **Projeto (agentes):** `/home/bonette/openclaw-agents`
- **Config dos agentes (variaveis):** `/home/bonette/openclaw-agents/.env`
- **Config dos agentes (arquivos):** `/home/bonette/openclaw-agents/config/`
- **Codigo dos agentes:** `/home/bonette/openclaw-agents/agents/`
- **Scripts operacionais:** `/home/bonette/openclaw-agents/scripts/`
- **Logs:** `/home/bonette/openclaw-agents/storage/logs/`
- **Estado:** `/home/bonette/openclaw-agents/storage/state/`
- **Open Claw (config interna):** `/home/bonette/.openclaw/openclaw.json`
- **Open Claw (workspaces):** `/home/bonette/.openclaw/workspace-<agent_id>/`
- **Open Claw (scripts):** `/home/bonette/.openclaw/workspace/scripts/`
- **Gateway (systemd user):** `/home/bonette/.config/systemd/user/openclaw-gateway.service` (porta `127.0.0.1:18789` no servidor)

## Pastas Principais
- `agents/`: implementacao dos agentes.
- `core/`: logger, estado, segredos, scheduler.
- `integrations/`: conectores externos (ex.: Google Sheets).
- `scripts/`: deploy, execucao assistida, suporte operacional.
- `docs/`: guias e runbook.
- `storage/`: estado, logs, auditoria e saidas.

## Agentes Ja Presentes
- `agents/fba/`: fluxo FBA Amazon com parser/browser/rules/report; no Open Claw ele continua no id tecnico `fba-amazon`, mas com nome visivel `LUCAS1`.
- `agents/varredor-fornecedores/`: orquestra a abertura da automacao `varrer-fornecedores` com indices, faixa de preco e abas.
- `agents/whatsapp-lembretes/`: lembretes, tarefas e follow-up.
- `agents/prosaude-social/`: pipeline de artes/publicacao social.
- `agents/moontech-prospecting/`: prospeccao e pipeline comercial.

## Arquivos Operacionais Importantes
- `package.json`: scripts oficiais de execucao.
- `scripts/deploy.sh`: sync e instalacao remota.
- `scripts/deploy-live.sh`: deploy + aplicacao no ar.
- `scripts/register-agents.sh`: registro dos agentes no OpenClaw.
- `scripts/ssh-tunnel.sh`: tunnel manual para gateway.
- `scripts/run-fba-from-html.sh`: runner robusto do FBA.

## Configuracao
- `.env.example`: modelo de variaveis.
- `core/secrets.js`: leitura centralizada de ambiente.
- `docker-compose.yml`: servicos containerizados quando aplicavel.
