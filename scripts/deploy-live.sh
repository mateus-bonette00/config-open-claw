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
ssh -i "$SSH_KEY" "${SERVER_USER}@${SERVER_HOST}" \
  "SERVER_DIR='${SERVER_DIR}' DEPLOY_SERVICE='${DEPLOY_SERVICE}' bash -s" <<'REMOTE_APPLY'
set -euo pipefail
cd "${SERVER_DIR}"

if ! command -v Xvfb >/dev/null 2>&1; then
  echo '-> Xvfb nao encontrado; tentando instalar via sudo -n'
  if command -v sudo >/dev/null 2>&1; then
    sudo -n apt-get update && sudo -n apt-get install -y xvfb x11-utils || \
      echo '-> Aviso: nao foi possivel instalar Xvfb automaticamente.'
  else
    echo '-> Aviso: sudo nao encontrado para instalar Xvfb.'
  fi
else
  echo '-> Xvfb ja instalado'
fi

echo '-> Aplicando configuracao do OpenClaw para o LUCAS1'
bash scripts/configure-openclaw-lucas1.sh

echo '-> Instalando atalhos do LUCAS1 no workspace da Zoe'
bash scripts/install-workspace-lucas1-shortcuts.sh

echo '-> Instalando atalhos do agente Zoe Tarefas no workspace'
bash scripts/install-workspace-zoe-tarefas-shortcuts.sh

  if [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1; then
  if [ -n "${DEPLOY_SERVICE:-}" ]; then
    echo "-> Rebuild e restart do servico: ${DEPLOY_SERVICE}"
    docker compose up -d --build "${DEPLOY_SERVICE}"
    docker compose ps
  else
    echo '-> Docker compose detectado, mas o rebuild automatico foi pulado.'
    echo '-> Motivo: o servico fba-agent sobe sozinho e conflita com o novo controle do LUCAS1.'
    echo '-> Se quiser subir algum servico via compose, rode de novo com DEPLOY_SERVICE=<nome>.'
    docker compose stop fba-agent >/dev/null 2>&1 || true
    echo '-> Servico fba-agent foi parado para evitar loop de restart sem HTML de entrada.'
  fi
else
  echo '-> docker compose nao encontrado ou docker-compose.yml ausente; pulando etapa Docker.'
fi

if systemctl --user is-active openclaw-gateway >/dev/null 2>&1 || systemctl --user status openclaw-gateway >/dev/null 2>&1; then
  echo '-> Reiniciando openclaw-gateway'
  systemctl --user restart openclaw-gateway
  systemctl --user --no-pager --full status openclaw-gateway | sed -n '1,25p'
else
  echo '-> openclaw-gateway.service nao encontrado; pulando restart do gateway.'
fi

if systemctl --user is-active openclaw-zoe >/dev/null 2>&1 || systemctl --user status openclaw-zoe >/dev/null 2>&1; then
  echo '-> Reiniciando openclaw-zoe'
  systemctl --user restart openclaw-zoe
  systemctl --user --no-pager --full status openclaw-zoe | sed -n '1,20p'
else
  echo '-> openclaw-zoe.service nao encontrado; pulando restart do serviço de lembretes.'
fi

echo '-> Reiniciando dashboard do LUCAS1'
pkill -f 'node .*dashboard/server.js' >/dev/null 2>&1 || true

NODE_BIN=''
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [ -x "$HOME/.local/openclaw-node22/current/bin/node" ]; then
  NODE_BIN="$HOME/.local/openclaw-node22/current/bin/node"
fi

if [ -n "$NODE_BIN" ]; then
  mkdir -p "${SERVER_DIR}/storage/logs"
  nohup "$NODE_BIN" "${SERVER_DIR}/dashboard/server.js" > "${SERVER_DIR}/storage/logs/fba-dashboard.log" 2>&1 < /dev/null &
  sleep 2
else
  echo '-> Aviso: node nao encontrado para reiniciar o dashboard.'
fi
REMOTE_APPLY

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
