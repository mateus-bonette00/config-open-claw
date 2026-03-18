#!/usr/bin/env bash
set -euo pipefail

# Sync Pro-Saude generated arts from server to local notebook folder.
# Usage:
#   ./scripts/sync-prosaude-artes.sh
#   ./scripts/sync-prosaude-artes.sh /caminho/local

REMOTE_USER_HOST="${REMOTE_USER_HOST:-bonette@192.168.0.173}"
REMOTE_DIR="${REMOTE_DIR:-/home/bonette/openclaw-agents/storage/prosaude-output/}"
DEFAULT_LOCAL_DIR="${DEFAULT_LOCAL_DIR:-$HOME/Documentos/artes-prosaude}"
LOCAL_DIR="${1:-$DEFAULT_LOCAL_DIR}"

mkdir -p "$LOCAL_DIR"

rsync -av --progress \
  "$REMOTE_USER_HOST:$REMOTE_DIR" \
  "$LOCAL_DIR/"

echo
echo "Artes sincronizadas em: $LOCAL_DIR"
