#!/usr/bin/env bash
set -euo pipefail

# =================================================================
# Deploy do notebook para o servidor + aplica no ar
# Uso: bash scripts/deploy-live.sh
# =================================================================

SERVER_USER="${OPENCLAW_USER:-bonette}"
SERVER_HOST="${OPENCLAW_SERVER:-192.168.0.173}"
SERVER_DIR="${OPENCLAW_SERVER_DIR:-/home/${SERVER_USER}/openclaw-agents}"
SSH_KEY="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-}"

echo "=== Deploy Live openclaw-agents ==="
echo "Servidor: ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}"
echo ""

echo "[1/3] Executando deploy de arquivos..."
bash "${SCRIPT_DIR}/deploy.sh"

echo ""
echo "[2/3] Aplicando alteracoes no servidor..."
ssh -i "$SSH_KEY" "${SERVER_USER}@${SERVER_HOST}" "
  set -euo pipefail
  cd '${SERVER_DIR}'

  if [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1; then
    if [ -n "${DEPLOY_SERVICE}" ]; then
      echo "-> Rebuild e restart do servico: ${DEPLOY_SERVICE}"
      docker compose up -d --build "${DEPLOY_SERVICE}"
    else
      echo '-> Rebuild e restart de todos os servicos do compose'
      docker compose up -d --build
    fi
    docker compose ps
  else
    echo '-> docker compose nao encontrado ou docker-compose.yml ausente; pulando etapa Docker.'
  fi

  if systemctl --user list-unit-files | grep -q '^openclaw-gateway\\.service'; then
    echo '-> Reiniciando openclaw-gateway'
    systemctl --user restart openclaw-gateway
    systemctl --user --no-pager --full status openclaw-gateway | sed -n '1,25p'
  else
    echo '-> openclaw-gateway.service nao encontrado; pulando restart do gateway.'
  fi
"

echo ""
echo "[3/3] Validacao rapida remota..."
ssh -i "$SSH_KEY" "${SERVER_USER}@${SERVER_HOST}" "
  set -euo pipefail
  echo 'Docker:'
  docker ps --format 'table {{.Names}}\t{{.Status}}' | sed -n '1,10p' || true
  echo
  echo 'Gateway:'
  systemctl --user is-active openclaw-gateway || true
"

echo ""
echo "=== Deploy live concluido ==="
echo "Use este comando sempre que fizer mudanca no notebook:"
echo "  bash scripts/deploy-live.sh"
