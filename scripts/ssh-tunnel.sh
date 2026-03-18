#!/usr/bin/env bash
set -euo pipefail

# =================================================================
# SSH Tunnel: Acessa Open Claw gateway do notebook via tunnel
#
# O gateway roda no servidor (192.168.0.173:18789 loopback only).
# Este script cria um tunnel SSH para acessar do notebook local.
#
# Uso: bash scripts/ssh-tunnel.sh
# Para parar: Ctrl+C ou kill do PID
# =================================================================

SERVER_USER="${OPENCLAW_USER:-bonette}"
SERVER_HOST="${OPENCLAW_SERVER:-192.168.0.173}"
SSH_KEY="${SSH_KEY_PATH:-~/.ssh/id_ed25519}"
REMOTE_PORT="${OPENCLAW_PORT:-18789}"
LOCAL_PORT="${SSH_TUNNEL_LOCAL_PORT:-18789}"

echo "=== SSH Tunnel para Open Claw Gateway ==="
echo "Local:  127.0.0.1:${LOCAL_PORT}"
echo "Remote: ${SERVER_USER}@${SERVER_HOST}:${REMOTE_PORT}"
echo ""
echo "Pressione Ctrl+C para encerrar."
echo ""

# -L: tunnel local -> remoto
# -N: não executar comando remoto
# -T: não alocar terminal
# -o ServerAliveInterval: manter conexão viva
ssh -i "$SSH_KEY" \
  -4 \
  -L "127.0.0.1:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
  -N -T \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  "${SERVER_USER}@${SERVER_HOST}"
