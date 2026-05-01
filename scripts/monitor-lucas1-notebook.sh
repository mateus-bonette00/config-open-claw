#!/usr/bin/env bash
set -euo pipefail

REMOTE_ALIAS="${OPENCLAW_REMOTE_HOST:-openclaw-server}"
REMOTE_PROJECT_DIR="${OPENCLAW_REMOTE_PROJECT_DIR:-/home/bonette/openclaw-agents}"
REMOTE_DASHBOARD_PORT="${OPENCLAW_REMOTE_DASHBOARD_PORT:-3456}"
LOCAL_DASHBOARD_PORT="${OPENCLAW_LOCAL_DASHBOARD_PORT:-3456}"
STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/openclaw-fba-monitor"
PID_FILE="$STATE_DIR/tunnel.pid"
TUNNEL_LOG_FILE="$STATE_DIR/tunnel.log"
SSH_CONTROL_OPTS=(-o ControlMaster=no -o ControlPath=none)
SSH_TARGET="$REMOTE_ALIAS"
SSH_RESOLVED_OPTS=()

action="${1:-start}"
open_browser_flag="${OPEN_BROWSER:-1}"

usage() {
  cat <<EOF
Uso:
  bash scripts/monitor-lucas1-notebook.sh [start|stop|status|restart]

O que faz no start:
  1) Confirma acesso SSH em ${REMOTE_ALIAS}
  2) Sobe o dashboard do LUCAS1 no servidor (se ainda nao estiver rodando)
  3) Cria tunnel local: 127.0.0.1:${LOCAL_DASHBOARD_PORT} -> servidor:${REMOTE_DASHBOARD_PORT}
  4) Abre o navegador em http://127.0.0.1:${LOCAL_DASHBOARD_PORT}

Variaveis opcionais:
  OPENCLAW_REMOTE_HOST
  OPENCLAW_REMOTE_PROJECT_DIR
  OPENCLAW_REMOTE_DASHBOARD_PORT
  OPENCLAW_LOCAL_DASHBOARD_PORT
  OPEN_BROWSER=0 (nao abre navegador automaticamente)
EOF
}

log() {
  printf '[monitor-lucas1] %s\n' "$*"
}

