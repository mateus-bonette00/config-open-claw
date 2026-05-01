# Playbook de Incidentes - Ubuntu Home Server

## Uso rapido
1. Confirmar sintoma e horario do inicio.
2. Rodar `scripts/coletar_diagnostico.sh`.
3. Escolher o bloco abaixo pelo sintoma principal.
4. Aplicar somente a menor correcao segura.
5. Validar e registrar prevencao.

## A) Sem acesso SSH
Comandos no console local:

```bash
ip -br a
ip route
sudo systemctl status ssh
sudo systemctl restart ssh
```

Validacao:
- Testar `ping` e `ssh` de outra maquina.
- Se ainda falhar, verificar firewall:

```bash
sudo ufw status verbose
```

## B) Servidor lento
Comandos:

```bash
uptime
free -h
df -hT
ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%cpu | head -n 20
```

Acoes comuns:
- Reiniciar somente o servico com leak/loop.
- Limpar cache de pacotes/logs antigos com cuidado.
- Evitar reboot geral sem causa clara.

## C) Aplicacao fora do ar
Comandos:

```bash
sudo systemctl status <servico>
sudo journalctl -u <servico> -n 200 --no-pager
ss -tulpen | grep <porta>
```

Acoes comuns:
- Corrigir variavel de ambiente faltante.
- Corrigir permissao de pasta/arquivo.
- Subir novamente apenas o servico afetado.

## D) Disco cheio
Comandos:

```bash
df -hT
sudo du -h --max-depth=2 /var | sort -h | tail -n 20
sudo journalctl --disk-usage
```

Acoes comuns:
- Reduzir logs antigos.
- Limpar caches de build e pacotes.
- Remover artefatos temporarios antigos.

## E) Falha apos update
Comandos:

```bash
grep " upgrade " /var/log/dpkg.log | tail -n 50
sudo journalctl -p 3 -n 200 --no-pager
```

Acoes comuns:
- Verificar pacote/servico que quebrou apos update.
- Reaplicar configuracao do servico.
- Se necessario, voltar versao apenas do pacote afetado.

## Checklist final de fechamento
- Servico principal ativo e saudavel.
- Porta respondendo local e externamente.
- Recursos em nivel estavel (CPU, RAM, disco).
- Registro do que foi alterado e como desfazer.
