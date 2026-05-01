#!/usr/bin/env bash
set -u

OUT_DIR="${1:-/tmp/diag-ubuntu}"
shift 2>/dev/null || true

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
REPORT_FILE="$OUT_DIR/diagnostico.txt"

run_block() {
  local title="$1"
  local cmd="$2"

  {
    echo
    echo "============================================================"
    echo "$title"
    echo "Comando: $cmd"
    echo "============================================================"
    bash -lc "$cmd" 2>&1 || true
  } >> "$REPORT_FILE"
}

{
  echo "DIAGNOSTICO UBUNTU 24 - HOME SERVER"
  echo "Gerado em: $(date -Iseconds)"
  echo "Host: $(hostname 2>/dev/null || echo desconhecido)"
} > "$REPORT_FILE"

run_block "1) Identidade e uptime" "hostnamectl || true; uptime"
run_block "2) Sistema operacional" "cat /etc/os-release"
run_block "3) Uso de CPU e memoria" "free -h; vmstat 1 5 || true"
run_block "4) Top processos" "ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%cpu | head -n 20"
run_block "5) Disco e inode" "df -hT; df -i"
run_block "6) Rede e portas" "ip -br a; ip route; ss -tulpen"
run_block "7) Firewall" "ufw status verbose || true"
run_block "8) Servicos com falha" "systemctl --failed --no-pager || true"
run_block "9) Erros recentes do sistema" "journalctl -p 3 -n 200 --no-pager || true"

if command -v docker >/dev/null 2>&1; then
  run_block "10) Docker resumo" "docker ps -a; docker stats --no-stream || true"
fi

if [ "$#" -gt 0 ]; then
  for svc in "$@"; do
    run_block "Servico: $svc (status)" "systemctl status --no-pager -l '$svc' || true"
    run_block "Servico: $svc (logs recentes)" "journalctl -u '$svc' -n 150 --no-pager || true"
  done
fi

cat > "$OUT_DIR/README.txt" <<TXT
Arquivos gerados:
- $REPORT_FILE

Como usar:
1) Abra o diagnostico.txt
2) Procure secoes com erros, servicos em falha e falta de recursos
3) Use esses achados para decidir a menor correcao possivel
TXT

echo "[OK] Diagnostico salvo em: $REPORT_FILE"
echo "[OK] Guia rapido: $OUT_DIR/README.txt"
echo "[INFO] Timestamp da coleta: $TIMESTAMP"
