#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/storage/logs"
PID_FILE="${FBA_XVFB_PID_FILE:-$LOG_DIR/fba-xvfb.pid}"
LOG_FILE="${FBA_XVFB_LOG_FILE:-$LOG_DIR/fba-xvfb.log}"
DISPLAY_NAME="${FBA_XVFB_DISPLAY:-:99}"
SCREEN_SPEC="${FBA_XVFB_SCREEN:-1920x1080x24}"

log() {
  printf '[ensure-xvfb] %s\n' "$*" >&2
}

die() {
  printf '[ensure-xvfb][ERRO] %s\n' "$*" >&2
  exit 1
}

display_socket_ready() {
  local display_value="${1:-}"
  local display_number="${display_value#:}"

  if [[ -z "$display_number" ]]; then
    return 1
  fi

  [[ -S "/tmp/.X11-unix/X${display_number}" ]]
}

display_ready() {
  local display_value="${1:-}"

  if [[ -z "$display_value" ]]; then
    return 1
  fi

  if command -v xdpyinfo >/dev/null 2>&1; then
    if DISPLAY="$display_value" xdpyinfo >/dev/null 2>&1; then
      return 0
    fi
  fi

  if command -v xset >/dev/null 2>&1; then
    if DISPLAY="$display_value" xset q >/dev/null 2>&1; then
      return 0
    fi
  fi

  display_socket_ready "$display_value"
}

wait_for_display() {
  local display_value="$1"
  local attempts="${2:-30}"

  for ((i=0; i<attempts; i++)); do
    if display_ready "$display_value"; then
      return 0
    fi
    sleep 1
  done

  return 1
}

cleanup_stale_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    return 0
  fi

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$PID_FILE"
  fi
}

start_xvfb() {
  command -v Xvfb >/dev/null 2>&1 || die "Xvfb nao encontrado. Instale no servidor com: sudo apt-get update && sudo apt-get install -y xvfb x11-utils"

  mkdir -p "$LOG_DIR"
  cleanup_stale_pid

  if [[ -f "$PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1 && wait_for_display "$DISPLAY_NAME" 3; then
      log "Xvfb ja estava ativo em $DISPLAY_NAME (pid=$existing_pid)."
      return 0
    fi
  fi

  log "Subindo Xvfb em $DISPLAY_NAME com tela $SCREEN_SPEC..."
  nohup Xvfb "$DISPLAY_NAME" -screen 0 "$SCREEN_SPEC" -ac -nolisten tcp -dpi 96 >"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  if ! wait_for_display "$DISPLAY_NAME" 30; then
    rm -f "$PID_FILE"
    die "O Xvfb nao respondeu em $DISPLAY_NAME. Veja o log em $LOG_FILE"
  fi

  log "Xvfb pronto em $DISPLAY_NAME (pid=$pid)."
}

resolve_display() {
  if [[ -n "${DISPLAY:-}" ]] && display_ready "${DISPLAY:-}"; then
    log "DISPLAY atual ja esta funcional: ${DISPLAY}"
    printf 'export DISPLAY=%q\n' "$DISPLAY"
    printf 'export FBA_HEADLESS=0\n'
    printf 'export FBA_REQUIRE_DISPLAY=1\n'
    printf 'export FBA_BROWSER_MODE=visual\n'
    return 0
  fi

  start_xvfb
  printf 'export DISPLAY=%q\n' "$DISPLAY_NAME"
  printf 'export FBA_HEADLESS=0\n'
  printf 'export FBA_REQUIRE_DISPLAY=1\n'
  printf 'export FBA_BROWSER_MODE=visual\n'
}

resolve_display
