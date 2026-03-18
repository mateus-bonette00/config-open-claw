#!/usr/bin/env bash
set -euo pipefail

# =================================================================
# Instala o SSH tunnel como serviço systemd (notebook → servidor)
# Assim o tunnel reconecta automaticamente se cair.
#
# Uso: bash scripts/ssh-tunnel-service.sh
# =================================================================

SERVER_USER="${OPENCLAW_USER:-bonette}"
SERVER_HOST="${OPENCLAW_SERVER:-192.168.0.173}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519}"
REMOTE_PORT="${OPENCLAW_PORT:-18789}"
LOCAL_PORT="${SSH_TUNNEL_LOCAL_PORT:-18789}"
SERVICE_NAME="openclaw-tunnel"

echo "=== Instalando serviço SSH tunnel ==="

# Criar unit file
SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
mkdir -p "$(dirname "$SERVICE_FILE")"

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=SSH Tunnel para Open Claw Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -i ${SSH_KEY_PATH} -4 -L 127.0.0.1:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT} -N -T -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes ${SERVER_USER}@${SERVER_HOST}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

echo "Service file criado: $SERVICE_FILE"

# Recarregar e ativar
systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}"
systemctl --user start "${SERVICE_NAME}"

echo ""
echo "Tunnel ativo e persistente!"
echo "Comandos úteis:"
echo "  systemctl --user status ${SERVICE_NAME}"
echo "  systemctl --user stop ${SERVICE_NAME}"
echo "  systemctl --user restart ${SERVICE_NAME}"
echo "  journalctl --user -u ${SERVICE_NAME} -f"
echo ""
echo "O gateway Open Claw estará acessível em: localhost:${LOCAL_PORT}"
