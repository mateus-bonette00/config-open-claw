# Bonette - o deploy e com isso

Data: 2026-03-06

Este arquivo explica os comandos novos de deploy e quando usar cada um.

## Comandos principais

### 1) `npm run deploy:live`

Quando usar:
- Sempre que voce fizer mudanca no codigo no notebook e quiser colocar no ar no desktop (servidor).

O que ele faz:
1. Roda `scripts/deploy.sh`:
   - testa SSH;
   - sincroniza arquivos para o servidor;
   - instala dependencias (`npm install --omit=dev`) no servidor.
2. No servidor:
   - se existir `docker-compose.yml`, roda `docker compose up -d --build`;
   - se existir `openclaw-gateway.service`, reinicia o gateway.
3. Faz validacao rapida de containers e status do gateway.

Comando:

```bash
cd ~/Documentos/Projetos/config-open-claw
npm run deploy:live
```

### 2) `npm run autodeploy:disable`

Quando usar:
- Uma vez, para desativar deploy automatico recorrente no servidor (`autodeploy-all.timer`).
- Pode rodar de novo se esse timer for reativado por engano.

O que ele faz:
- `disable --now` no `autodeploy-all.timer`;
- mascara o timer para evitar reativacao acidental.

Comando:

```bash
cd ~/Documentos/Projetos/config-open-claw
npm run autodeploy:disable
```

## Fluxo diario recomendado

1. Editar codigo no notebook.
2. Rodar:

```bash
npm run deploy:live
```

3. Validar servico no servidor:

```bash
ssh bonette@192.168.0.173 'docker ps --format "table {{.Names}}\t{{.Status}}"'
ssh bonette@192.168.0.173 'systemctl --user is-active openclaw-gateway'
```

## Usar `npm run deploy:live` em todos os repositorios

Para esse comando funcionar em qualquer repo, esse repo precisa ter:
- `scripts/deploy.sh`
- `scripts/deploy-live.sh`
- script no `package.json` chamado `deploy:live`

### Padrao de variaveis (reaproveitavel)

Os scripts suportam estas variaveis:
- `OPENCLAW_USER` (padrao: `bonette`)
- `OPENCLAW_SERVER` (padrao: `192.168.0.173`)
- `OPENCLAW_SERVER_DIR` (destino remoto do repo)
- `SSH_KEY_PATH` (chave SSH)
- `DEPLOY_SERVICE` (opcional: sobe so 1 servico do compose)

### Setup rapido por repo

No repo novo (no notebook):

```bash
cd /caminho/do/repo
mkdir -p scripts
cp ~/Documentos/Projetos/config-open-claw/scripts/deploy.sh scripts/
cp ~/Documentos/Projetos/config-open-claw/scripts/deploy-live.sh scripts/
chmod +x scripts/deploy.sh scripts/deploy-live.sh
```

Adicionar no `package.json` desse repo:

```json
{
  "scripts": {
    "deploy": "bash scripts/deploy.sh",
    "deploy:live": "bash scripts/deploy-live.sh"
  }
}
```

Criar um arquivo `.deploy.env` nesse repo:

```bash
OPENCLAW_USER=bonette
OPENCLAW_SERVER=192.168.0.173
OPENCLAW_SERVER_DIR=/home/bonette/Documentos/apps/NOME_DO_REPO
SSH_KEY_PATH=/home/mateus/.ssh/id_ed25519
# DEPLOY_SERVICE=api
```

Rodar com variaveis carregadas:

```bash
set -a
source ./.deploy.env
set +a
npm run deploy:live
```

## Checklist rapido

- Timer automatico desligado:

```bash
ssh bonette@192.168.0.173 'systemctl --user is-enabled autodeploy-all.timer; systemctl --user is-active autodeploy-all.timer'
```

Esperado: `disabled` e `inactive`.

- Deploy manual funcionando:

```bash
npm run deploy:live
```

Se concluir sem erro, mudanca esta aplicada no servidor.

## Regra operacional fixa (UI grafica)

Sempre avisar antes quando uma tarefa exigir interface grafica no servidor, incluindo:
- Chrome headful;
- extensoes de navegador;
- leitura/scan de QR visual;
- qualquer fluxo que dependa de `display-manager`/`graphical.target`.

Se o fluxo for compativel com servidor em terminal (`multi-user.target`), informar explicitamente que roda sem UI.
