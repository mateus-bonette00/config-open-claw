#!/usr/bin/env bash
set -euo pipefail

# =================================================================
# Desativa auto deploy recorrente no servidor (systemd user timer)
# Uso: bash scripts/remote-disable-autodeploy.sh
# =================================================================

SERVER_USER="${OPENCLAW_USER:-bonette}"
SERVER_HOST="${OPENCLAW_SERVER:-192.168.0.173}"
SSH_KEY="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519}"

echo "=== Desativando autodeploy remoto ==="
echo "Servidor: ${SERVER_USER}@${SERVER_HOST}"
echo ""

ssh -i "$SSH_KEY" "${SERVER_USER}@${SERVER_HOST}" '
  set -euo pipefail

  echo "[1/3] Verificando units existentes..."
  systemctl --user list-unit-files | grep -E "^autodeploy-all\.(timer|service)" || true
  echo

  echo "[2/3] Parando e desativando timer/servico..."
  systemctl --user disable --now autodeploy-all.timer 2>/dev/null || true
  systemctl --user disable --now autodeploy-all.service 2>/dev/null || true

  echo "[3/3] Mascando timer para evitar reativacao acidental..."
  systemctl --user mask autodeploy-all.timer 2>/dev/null || true

  echo
  echo "=== Status final ==="
  systemctl --user status autodeploy-all.timer --no-pager || true
'

echo ""
echo "Concluido. O autodeploy recorrente foi desativado."
