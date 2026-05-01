#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-/home/bonette/.openclaw/openclaw.json}"
PREFERRED_CODEX_PROFILE="${OPENCLAW_PREFERRED_CODEX_PROFILE:-openai-codex:mateus.bonette00@gmail.com}"
MAIN_AUTH_PATH="${OPENCLAW_MAIN_AUTH_PATH:-/home/bonette/.openclaw/agents/main/agent/auth-profiles.json}"
FBA_AUTH_PATH="${OPENCLAW_FBA_AUTH_PATH:-/home/bonette/.openclaw/agents/fba-amazon/agent/auth-profiles.json}"

log() {
  printf '[configure-openclaw-lucas1] %s\n' "$*"
}

die() {
  printf '[configure-openclaw-lucas1][ERRO] %s\n' "$*" >&2
  exit 1
}

[[ -f "$OPENCLAW_CONFIG_PATH" ]] || die "openclaw.json nao encontrado em $OPENCLAW_CONFIG_PATH"

python3 - "$OPENCLAW_CONFIG_PATH" "$PREFERRED_CODEX_PROFILE" "$MAIN_AUTH_PATH" "$FBA_AUTH_PATH" <<'PY'
import json
import os
import shutil
import sys
from datetime import datetime, timezone

config_path, preferred_profile, main_auth_path, fba_auth_path = sys.argv[1:5]
timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

def backup(path):
    if os.path.isfile(path):
        shutil.copy2(path, f"{path}.bak.{timestamp}")

def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)

def dump_json(path, payload):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

backup(config_path)
config = load_json(config_path)

agents_root = config.setdefault("agents", {})
defaults = agents_root.setdefault("defaults", {})
models = defaults.setdefault("models", {})
models.setdefault("openai-codex/gpt-5.4", {})
models["openai-codex/gpt-5.4"]["alias"] = "gpt-5.4"

agents_list = agents_root.get("list", [])
for agent in agents_list:
    if agent.get("id") == "main":
        agent["model"] = {
            "primary": "google-gemini-cli/gemini-2.5-flash",
            "fallbacks": ["openai-codex/gpt-5.4"]
        }
        params = agent.setdefault("params", {})
        params["thinking"] = "minimal"
    elif agent.get("id") == "fba-amazon":
        agent["model"] = {
            "primary": "openai-codex/gpt-5.4"
        }
        params = agent.setdefault("params", {})
        params["thinking"] = "high"

dump_json(config_path, config)

for auth_path in [main_auth_path, fba_auth_path]:
    if not os.path.isfile(auth_path):
        continue

    backup(auth_path)
    auth_data = load_json(auth_path)
    profiles = auth_data.get("profiles", {})
    if preferred_profile not in profiles:
        raise SystemExit(f"Perfil OAuth preferido nao encontrado em {auth_path}: {preferred_profile}")

    last_good = auth_data.setdefault("lastGood", {})
    last_good["openai-codex"] = preferred_profile
    dump_json(auth_path, auth_data)

print(json.dumps({
    "configPath": config_path,
    "preferredCodexProfile": preferred_profile,
    "patchedAuthFiles": [path for path in [main_auth_path, fba_auth_path] if os.path.isfile(path)]
}, ensure_ascii=False, indent=2))
PY

log "Configuração do OpenClaw atualizada."
