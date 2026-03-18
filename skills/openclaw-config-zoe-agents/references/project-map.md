# Project Map

## Visao Geral
Projeto central de configuracao e operacao dos agentes OpenClaw/Zoibots.

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
