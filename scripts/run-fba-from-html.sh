#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Uso:
  bash run-fba-from-html.sh [opcoes]

Opcoes:
  --html <arquivo>       Caminho (absoluto/relativo) ou nome do arquivo HTML.
  --mode <modo>          auto | dry-run | resume | manual (padrao: auto)
  --batch-size <n>       Define FBA_BATCH_SIZE (padrao: 120)
  --audit                Ativa trilha de auditoria detalhada (eventos por produto)
  --audit-screenshots    Ativa screenshots de auditoria (mais pesado)
  --no-auto-vpn          Nao tenta ligar VPN automaticamente antes do FBA
  --vpn-profile <nome>   Perfil do NetworkManager (padrao: usa-newyork-udp)
  --no-parse             Nao roda parser antes do index.js
  --help                 Mostra esta ajuda

Exemplos:
  bash run-fba-from-html.sh --html "/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/Produtos.html" --mode auto
  bash run-fba-from-html.sh --html "Produtos.html" --mode dry-run
  bash run-fba-from-html.sh --mode resume
EOF
}

log() {
  echo "[fba-runner] $*"
}

die() {
  echo "[fba-runner][ERRO] $*" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Se estiver rodando a partir do workspace da Zoe, usa o projeto real.
if [[ ! -d "$PROJECT_DIR/agents/fba" && -d "/home/bonette/openclaw-agents/agents/fba" ]]; then
  PROJECT_DIR="/home/bonette/openclaw-agents"
fi

WORKSPACE_DIR="/home/bonette/.openclaw/workspace"
ENV_FILE="$PROJECT_DIR/.env"
INPUT_DIR="$PROJECT_DIR/amazon-fba/produtos-fornecedores-html"
OUTPUT_DIR="$PROJECT_DIR/amazon-fba/produtos-encontrados"
INBOX_DIR="$INPUT_DIR"
STATE_FILE="$PROJECT_DIR/storage/state/fba.json"

MODE="auto"
HTML_INPUT=""
BATCH_SIZE="${FBA_BATCH_SIZE:-120}"
NO_PARSE=0
AUDIT=0
AUDIT_SCREENSHOTS=0
AUTO_VPN="${FBA_AUTO_VPN:-1}"
VPN_PROFILE="${FBA_VPN_PROFILE:-usa-newyork-udp}"
VPN_WAIT_SECONDS="${FBA_VPN_WAIT_SECONDS:-25}"
VPN_UP_CMD="${FBA_VPN_UP_CMD:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --html)
      [[ $# -ge 2 ]] || die "Faltou valor para --html"
      HTML_INPUT="$2"
      shift 2
      ;;
    --mode)
      [[ $# -ge 2 ]] || die "Faltou valor para --mode"
      MODE="$2"
      shift 2
      ;;
    --batch-size)
      [[ $# -ge 2 ]] || die "Faltou valor para --batch-size"
      BATCH_SIZE="$2"
      shift 2
      ;;
    --audit)
      AUDIT=1
      shift
      ;;
    --audit-screenshots)
      AUDIT=1
      AUDIT_SCREENSHOTS=1
      shift
      ;;
    --no-auto-vpn)
      AUTO_VPN=0
      shift
      ;;
    --vpn-profile)
      [[ $# -ge 2 ]] || die "Faltou valor para --vpn-profile"
      VPN_PROFILE="$2"
      shift 2
      ;;
    --no-parse)
      NO_PARSE=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Opcao desconhecida: $1"
      ;;
  esac
done

case "$MODE" in
  auto|dry-run|resume|manual) ;;
  *)
    die "Modo invalido: $MODE (use auto, dry-run, resume ou manual)"
    ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

