# Runbook Operacional — Plataforma Multi-Agente Open Claw

## Operacoes Diarias

### Iniciar o dia
```bash
# 1. Verificar servidor acessivel
ping -c 1 192.168.0.173

# 2. Verificar gateway Open Claw
ssh bonette@192.168.0.173 "systemctl --user status openclaw-gateway --no-pager"

# 3. Ativar tunnel (se nao esta rodando como servico)
bash scripts/ssh-tunnel.sh &
```

### Rodar agente FBA
```bash
# No servidor:
ssh bonette@192.168.0.173
cd ~/openclaw-agents

# Ativar VPN US primeiro!
# Fechar Chrome se estiver aberto

# Primeiro batch (50 produtos):
node agents/fba/index.js

# Continuar de onde parou:
node agents/fba/index.js --resume

# Ver progresso:
cat storage/state/fba.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Processados: {len(d.get(\"productResults\",{}))} | Ultimo: {d.get(\"lastProcessedIndex\",0)}')"
```

### Verificar logs
```bash
# Logs do FBA
ssh bonette@192.168.0.173 "tail -50 ~/openclaw-agents/storage/logs/fba-agent.log"

# Erros gerais
ssh bonette@192.168.0.173 "tail -20 ~/openclaw-agents/storage/logs/errors.log"

# Logs do Gateway
ssh bonette@192.168.0.173 "journalctl --user -u openclaw-gateway --since '1 hour ago' --no-pager"
```

---

## Operacoes de Manutencao

### Desativar auto deploy recorrente (se estiver ativo no servidor)
```bash
cd ~/Documentos/Projetos/config-open-claw
bash scripts/remote-disable-autodeploy.sh
```

### Atualizar codigo no servidor
```bash
cd ~/Documentos/Projetos/config-open-claw
bash scripts/deploy.sh
```

### Deploy live (atualiza e aplica no ar em um comando)
```bash
cd ~/Documentos/Projetos/config-open-claw
bash scripts/deploy-live.sh
```

### Reiniciar Gateway Open Claw
```bash
ssh bonette@192.168.0.173 "systemctl --user restart openclaw-gateway"
```

### Limpar logs antigos
```bash
ssh bonette@192.168.0.173 "find ~/openclaw-agents/storage/logs/ -name '*.log' -mtime +30 -delete"
```

### Backup do estado dos agentes
```bash
scp -r bonette@192.168.0.173:~/openclaw-agents/storage/state/ ./backups/state-$(date +%Y%m%d)/
```

### Resetar estado do FBA (recomecar do zero)
```bash
ssh bonette@192.168.0.173 "rm ~/openclaw-agents/storage/state/fba.json"
```

---

## Resolucao de Problemas

### Gateway parou
```bash
# Verificar status
ssh bonette@192.168.0.173 "systemctl --user status openclaw-gateway"

# Ver logs de erro
ssh bonette@192.168.0.173 "journalctl --user -u openclaw-gateway --since '30 min ago' --no-pager"

# Reiniciar
ssh bonette@192.168.0.173 "systemctl --user restart openclaw-gateway"
```

### Chrome travou / nao fecha
```bash
ssh bonette@192.168.0.173 "pkill -f chrome || pkill -f chromium"
```

### CAPTCHA na Amazon
1. Ver screenshot: `ls storage/screenshots/captcha-*`
2. Abrir Chrome manualmente no servidor (via VNC/X11)
3. Resolver captcha
4. Fechar Chrome
5. Rodar FBA com `--resume`

### Servidor nao responde
1. Verificar se esta na mesma rede: `ping 192.168.0.173`
2. Verificar se SSH responde: `ssh -o ConnectTimeout=5 bonette@192.168.0.173 echo ok`
3. Se nao responder: verificar fisicamente se esta ligado

### Disco cheio no servidor
```bash
ssh bonette@192.168.0.173 "df -h / && du -sh ~/openclaw-agents/storage/*"
# Limpar screenshots antigos:
ssh bonette@192.168.0.173 "find ~/openclaw-agents/storage/screenshots/ -mtime +7 -delete"
```

---

## Contatos e Recursos

| Recurso | Local |
|---------|-------|
| Codigo fonte | ~/Documentos/Projetos/config-open-claw/ |
| Servidor | bonette@192.168.0.173 |
| Open Claw config | ~/.openclaw/openclaw.json (no servidor) |
| Guia completo | docs/Guia-Para-Open-Claw.md |
| Estado FBA | storage/state/fba.json |
| Logs | storage/logs/ |
| Screenshots | storage/screenshots/ |
