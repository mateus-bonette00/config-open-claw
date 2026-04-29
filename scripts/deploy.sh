#!/usr/bin/env bash
set -euo pipefail

# =================================================================
# Deploy do projeto openclaw-agents para o servidor
# Uso: bash scripts/deploy.sh
# =================================================================

SERVER_USER="${OPENCLAW_USER:-bonette}"
SERVER_HOST="${OPENCLAW_SERVER:-192.168.0.173}"
SERVER_DIR="${OPENCLAW_SERVER_DIR:-/home/${SERVER_USER}/openclaw-agents}"
SSH_KEY="${SSH_KEY_PATH:-~/.ssh/id_ed25519}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Deploy openclaw-agents ==="
echo "Servidor: ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}"
echo "Projeto local: ${PROJECT_DIR}"
echo ""

# 1. Verificar conexão SSH
echo "[1/6] Testando conexão SSH..."
ssh -i "$SSH_KEY" -o ConnectTimeout=5 "${SERVER_USER}@${SERVER_HOST}" "echo 'SSH OK'" || {
  echo "ERRO: Falha na conexão SSH. Verifique:"
  echo "  - Servidor ligado e acessível na rede"
  echo "  - Chave SSH configurada: $SSH_KEY"
  echo "  - Usuário: $SERVER_USER"
  exit 1
}

# 2. Criar diretório no servidor
echo "[2/6] Preparando diretório no servidor..."
ssh -i "$SSH_KEY" "${SERVER_USER}@${SERVER_HOST}" "mkdir -p ${SERVER_DIR}"

# 3. Sincronizar arquivos (excluindo node_modules, .env, storage)
echo "[3/6] Sincronizando arquivos..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'storage/state' \
  --exclude 'storage/logs' \
  --exclude 'storage/screenshots' \
  --exclude 'storage/exports' \
  --exclude 'amazon-fba/produtos-encontrados' \
  --exclude '.git' \
  --exclude '*.png' \
  --exclude '*.html' \
  -e "ssh -i $SSH_KEY" \
  "${PROJECT_DIR}/" \
  "${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/"

# 4. Instalar dependências no servidor
echo "[4/6] Instalando dependências no servidor..."
ssh -i "$SSH_KEY" "${SERVER_USER}@${SERVER_HOST}" "
  set -euo pipefail

  NODE_BIN=''
  for CANDIDATE in \
    \"\$HOME/.local/openclaw-node22/current/bin\" \
    \"\$HOME/.local/openclaw-node22/bin\" \
    \"\$HOME/.nvm/current/bin\"
  do
    if [ -x \"\$CANDIDATE/npm\" ]; then
      NODE_BIN=\"\$CANDIDATE\"
      break
    fi
  done

  if [ -z \"\$NODE_BIN\" ] && command -v npm >/dev/null 2>&1; then
    NODE_BIN=\"\$(dirname \"\$(command -v npm)\")\"
  fi

  if [ -z \"\$NODE_BIN\" ]; then
    NPM_CANDIDATE=\"\$(find \"\$HOME/.nvm/versions/node\" -maxdepth 4 -type f -path '*/bin/npm' 2>/dev/null | sort -V | tail -n 1 || true)\"
    if [ -n \"\$NPM_CANDIDATE\" ]; then
      NODE_BIN=\"\$(dirname \"\$NPM_CANDIDATE\")\"
    fi
  fi

  if [ -z \"\$NODE_BIN\" ]; then
    echo 'ERRO: npm nao encontrado no servidor.'
    echo 'Instale Node.js ou ajuste o PATH remoto para incluir um binario com npm.'
    exit 1
  fi

  export PATH=\"\$NODE_BIN:\$PATH\"
  echo \"Usando Node/NPM em: \$NODE_BIN\"

  cd ${SERVER_DIR}
  npm install --omit=dev
"

# 5. Copiar .env se não existe no servidor
echo "[5/6] Verificando .env no servidor..."
ssh -i "$SSH_KEY" "${SERVER_USER}@${SERVER_HOST}" "
  if [ ! -f ${SERVER_DIR}/.env ]; then
    echo '.env não encontrado no servidor. Copiando .env.example...'
    cp ${SERVER_DIR}/.env.example ${SERVER_DIR}/.env
    echo 'IMPORTANTE: Edite ${SERVER_DIR}/.env com as credenciais reais!'
  else
    echo '.env já existe no servidor.'
  fi
"

# 6. Renomear identidade do agente de afazeres sem mudar o id interno
echo "[6/6] Ajustando nome visivel do agente de afazeres..."
ssh -i "$SSH_KEY" "${SERVER_USER}@${SERVER_HOST}" "
  set -euo pipefail
  cd ${SERVER_DIR}

  OPENCLAW_BIN=''
  for CANDIDATE in \
    \"\$HOME/.nvm/current/bin/openclaw\" \
    \"\$HOME/.nvm/versions/node\"/*/bin/openclaw \
    \"\$HOME/.local/openclaw-node22/current/bin/openclaw\" \
    \"\$HOME/.local/openclaw-node22/bin/openclaw\"
  do
    if [ -x \"\$CANDIDATE\" ]; then
      OPENCLAW_BIN=\"\$CANDIDATE\"
      break
    fi
  done

  if [ -z \"\$OPENCLAW_BIN\" ] && command -v openclaw >/dev/null 2>&1; then
    OPENCLAW_BIN=\"\$(command -v openclaw)\"
  fi

  if [ -z \"\$OPENCLAW_BIN\" ]; then
    echo 'Aviso: openclaw nao encontrado no servidor; pulando ajuste de identidade.'
    exit 0
  fi

  UPDATED=0
  for AGENT_ID in zoe-tarefas-prioridade zoe-afazeres; do
    WORKSPACE=\"\$HOME/.openclaw/workspace-\$AGENT_ID\"
    if \"\$OPENCLAW_BIN\" agents set-identity --agent \"\$AGENT_ID\" --workspace \"\$WORKSPACE\" --name \"zoe-afazeres\" --json >/dev/null 2>&1; then
      UPDATED=1
      echo \"Nome visivel ajustado para zoe-afazeres no agente \$AGENT_ID.\"
    fi
  done

  if [ \"\$UPDATED\" -eq 0 ]; then
    echo 'Aviso: agente de afazeres nao encontrado para renomear.'
  fi
"

echo ""
echo "=== Deploy concluído! ==="
echo ""
echo "Próximos passos:"
echo "  1. SSH no servidor: ssh -i $SSH_KEY ${SERVER_USER}@${SERVER_HOST}"
echo "  2. Editar .env: nano ${SERVER_DIR}/.env"
echo "  3. Testar parser: cd ${SERVER_DIR} && ~/.local/openclaw-node22/current/bin/node agents/fba/parser.js"
echo "  4. Rodar FBA (dry-run): ~/.local/openclaw-node22/current/bin/node agents/fba/index.js --dry-run"
echo "  5. Rodar FBA (com browser): ~/.local/openclaw-node22/current/bin/node agents/fba/index.js"
