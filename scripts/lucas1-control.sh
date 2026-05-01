#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER_SCRIPT="$PROJECT_DIR/scripts/run-fba-from-html.sh"
LOG_DIR="$PROJECT_DIR/storage/logs"
STATE_FILE="$PROJECT_DIR/storage/state/fba.json"
PID_FILE="$LOG_DIR/lucas1-run.pid"
TRIGGER_LOG="$LOG_DIR/fba-trigger.log"
RESET_ARCHIVE_DIR="$PROJECT_DIR/storage/archive/fba-reset"
LOG_FILES=(
  "$LOG_DIR/fba-trigger.log"
  "$LOG_DIR/fba-agent.log"
  "$LOG_DIR/fba-browser.log"
  "$LOG_DIR/fba-parser.log"
)

ACTION="${1:-status}"

log() {
  printf '[lucas1-control] %s\n' "$*" >&2
}

die() {
  printf '[lucas1-control][ERRO] %s\n' "$*" >&2
  exit 1
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    cat "$PID_FILE"
  fi
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

cleanup_pid_file() {
  local pid
  pid="$(read_pid || true)"

  if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    return 0
  fi

  if ! pid_is_running "$pid"; then
    rm -f "$PID_FILE"
  fi
}

find_runner_pids() {
  pgrep -f "run-fba-from-html.sh|node .*agents/fba/index.js" || true
}

is_running() {
  cleanup_pid_file

  local pid
  pid="$(read_pid || true)"
  if pid_is_running "$pid"; then
    return 0
  fi

  local found
  found="$(find_runner_pids | head -n1 || true)"
  [[ -n "$found" ]]
}

create_reset_archive_dir() {
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  local archive_dir="$RESET_ARCHIVE_DIR/$stamp"
  mkdir -p "$archive_dir"
  echo "$archive_dir"
}

archive_runtime_snapshot() {
  local archive_dir="$1"

  if [[ -f "$STATE_FILE" ]]; then
    cp "$STATE_FILE" "$archive_dir/fba-state.json"
  fi

  for log_file in "${LOG_FILES[@]}"; do
    [[ -f "$log_file" ]] || continue
    cp "$log_file" "$archive_dir/$(basename "$log_file")"
    : > "$log_file"
  done
}

write_reset_state() {
  mkdir -p "$(dirname "$STATE_FILE")"
  python3 - "$STATE_FILE" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

state_path = sys.argv[1]
now = datetime.now(timezone.utc).isoformat()
payload = {
    "runStatus": "idle",
    "runSessionId": None,
    "sessionStart": None,
    "finishedAt": now,
    "htmlFile": None,
    "activeHtmlFile": None,
    "auditTrailDir": None,
    "auditTrailSessionId": None,
    "browserMode": None,
    "browserDisplay": None,
    "mode": None,
    "totalProducts": 0,
    "lastProcessedIndex": -1,
    "lastProcessedAt": None,
    "productResults": {},
    "currentProduct": None,
    "currentStep": "aguardando-novo-inicio",
    "searchAttempts": [],
    "lastError": None,
    "runtimeUpdatedAt": now,
    "resetAt": now
}

os.makedirs(os.path.dirname(state_path), exist_ok=True)
with open(state_path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, indent=2)
PY
}

start_mode() {
  local mode="${1:-auto}"

  [[ -x "$RUNNER_SCRIPT" ]] || die "Runner do LUCAS1 nao encontrado em $RUNNER_SCRIPT"

  if is_running; then
    echo "Ja estava iniciado."
    return 0
  fi

  mkdir -p "$LOG_DIR"
  {
    echo
    echo "===== $(date '+%Y-%m-%d %H:%M:%S') | acao=${mode} ====="
  } >> "$TRIGGER_LOG"

  nohup setsid bash -lc "cd '$PROJECT_DIR' && bash '$RUNNER_SCRIPT' --mode '$mode' --audit --audit-screenshots" >> "$TRIGGER_LOG" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  sleep 1
  if ! pid_is_running "$pid"; then
    rm -f "$PID_FILE"
    die "Falha ao iniciar o LUCAS1. Veja o log em $TRIGGER_LOG"
  fi

  if [[ "$mode" == "resume" ]]; then
    echo "Retomado."
  else
    echo "Iniciado."
  fi
}

stop_mode() {
  local pid
  local stopped=0

  cleanup_pid_file
  pid="$(read_pid || true)"

  if pid_is_running "$pid"; then
    kill -TERM "-$pid" >/dev/null 2>&1 || kill -TERM "$pid" >/dev/null 2>&1 || true
    stopped=1

    for _ in {1..12}; do
      if ! pid_is_running "$pid"; then
        break
      fi
      sleep 1
    done

    if pid_is_running "$pid"; then
      kill -KILL "-$pid" >/dev/null 2>&1 || kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
  fi

  local extra_pids
  extra_pids="$(find_runner_pids | tr '\n' ' ' | xargs || true)"
  if [[ -n "${extra_pids:-}" ]]; then
    # shellcheck disable=SC2086
    kill $extra_pids >/dev/null 2>&1 || true
    sleep 1
    extra_pids="$(find_runner_pids | tr '\n' ' ' | xargs || true)"
    if [[ -n "${extra_pids:-}" ]]; then
      # shellcheck disable=SC2086
      kill -KILL $extra_pids >/dev/null 2>&1 || true
    fi
    stopped=1
  fi

  rm -f "$PID_FILE"

  if [[ "$stopped" -eq 1 ]]; then
    echo "Parado."
    return 0
  fi

  echo "Nenhuma execucao ativa."
  return 1
}

reset_mode() {
  if is_running; then
    stop_mode >/dev/null || true
  fi

  local archive_dir
  archive_dir="$(create_reset_archive_dir)"
  archive_runtime_snapshot "$archive_dir"
  write_reset_state
  rm -f "$PID_FILE"
  echo "Execucao limpa."
}

status_mode() {
  local running="false"
  if is_running; then
    running="true"
  fi

  python3 - "$STATE_FILE" "$running" "$(read_pid || true)" <<'PY'
import json
import os
import sys

state_path, running, pid = sys.argv[1], sys.argv[2], sys.argv[3]
data = {}
if os.path.isfile(state_path):
    try:
        with open(state_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        data = {}

payload = {
    "running": running == "true",
    "pid": int(pid) if pid.isdigit() else None,
    "runStatus": data.get("runStatus"),
    "runSessionId": data.get("runSessionId"),
    "activeHtmlFile": data.get("activeHtmlFile"),
    "currentStep": data.get("currentStep"),
    "currentProduct": data.get("currentProduct"),
    "lastError": data.get("lastError")
}
print(json.dumps(payload, ensure_ascii=False, indent=2))
PY
}

case "$ACTION" in
  start|iniciar|auto)
    start_mode "auto"
    ;;
  resume|retomar)
    start_mode "resume"
    ;;
  stop|parar|pause|pausar)
    stop_mode
    ;;
  reset|limpar|clear)
    reset_mode
    ;;
  restart|reiniciar)
    reset_mode >/dev/null
    start_mode "auto"
    ;;
  status)
    status_mode
    ;;
  *)
    cat <<EOF
Uso:
  bash scripts/lucas1-control.sh start
  bash scripts/lucas1-control.sh resume
  bash scripts/lucas1-control.sh stop
  bash scripts/lucas1-control.sh reset
  bash scripts/lucas1-control.sh restart
  bash scripts/lucas1-control.sh status
EOF
    exit 64
    ;;
esac
