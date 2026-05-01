---
name: ubuntu-home-server-ops
description: Diagnostico e recuperacao segura de servidor Ubuntu 24 rodando em desktop (home lab). Use esta skill sempre que o usuario relatar servidor fora do ar, lentidao, aplicacao ou servico que nao inicia, erro de porta ou rede, disco cheio, reboot inesperado, falha apos update, ou problemas com systemd, Docker, Nginx, banco de dados e acesso SSH.
---

# Ubuntu Home Server Ops

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


## Objetivo
Diagnosticar e recuperar servidor Ubuntu 24 com baixo risco operacional.
Priorizar coleta e leitura antes de alteracoes. Fazer mudancas pequenas, validar cada passo e registrar o que foi feito.

## Fluxo Padrao de Atendimento
1. Confirmar o problema em linguagem simples.
2. Medir impacto: quais apps caidas, desde quando, quem foi afetado.
3. Coletar evidencias iniciais com `.agent/skills/ubuntu-home-server-ops/scripts/coletar_diagnostico.sh`.
4. Classificar o incidente (acesso, recursos, servico, rede, update).
5. Aplicar correcao minima e reversivel.
6. Validar que voltou ao normal e registrar prevencao.

## Coleta Inicial Obrigatoria
Executar no servidor:

```bash
bash .agent/skills/ubuntu-home-server-ops/scripts/coletar_diagnostico.sh /tmp/diag-ubuntu service1 service2
```

- Trocar `service1 service2` pelos servicos criticos (ex.: `nginx docker postgresql`).
- Se nao souber os servicos, rodar sem nomes:

```bash
bash .agent/skills/ubuntu-home-server-ops/scripts/coletar_diagnostico.sh /tmp/diag-ubuntu
```

- Usar o arquivo gerado em `/tmp/diag-ubuntu/diagnostico.txt` como base do diagnostico.

## Roteiro de Diagnostico por Sintoma
### 1) Servidor fora do ar
- Confirmar energia/cabo/rede local primeiro.
- Testar ping e SSH a partir de outra maquina.
- Se SSH falhar, verificar no console local: IP, gateway, status do `ssh`.
- So reiniciar servidor inteiro se a coleta indicar travamento sem alternativa.

### 2) Servidor lento
- Verificar CPU, RAM, swap e disco.
- Identificar processo no topo de consumo (`ps` + `%cpu`/`%mem`).
- Se houver servico em loop de erro, corrigir causa e reiniciar apenas esse servico.

### 3) Aplicacao nao sobe
- Verificar `systemctl status <servico>`.
- Verificar logs recentes (`journalctl -u <servico> -n 200`).
- Confirmar variaveis de ambiente, porta em uso e permissao de arquivos.

### 4) Porta/rede com falha
- Verificar portas escutando (`ss -tulpen`).
- Validar firewall (`ufw status`) e rotas (`ip route`).
- Testar localmente (`curl http://127.0.0.1:PORTA`) antes de testar externo.

### 5) Disco cheio
- Medir uso com `df -hT`.
- Encontrar viloes com `du -h --max-depth=2` em diretorios grandes.
- Limpar cache/logs com seguranca e confirmar espaco liberado.

## Regras de Seguranca
- Evitar comandos destrutivos sem confirmar risco e impacto.
- Nao apagar dados de app ou banco sem backup.
- Nao executar `rm -rf` em caminhos duvidosos.
- Preferir restart de servico em vez de reboot geral.
- Em mudanca sensivel, informar risco + rollback antes de executar.

## Formato da Resposta ao Usuario
Sempre responder neste formato:
1. `Resumo do problema`: o que esta quebrado.
2. `Evidencias`: comandos e principais achados.
3. `Causa provavel`: com nivel de confianca (alto, medio, baixo).
4. `Correcao aplicada`: o que foi feito e por que foi seguro.
5. `Validacao`: testes que provaram a recuperacao.
6. `Prevencao`: 1 a 3 acoes simples para evitar recorrencia.

## Referencias
- Ler `references/playbook-incidentes.md` para checklist pronto por tipo de incidente.