fail() {
  printf '[monitor-lucas1][ERRO] %s\n' "$*" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

mkdir -p "$STATE_DIR"

resolve_ssh_target() {
  local cfg host user port key

  cfg="$(ssh -G "$REMOTE_ALIAS" 2>/dev/null || true)"
  if [[ -z "$cfg" ]]; then
    SSH_TARGET="$REMOTE_ALIAS"
    SSH_RESOLVED_OPTS=()
    return
  fi

  host="$(awk '/^hostname /{print $2; exit}' <<< "$cfg")"
  user="$(awk '/^user /{print $2; exit}' <<< "$cfg")"
  port="$(awk '/^port /{print $2; exit}' <<< "$cfg")"
  key="$(awk '/^identityfile /{print $2; exit}' <<< "$cfg")"

  if [[ -z "$host" || -z "$user" ]]; then
    SSH_TARGET="$REMOTE_ALIAS"
    SSH_RESOLVED_OPTS=()
    return
  fi

  key="${key/#\~/$HOME}"
  SSH_TARGET="${user}@${host}"
  SSH_RESOLVED_OPTS=(-F /dev/null)
  [[ -n "$port" ]] && SSH_RESOLVED_OPTS+=(-p "$port")
  [[ -n "$key" && "$key" != "none" ]] && SSH_RESOLVED_OPTS+=(-i "$key")
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    cat "$PID_FILE"
  fi
}

find_tunnel_pids() {
  local base host_part pids
  base="ssh .*127\\.0\\.0\\.1:${LOCAL_DASHBOARD_PORT}:127\\.0\\.0\\.1:${REMOTE_DASHBOARD_PORT}"
  host_part="${SSH_TARGET##*@}"
  pids=""

  if [[ -n "$host_part" ]]; then
    pids+=$'\n'"$(pgrep -f "${base}.*${host_part}" || true)"
  fi

  if [[ "$REMOTE_ALIAS" != "$host_part" ]]; then
    pids+=$'\n'"$(pgrep -f "${base}.*${REMOTE_ALIAS}" || true)"
  fi

  echo "$pids" | awk 'NF' | sort -u
}

pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

local_url() {
  printf 'http://127.0.0.1:%s' "$LOCAL_DASHBOARD_PORT"
}

local_dashboard_online() {
  curl -fsS --max-time 3 "$(local_url)/api/status" >/dev/null 2>&1
}

local_port_busy() {
  ss -ltn 2>/dev/null | grep -q ":${LOCAL_DASHBOARD_PORT}[[:space:]]"
}

open_browser() {
  local url
  url="$(local_url)"

  if [[ "$open_browser_flag" != "1" ]]; then
    return 0
  fi

  if has_cmd xdg-open; then
    xdg-open "$url" >/dev/null 2>&1 || true
    return 0
  fi

  if has_cmd open; then
    open "$url" >/dev/null 2>&1 || true
  fi
}

stop_tunnel() {
  local pid
  local fallback_pids
  pid="$(read_pid || true)"
  if [[ -n "${pid:-}" ]] && pid_running "$pid"; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
  fi

  fallback_pids="$(find_tunnel_pids | tr '\n' ' ')"
  if [[ -n "${fallback_pids// }" ]]; then
    # shellcheck disable=SC2086
    kill $fallback_pids >/dev/null 2>&1 || true
    sleep 1
  fi

  rm -f "$PID_FILE"
}

ensure_ssh() {
  ssh "${SSH_RESOLVED_OPTS[@]}" "${SSH_CONTROL_OPTS[@]}" -o BatchMode=yes -o ConnectTimeout=8 "$SSH_TARGET" "echo ok" >/dev/null 2>&1 \
    || fail "Nao consegui conectar via SSH em '${REMOTE_ALIAS}'. Teste: ssh ${REMOTE_ALIAS}"
}

ensure_remote_dashboard() {
  ssh "${SSH_RESOLVED_OPTS[@]}" "${SSH_CONTROL_OPTS[@]}" "$SSH_TARGET" 'bash -s' -- "$REMOTE_PROJECT_DIR" "$REMOTE_DASHBOARD_PORT" <<'EOF'
set -euo pipefail

PROJECT_DIR="$1"
PORT="$2"
LOG_FILE="$PROJECT_DIR/storage/logs/fba-dashboard.log"

mkdir -p "$(dirname "$LOG_FILE")"

resolve_node_bin() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  if [[ -x "/home/bonette/.local/openclaw-node22/current/bin/node" ]]; then
    echo "/home/bonette/.local/openclaw-node22/current/bin/node"
    return
  fi

  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.nvm/nvm.sh"
    if command -v node >/dev/null 2>&1; then
      command -v node
      return
    fi
  fi
}

NODE_BIN="$(resolve_node_bin || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "REMOTE_DASHBOARD=failed"
  echo "node nao encontrado no servidor (PATH)."
  exit 1
fi

if ss -ltn 2>/dev/null | grep -q ":${PORT}[[:space:]]"; then
  echo "REMOTE_DASHBOARD=already"
  exit 0
fi

cd "$PROJECT_DIR"
nohup "$NODE_BIN" "$PROJECT_DIR/dashboard/server.js" > "$LOG_FILE" 2>&1 < /dev/null &
sleep 2

if ss -ltn 2>/dev/null | grep -q ":${PORT}[[:space:]]"; then
  echo "REMOTE_DASHBOARD=started"
  exit 0
fi

echo "REMOTE_DASHBOARD=failed"
tail -n 80 "$LOG_FILE" || true
exit 1
EOF
}

start_tunnel() {
  nohup ssh "${SSH_RESOLVED_OPTS[@]}" "${SSH_CONTROL_OPTS[@]}" -N \
    -L "127.0.0.1:${LOCAL_DASHBOARD_PORT}:127.0.0.1:${REMOTE_DASHBOARD_PORT}" \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    "$SSH_TARGET" >"$TUNNEL_LOG_FILE" 2>&1 </dev/null &
  echo "$!" > "$PID_FILE"
  disown >/dev/null 2>&1 || true
}

