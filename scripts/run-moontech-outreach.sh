#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PROJECT_DIR="$ROOT_DIR"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "/home/bonette/openclaw-agents/.env" ]]; then
  PROJECT_DIR="/home/bonette/openclaw-agents"
  ENV_FILE="/home/bonette/openclaw-agents/.env"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRO: arquivo .env nao encontrado. Procurado em: $ENV_FILE" >&2
  exit 1
fi

PY_SCRIPT="$SCRIPT_DIR/moontech-outreach-hubspot.py"
if [[ ! -f "$PY_SCRIPT" ]]; then
  PY_SCRIPT="$PROJECT_DIR/scripts/moontech-outreach-hubspot.py"
fi

if [[ ! -f "$PY_SCRIPT" ]]; then
  echo "ERRO: script moontech-outreach-hubspot.py nao encontrado." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

python3 "$PY_SCRIPT" "$@"
