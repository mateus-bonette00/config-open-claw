#!/usr/bin/env bash
set -euo pipefail

# =================================================================
# Registra os agentes no Open Claw gateway (rodar no servidor)
#
# Uso (no servidor): bash scripts/register-agents.sh
# =================================================================

OPENCLAW_BIN="${OPENCLAW_BIN:-}"

if [ -z "$OPENCLAW_BIN" ]; then
  for CANDIDATE in \
    "$HOME/.nvm/current/bin/openclaw" \
    "$HOME/.nvm/versions/node"/*/bin/openclaw \
    "$HOME/.local/openclaw-node22/current/bin/openclaw" \
    "$HOME/.local/openclaw-node22/bin/openclaw"
  do
    if [ -x "$CANDIDATE" ]; then
      OPENCLAW_BIN="$CANDIDATE"
      break
    fi
  done
fi

if [ -z "$OPENCLAW_BIN" ] && command -v openclaw >/dev/null 2>&1; then
  OPENCLAW_BIN="$(command -v openclaw)"
fi

if [ -z "$OPENCLAW_BIN" ]; then
  DISCOVERED_OPENCLAW="$(find "$HOME/.nvm/versions/node" -maxdepth 4 -path '*/bin/openclaw' 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$DISCOVERED_OPENCLAW" ]; then
    OPENCLAW_BIN="$DISCOVERED_OPENCLAW"
  fi
fi

if [ ! -x "$OPENCLAW_BIN" ]; then
  echo "ERRO: openclaw não encontrado em $OPENCLAW_BIN"
  echo "Verifique a instalação do Open Claw."
  exit 1
fi

export PATH="$(dirname "$OPENCLAW_BIN"):$PATH"

echo "=== Registrando agentes no Open Claw ==="
echo "Usando Open Claw em: $OPENCLAW_BIN"

FAILED=0

register_agent() {
  local step="$1"
  local total="$2"
  local label="$3"
  local agent_id="$4"
  local workspace="$HOME/.openclaw/workspace-$agent_id"
  local output

  echo "[$step/$total] Registrando agente $label..."

  if output="$("$OPENCLAW_BIN" agents add "$agent_id" --non-interactive --workspace "$workspace" --json 2>&1)"; then
    echo "  (agente criado)"
    return 0
  fi

  if echo "$output" | grep -q 'already exists'; then
    echo "  (agente já existe)"
    return 0
  fi

  echo "  ERRO ao registrar $agent_id:"
  echo "$output"
  FAILED=1
}

set_agent_identity() {
  local agent_id="$1"
  local display_name="$2"
  local workspace="$HOME/.openclaw/workspace-$agent_id"
  local output

  echo "  Ajustando nome visivel de $agent_id para $display_name..."

  if output="$("$OPENCLAW_BIN" agents set-identity --agent "$agent_id" --workspace "$workspace" --name "$display_name" --json 2>&1)"; then
    echo "  (nome visivel atualizado)"
    return 0
  fi

  echo "  Aviso: nao foi possivel ajustar identidade de $agent_id"
  echo "$output"
}

TOTAL_AGENTS=5
register_agent "1" "$TOTAL_AGENTS" "LUCAS1" "fba-amazon"
set_agent_identity "fba-amazon" "LUCAS1"
register_agent "2" "$TOTAL_AGENTS" "Varredor de Fornecedores" "varredor-fornecedores"
set_agent_identity "varredor-fornecedores" "Varredor de Fornecedores"
register_agent "3" "$TOTAL_AGENTS" "WhatsApp Lembretes + Tarefas" "whatsapp-lembretes"
register_agent "4" "$TOTAL_AGENTS" "Pro-saude Social" "prosaude-social"
register_agent "5" "$TOTAL_AGENTS" "Moontech Prospecting" "moontech-prospecting"

echo ""
echo "=== Registro concluído ==="
echo "Listar agentes: PATH=\"$(dirname "$OPENCLAW_BIN"):\$PATH\" $OPENCLAW_BIN agents list"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
