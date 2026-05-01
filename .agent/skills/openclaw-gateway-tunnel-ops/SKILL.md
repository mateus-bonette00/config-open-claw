---
name: openclaw-gateway-tunnel-ops
description: Use para configurar e diagnosticar acesso ao gateway OpenClaw via SSH tunnel (manual ou service systemd) no notebook.
---

# OpenClaw Gateway Tunnel Ops

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


## Objetivo
Manter o acesso local ao gateway remoto estavel e reproduzivel.

## Quando Usar
- Falha ao abrir tunnel manual.
- Necessidade de tunnel persistente via systemd user.
- Problema de porta local/remota.
- Queda recorrente de conexao SSH.

## Arquivos Foco
1. `scripts/ssh-tunnel.sh`
2. `scripts/ssh-tunnel-service.sh`
3. `scripts/deploy-live.sh` (validacao de gateway apos deploy)

## Fluxo Obrigatorio
1. Confirmar usuario, host, chave e portas.
2. Testar tunnel manual primeiro.
3. Se precisar persistencia, instalar service.
4. Validar status do service e reconexao.
5. Confirmar acesso local `127.0.0.1:<porta>`.

## Comandos De Validacao
- `bash scripts/ssh-tunnel.sh`
- `bash scripts/ssh-tunnel-service.sh`
- `systemctl --user status openclaw-tunnel`

## Regras De Seguranca
- Nao expor chave SSH em logs/resposta.
- Nao abrir bind publico desnecessario (usar `127.0.0.1`).
- Sempre usar `ExitOnForwardFailure=yes`.

## Formato De Entrega
1. Cenario.
2. Passo aplicado.
3. Status final do tunnel.
4. Proximo passo.

## Exemplos De Prompt
- `Use $openclaw-gateway-tunnel-ops. Diagnosticar por que o tunnel cai apos alguns minutos.`
- `Use $openclaw-gateway-tunnel-ops. Configurar modo persistente com systemd user.`