wait_local_dashboard() {
  local i
  for i in $(seq 1 12); do
    if local_dashboard_online; then
      return 0
    fi
    sleep 1
  done
  return 1
}

print_ready_message() {
  local url
  url="$(local_url)"
  cat <<EOF

Painel unico pronto no notebook:
${url}

Agora faca so isso no WhatsApp (ZoeBot):
Zoe, inicia o LUCAS1

Comandos uteis:
  Status:  bash scripts/monitor-lucas1-notebook.sh status
  Parar:   bash scripts/monitor-lucas1-notebook.sh stop
  Reiniciar tunnel: bash scripts/monitor-lucas1-notebook.sh restart

EOF
}

do_start() {
  resolve_ssh_target
  log "Validando acesso SSH..."
  ensure_ssh

  log "Garantindo dashboard do LUCAS1 no servidor..."
  ensure_remote_dashboard

  if local_dashboard_online; then
    if [[ ! -f "$PID_FILE" ]]; then
      local detected_pid
      detected_pid="$(find_tunnel_pids | head -n1 || true)"
      if [[ -n "${detected_pid:-}" ]]; then
        echo "$detected_pid" > "$PID_FILE"
      fi
    fi
    log "Dashboard ja acessivel localmente."
    open_browser
    print_ready_message
    exit 0
  fi

  local existing_pid
  existing_pid="$(read_pid || true)"
  if [[ -n "${existing_pid:-}" ]] && pid_running "$existing_pid"; then
    log "Tunnel anterior encontrado (PID ${existing_pid}). Reiniciando tunnel..."
    stop_tunnel
  fi

  if local_port_busy; then
    fail "Porta local ${LOCAL_DASHBOARD_PORT} ocupada por outro processo. Feche esse processo ou troque OPENCLAW_LOCAL_DASHBOARD_PORT."
  fi

  log "Subindo tunnel local..."
  start_tunnel

  if ! wait_local_dashboard; then
    stop_tunnel
    fail "Tunnel iniciou, mas o dashboard nao respondeu em $(local_url). Veja log: ${TUNNEL_LOG_FILE}"
  fi

  open_browser
  print_ready_message
}

do_stop() {
  stop_tunnel
  log "Tunnel parado."
}

do_status() {
  resolve_ssh_target
  local pid
  local detected_pids
  pid="$(read_pid || true)"
  detected_pids="$(find_tunnel_pids | tr '\n' ' ')"

  if local_dashboard_online; then
    log "Dashboard local: ONLINE em $(local_url)"
  else
    log "Dashboard local: OFFLINE em $(local_url)"
  fi

  if [[ -n "${pid:-}" ]] && pid_running "$pid"; then
    log "Tunnel PID: ${pid} (rodando)"
  elif [[ -n "${detected_pids// }" ]]; then
    log "Tunnel PID: ${detected_pids} (detectado por processo)"
  else
    log "Tunnel PID: nao encontrado"
  fi

  if ssh "${SSH_RESOLVED_OPTS[@]}" "${SSH_CONTROL_OPTS[@]}" -o BatchMode=yes -o ConnectTimeout=8 "$SSH_TARGET" "ss -ltn 2>/dev/null | grep -q ':${REMOTE_DASHBOARD_PORT}[[:space:]]'" >/dev/null 2>&1; then
    log "Dashboard remoto: ONLINE em ${REMOTE_ALIAS}:${REMOTE_DASHBOARD_PORT}"
  else
    log "Dashboard remoto: OFFLINE em ${REMOTE_ALIAS}:${REMOTE_DASHBOARD_PORT}"
  fi
}

case "$action" in
  start)
    do_start
    ;;
  stop)
    do_stop
    ;;
  status)
    do_status
    ;;
  restart)
    do_stop
    do_start
    ;;
  --help|-h|help)
    usage
    ;;
  *)
    usage
    fail "Acao invalida: ${action}"
    ;;
esac
