# Ops Issue Playbook

## 1) VPN nao inicia no fluxo FBA
Sinais comuns:
- erro de pais fora da lista permitida;
- falha no auto-VPN.

Passos:
1. validar perfil VPN;
2. subir VPN manualmente;
3. retomar processamento com `--resume`.

Comandos:
```bash
nmcli connection up usa-newyork-udp
bash scripts/run-fba-from-html.sh --mode resume
```

## 2) Erro de token/API
Sinais comuns:
- 401/403;
- token ausente/invalido;
- instancia incorreta.

Passos:
1. validar variavel no `.env`;
2. validar endpoint/base URL;
3. testar chamada minima;
4. repetir fluxo.

## 3) Resposta inconsistente do agente
Passos:
1. ler `storage/logs/<agente>.log`;
2. conferir estado em `storage/state/<agente>.json`;
3. comparar entrada recebida vs output esperado;
4. corrigir validacao de entrada e tratamento de erro.

## 4) Falha de integracao entre componentes
Passos:
1. mapear fronteira entre modulos (agente -> core -> integration -> API);
2. validar contrato de payload;
3. registrar erro com contexto suficiente;
4. corrigir ponto de contrato quebrado.

## 5) Falha de deploy/gateway/tunnel
Passos:
1. validar SSH;
2. executar deploy;
3. validar Docker;
4. validar `openclaw-gateway`;
5. validar tunnel.

Comandos:
```bash
npm run deploy:live
ssh bonette@192.168.0.173 'systemctl --user is-active openclaw-gateway'
bash scripts/ssh-tunnel.sh
```