INPUT_DIR="${FBA_INPUT_DIR:-$INPUT_DIR}"
OUTPUT_DIR="${FBA_OUTPUT_DIR:-$OUTPUT_DIR}"
INBOX_DIR="$INPUT_DIR"
AUTO_VPN="${FBA_AUTO_VPN:-$AUTO_VPN}"
VPN_PROFILE="${FBA_VPN_PROFILE:-$VPN_PROFILE}"
VPN_WAIT_SECONDS="${FBA_VPN_WAIT_SECONDS:-$VPN_WAIT_SECONDS}"
VPN_UP_CMD="${FBA_VPN_UP_CMD:-$VPN_UP_CMD}"

mkdir -p "$INPUT_DIR" "$OUTPUT_DIR"

is_true() {
  case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

country_allowed() {
  local detected="${1^^}"
  local allowed="${VPN_ALLOWED_COUNTRIES:-US}"
  IFS=',' read -r -a countries <<< "$allowed"
  for c in "${countries[@]}"; do
    c="$(echo "$c" | xargs | tr '[:lower:]' '[:upper:]')"
    [[ -n "$c" ]] || continue
    if [[ "$detected" == "$c" ]]; then
      return 0
    fi
  done
  return 1
}

probe_vpn_endpoints() {
  python3 - "${VPN_CHECK_URL:-https://ipwho.is/}" <<'PY'
import json
import sys
import urllib.request

preferred = sys.argv[1] if len(sys.argv) > 1 else "https://ipwho.is/"
urls = [preferred, "https://ipapi.co/json/", "https://ipinfo.io/json"]
seen = set()

for url in urls:
    if not url or url in seen:
        continue
    seen.add(url)
    try:
        req = urllib.request.Request(url, headers={"accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = getattr(resp, "status", 200)
            if status < 200 or status >= 300:
                raise RuntimeError(f"HTTP {status}")
            data = json.loads(resp.read().decode("utf-8", "replace"))

        cc = str(
            data.get("country_code")
            or data.get("countryCode")
            or data.get("countryCodeIso3")
            or data.get("country_code_iso3")
            or data.get("country")
            or ""
        ).strip().upper()
        country = str(data.get("country_name") or data.get("country") or "desconhecido").strip()
        ip = str(data.get("ip") or data.get("query") or data.get("ip_addr") or "desconhecido").strip()

        if not cc or len(cc) < 2:
            raise RuntimeError("resposta sem country_code")

        print(f"OK|{url}|{cc}|{country}|{ip}")
        sys.exit(0)
    except Exception as err:
        print(f"ERR|{url}|{err}")

sys.exit(1)
PY
}

try_enable_vpn() {
  log "Tentando ativar VPN automaticamente..."

  if [[ -n "${VPN_UP_CMD:-}" ]]; then
    log "Executando FBA_VPN_UP_CMD..."
    bash -lc "$VPN_UP_CMD" || log "Aviso: FBA_VPN_UP_CMD falhou."
  fi

  if command -v nmcli >/dev/null 2>&1; then
    if nmcli -t -f NAME connection show | grep -Fxq "$VPN_PROFILE"; then
      log "Ativando perfil NM: $VPN_PROFILE"
      if ! nmcli --wait 15 connection up "$VPN_PROFILE"; then
        log "Aviso: falha ao subir perfil $VPN_PROFILE via nmcli direto. Tentando sudo -n..."
        if command -v sudo >/dev/null 2>&1; then
          sudo -n nmcli --wait 15 connection up "$VPN_PROFILE" || \
            log "Aviso: falha tambem com sudo -n nmcli."
        fi
      fi
    else
      log "Aviso: perfil NM '$VPN_PROFILE' nao encontrado."
    fi
  else
    log "Aviso: nmcli nao encontrado para auto-VPN."
  fi

  if command -v systemctl >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    local unit="openvpn-client@fastestvpn-us"
    if systemctl list-unit-files | grep -q "^${unit}\\.service"; then
      log "Tentando fallback via serviço ${unit} (sudo -n)..."
      sudo -n systemctl start "${unit}" || true
    fi
  fi
}

ensure_vpn_us_before_fba() {
  if ! is_true "${VPN_REQUIRED:-false}"; then
    return 0
  fi

  local probe_out ok_line cc country ip endpoint attempts wait_left
  probe_out="$(probe_vpn_endpoints 2>/dev/null || true)"
  ok_line="$(echo "$probe_out" | grep '^OK|' | tail -n1 || true)"

  if [[ -n "$ok_line" ]]; then
    IFS='|' read -r _ endpoint cc country ip <<< "$ok_line"
    if country_allowed "$cc"; then
      log "VPN já validada: $cc ($country) | IP $ip | endpoint=$endpoint"
      return 0
    fi
  fi

  if ! is_true "$AUTO_VPN"; then
    die "VPN obrigatoria e pais atual fora da lista permitida. Ative a VPN manualmente ou remova --no-auto-vpn."
  fi

  try_enable_vpn

  wait_left="${VPN_WAIT_SECONDS:-25}"
  attempts=0
  while (( wait_left >= 0 )); do
    attempts=$((attempts + 1))
    probe_out="$(probe_vpn_endpoints 2>/dev/null || true)"
    ok_line="$(echo "$probe_out" | grep '^OK|' | tail -n1 || true)"

    if [[ -n "$ok_line" ]]; then
      IFS='|' read -r _ endpoint cc country ip <<< "$ok_line"
      if country_allowed "$cc"; then
        log "VPN validada apos auto-start: $cc ($country) | IP $ip | endpoint=$endpoint"
        return 0
      fi
      log "VPN ainda fora da lista permitida: $cc ($country) | IP $ip"
    else
      log "Ainda sem resposta valida de endpoint de IP."
    fi

    (( wait_left <= 0 )) && break
    sleep 3
    wait_left=$((wait_left - 3))
  done

  die "Falha ao validar VPN apos tentativa automatica. Detalhes: $(echo "$probe_out" | tr '\n' ' ' | xargs). Se houver 'Not authorized to control networking', libere nmcli para o usuario bonette via sudoers."
}

resolve_node_bin() {
  if [[ -n "${NODE:-}" && -x "${NODE:-}" ]]; then
    echo "$NODE"
    return
  fi

  if [[ -x "/home/bonette/.local/openclaw-node22/current/bin/node" ]]; then
    echo "/home/bonette/.local/openclaw-node22/current/bin/node"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  if [[ -d "$HOME/.nvm/versions/node" ]]; then
    local found
    found="$(find "$HOME/.nvm/versions/node" -maxdepth 4 -type f -path '*/bin/node' 2>/dev/null | sort -V | tail -n1 || true)"
    if [[ -n "$found" && -x "$found" ]]; then
      echo "$found"
      return
    fi
  fi

  die "Node nao encontrado. Configure NODE ou instale o Node no servidor."
}

NODE_BIN="$(resolve_node_bin)"
[[ -x "$NODE_BIN" ]] || die "Node invalido: $NODE_BIN"

resolve_html_path() {
  local input="$1"
  [[ -n "$input" ]] || return 0

  if [[ "$input" = /* && -f "$input" ]]; then
    echo "$input"
    return
  fi

  if [[ -f "$input" ]]; then
    echo "$(cd "$(dirname "$input")" && pwd)/$(basename "$input")"
    return
  fi

  local candidate
  for base in \
    "$INPUT_DIR" \
    "$PROJECT_DIR" \
    "$WORKSPACE_DIR" \
    "$INBOX_DIR" \
    "$PROJECT_DIR/storage" \
    "$WORKSPACE_DIR/inbox"
  do
    candidate="$base/$input"
    if [[ -f "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done

  die "HTML nao encontrado: $input"
}

find_latest_html() {
  local latest
  latest="$(
    for dir in \
      "$INBOX_DIR" \
      "$INPUT_DIR" \
      "$WORKSPACE_DIR/inbox/fba-html" \
      "$PROJECT_DIR" \
      "$WORKSPACE_DIR"
    do
      [[ -d "$dir" ]] || continue
      find "$dir" -maxdepth 3 -type f -name '*.html' -printf '%T@ %p\n' 2>/dev/null
    done | sort -nr | head -n1 | cut -d' ' -f2-
  )"
  [[ -n "$latest" ]] && echo "$latest"
}

read_html_from_state() {
  [[ -f "$STATE_FILE" ]] || return 0
  python3 - "$STATE_FILE" <<'PY'
import json, os, sys
p = sys.argv[1]
try:
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    html = (data.get("htmlFile") or "").strip()
    if html and os.path.isfile(html):
        print(html)
except Exception:
    pass
PY
}

prepare_html_copy() {
  local src="$1"
  mkdir -p "$INBOX_DIR"

  # Mantem se ja estiver na inbox padrao.
  if [[ "$src" == "$INBOX_DIR/"* ]]; then
    echo "$src"
    return
  fi

  local safe_name
  safe_name="$(basename "$src" | tr ' ' '_' | tr -cd '[:alnum:]._-')"
  [[ -n "$safe_name" ]] || safe_name="fba-input.html"
  local dest="$INBOX_DIR/$(date +%Y%m%d-%H%M%S)-$safe_name"

  cp "$src" "$dest"
  echo "$dest"
}

HTML_PATH=""

if [[ "$MODE" == "resume" ]]; then
  if [[ -n "$HTML_INPUT" ]]; then
    HTML_PATH="$(resolve_html_path "$HTML_INPUT")"
  else
    HTML_PATH="$(read_html_from_state || true)"
    if [[ -z "$HTML_PATH" ]]; then
      HTML_PATH="$(find_latest_html || true)"
    fi
  fi
else
  if [[ -n "$HTML_INPUT" ]]; then
    HTML_PATH="$(resolve_html_path "$HTML_INPUT")"
  else
    HTML_PATH="$(find_latest_html || true)"
  fi
fi

if [[ -z "$HTML_PATH" ]]; then
  die "Nao foi possivel determinar HTML. Informe --html ou coloque o arquivo em $INBOX_DIR"
fi

if [[ "$MODE" != "resume" ]]; then
  HTML_PATH="$(prepare_html_copy "$HTML_PATH")"
fi

export FBA_HTML_PATH="$HTML_PATH"
export FBA_BATCH_SIZE="$BATCH_SIZE"
export FBA_INPUT_DIR="$INPUT_DIR"
export FBA_OUTPUT_DIR="$OUTPUT_DIR"
export FBA_AUDIT="$AUDIT"
export FBA_AUDIT_SCREENSHOTS="$AUDIT_SCREENSHOTS"

log "Projeto: $PROJECT_DIR"
log "Modo: $MODE"
log "Node: $NODE_BIN"
log "HTML: $FBA_HTML_PATH"
log "Batch size: $FBA_BATCH_SIZE"
log "Input dir: $FBA_INPUT_DIR"
log "Output dir: $FBA_OUTPUT_DIR"
log "Audit: $FBA_AUDIT (screenshots=$FBA_AUDIT_SCREENSHOTS)"
log "Auto VPN: $AUTO_VPN (profile=$VPN_PROFILE, wait=${VPN_WAIT_SECONDS}s)"

cd "$PROJECT_DIR"

if [[ "$MODE" != "dry-run" ]]; then
  ensure_vpn_us_before_fba
fi

if [[ "$MODE" != "resume" && "$NO_PARSE" -ne 1 ]]; then
  log "Validando parser..."
  "$NODE_BIN" agents/fba/parser.js "$FBA_HTML_PATH"
fi

case "$MODE" in
  auto)
    log "Iniciando execucao automatica..."
    "$NODE_BIN" agents/fba/index.js
    ;;
  dry-run)
    log "Iniciando dry-run..."
    "$NODE_BIN" agents/fba/index.js --dry-run
    ;;
  manual)
    log "Iniciando modo manual..."
    "$NODE_BIN" agents/fba/index.js --manual
    ;;
  resume)
    log "Retomando execucao..."
    "$NODE_BIN" agents/fba/index.js --resume
    ;;
esac

log "Concluido. Relatorios em: $FBA_OUTPUT_DIR"
