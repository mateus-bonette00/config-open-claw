#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${OPENCLAW_ZOE_TAREFAS_WORKSPACE:-/home/bonette/.openclaw/workspace-zoe-tarefas-prioridade}"
TOOLS_PATH="${WORKSPACE_DIR}/TOOLS.md"
WORKSPACE_SCRIPTS_DIR="${OPENCLAW_WORKSPACE_SCRIPTS_DIR:-/home/bonette/.openclaw/workspace/scripts}"
WORKSPACE_CMD_PATH="${OPENCLAW_ZOE_TAREFAS_COMMAND_PATH:-${WORKSPACE_SCRIPTS_DIR}/zoe-tarefas-prioridade-command.sh}"
PROJECT_DIR="${OPENCLAW_SERVER_DIR:-/home/bonette/openclaw-agents}"

log() {
  printf '[install-workspace-zoe-afazeres] %s\n' "$*"
}

mkdir -p "$WORKSPACE_DIR"
mkdir -p "$WORKSPACE_SCRIPTS_DIR"

cat > "$WORKSPACE_CMD_PATH" <<'CMD'
#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${OPENCLAW_SERVER_DIR:-/home/bonette/openclaw-agents}"
ENV_FILE="${PROJECT_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

NODE_BIN=""
for CANDIDATE in \
  "/home/bonette/.local/openclaw-node22/current/bin/node" \
  "/home/bonette/.local/openclaw-node22/bin/node"
do
  if [[ -x "$CANDIDATE" ]]; then
    NODE_BIN="$CANDIDATE"
    break
  fi
done

if [[ -z "$NODE_BIN" ]] && command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "ERRO: node nao encontrado para executar zoe-tarefas-command." >&2
  exit 1
fi

PHONE="${WHATSAPP_TAREFAS_OWNER_PHONE:-${WHATSAPP_AFAZERES_OWNER_PHONE:-${WHATSAPP_LEMBRETES_OWNER_PHONE:-${WHATSAPP_REMINDER_DEFAULT_PHONE:-553598183459}}}}"

if [[ -n "${STATE_DIR:-}" ]]; then
  if [[ "$STATE_DIR" != /* ]]; then
    STATE_DIR="${PROJECT_DIR}/${STATE_DIR#./}"
  fi
else
  STATE_DIR="${PROJECT_DIR}/storage/state"
fi
export STATE_DIR

if [[ "$#" -eq 0 ]]; then
  echo "Uso: bash ${0} \"/afazer-lista\""
  exit 1
fi

cd "$PROJECT_DIR"
"$NODE_BIN" "$PROJECT_DIR/scripts/zoe-tarefas-command.js" "$@" --phone "$PHONE"
CMD

chmod +x "$WORKSPACE_CMD_PATH"

cat > "$TOOLS_PATH" <<EOFTOOLS
# Ferramentas Zoe Afazeres

Voce e o agente de lista de afazeres simples da Zoe.

Regra principal:
- Sempre use o script abaixo para operar afazeres.
- Nao invente resposta manual para /afazer-*.
- A lista segue a ordem em que o usuario adiciona as tarefas.
- O numero 1, 2, 3... e apenas a posicao visual atual da lista.

Comandos oficiais:

bash ${WORKSPACE_CMD_PATH} "/afazer-ajuda"
bash ${WORKSPACE_CMD_PATH} "/afazer-status"
bash ${WORKSPACE_CMD_PATH} "/afazer-lista"
bash ${WORKSPACE_CMD_PATH} "/afazer-add Pagar boleto"
bash ${WORKSPACE_CMD_PATH} "/afazer-feita 1"
bash ${WORKSPACE_CMD_PATH} "/afazer-remover 2"

Compatibilidade temporaria:
- Se o usuario mandar algo como "/afazer-add 9: Arrumar site", execute o script mesmo assim.
- O numero antigo sera ignorado e a tarefa entra no fim da lista.

Frases naturais permitidas:
- "adiciona tarefa pagar boleto"
- "adiciona pagar boleto"
- "listar tarefas"
- "concluir tarefa 2"
- "remover tarefa 3"

Lembrete automatico:
- A cada 10 minutos entre 07:00 e 20:59 (America/Sao_Paulo).
- Nao envia entre 21:00 e 07:00.
- O envio usa OpenClaw WhatsApp como caminho principal.
EOFTOOLS

log "Script de comando instalado em ${WORKSPACE_CMD_PATH}"
log "TOOLS.md atualizado em ${TOOLS_PATH}"
