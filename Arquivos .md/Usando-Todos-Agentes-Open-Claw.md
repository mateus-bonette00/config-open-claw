# Usando Todos os Agentes Open Claw (Guia Completo + Explicacao de Cada Comando)

> Projeto: `openclaw-agents`  
> Servidor: `bonette@192.168.0.173`  
> Pasta do projeto no servidor: `/home/bonette/openclaw-agents`  
> Workspace da ZoeBot: `/home/bonette/.openclaw/workspace`

---

## 1) Objetivo deste guia

Este arquivo agora funciona como um manual completo de referencia.

Voce vai encontrar:

1. O que cada agente faz.
2. Cada comando de terminal com explicacao detalhada.
3. Cada parametro (`--alguma-coisa`) explicado.
4. O que escrever para a ZoeBot.
5. O que esperar de resultado em cada operacao.
6. Erros comuns e como corrigir.

---

## 2) Mapa rapido dos agentes

Pasta `agents/`:

1. `agents/fba/index.js` -> Motor do agente Open Claw `LUCAS1` (id tecnico `fba-amazon`)
2. `agents/varredor-fornecedores/index.js` -> Agente que inicia a automacao `varrer-fornecedores`
3. `agents/moontech-prospecting/index.js` -> Agente comercial Moontech (pipeline/prospeccao)
4. `agents/prosaude-social/index.js` -> Agente de arte/post para Pro-saude
5. `agents/whatsapp-lembretes/index.js` -> Agente unificado de lembretes + tarefas + follow-up

---

## 3) Como ler os comandos deste guia

Quando aparecer `SEU_ARQUIVO.html`, significa que voce deve trocar pelo nome real.

Exemplo:

- comando no guia: `--html "SEU_ARQUIVO.html"`
- comando real: `--html "Produtos_Mateus_22_02_2026_141622.html"`

Quando aparecer `$NODE`, significa o caminho do Node configurado no passo 4.

---

## 4) Preparacao rapida (sempre antes de operar)

No servidor:

```bash
cd /home/bonette/openclaw-agents
export NODE=~/.local/openclaw-node22/current/bin/node
```

### O que cada linha faz

1. `cd /home/bonette/openclaw-agents`
- `cd` = "change directory" (mudar pasta no terminal).
- Serve para garantir que todos os comandos vao rodar dentro da pasta correta do projeto.

2. `export NODE=~/.local/openclaw-node22/current/bin/node`
- `export` cria uma variavel de ambiente para a sessao atual do terminal.
- Aqui voce cria a variavel `NODE` apontando para o executavel Node certo.
- Isso evita erro de versao errada do Node.

Para confirmar:

```bash
$NODE -v
```

### O que esse comando faz

- Executa o Node configurado na variavel `NODE`.
- `-v` mostra a versao.
- Se mostrar `v22.x.x`, esta correto para este projeto.

---

## 5) Agente FBA Amazon (o principal)

## 5.1 O que ele faz

1. Le arquivo HTML com produtos de fornecedores.
2. Tenta achar o produto correspondente na Amazon.
3. Analisa sinais de vendas (Keepa) e margem (AZInsight).
4. Aplica regras de aprovacao/rejeicao.
5. Gera relatorio HTML final com os produtos aprovados.

### Pastas importantes do FBA

- Entrada de HTML (fornecedores):
`/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/`

- Saida de aprovados:
`/home/bonette/openclaw-agents/amazon-fba/produtos-encontrados/`

- Logs:
`/home/bonette/openclaw-agents/storage/logs/fba-agent.log`

- Estado (resume):
`/home/bonette/openclaw-agents/storage/state/fba.json`

### Plano por fases (para video .mp4)

- Template de fases:
`agents/fba/phase-plan.template.json`
- Uso:
1. voce grava/enviara o video com audio explicando as fases;
2. esse template vira a base para transformar o video em automacao fase a fase;
3. cada fase vai receber gatilho, entrada, acao, saida e checklist de validacao.

### 5.1.1 Transferencia de arquivos FBA (Notebook <-> Servidor)

Todos os comandos abaixo devem ser rodados no **notebook**.

#### A) Enviar HTML da pasta Mateus para o servidor

```bash
scp -i ~/.ssh/id_ed25519 "/home/mateus/Documentos/Qota Store/ARQUIVOS HTML/Mateus/"*.html bonette@192.168.0.173:/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/
```

#### B) Enviar HTML da pasta Daniel para o servidor

```bash
scp -i ~/.ssh/id_ed25519 "/home/mateus/Documentos/Qota Store/ARQUIVOS HTML/Daniel/"*.html bonette@192.168.0.173:/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/
```

#### C) (Opcional) Enviar as duas pastas em sequencia (Mateus + Daniel)

```bash
scp -i ~/.ssh/id_ed25519 "/home/mateus/Documentos/Qota Store/ARQUIVOS HTML/Mateus/"*.html bonette@192.168.0.173:/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/ && \
scp -i ~/.ssh/id_ed25519 "/home/mateus/Documentos/Qota Store/ARQUIVOS HTML/Daniel/"*.html bonette@192.168.0.173:/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/
```

#### D) Puxar para o notebook os HTML de aprovados gerados no servidor

Primeiro, criar a pasta de destino no notebook (se ainda nao existir):

```bash
mkdir -p "/home/mateus/Documentos/Qota Store/Produtos Encontrados pela Zoe"
```

Depois, copiar os arquivos:

```bash
scp -i ~/.ssh/id_ed25519 bonette@192.168.0.173:/home/bonette/openclaw-agents/amazon-fba/produtos-encontrados/*.html "/home/mateus/Documentos/Qota Store/Produtos Encontrados pela Zoe/"
```

#### E) Conferir no servidor se os HTML chegaram

```bash
ssh -i ~/.ssh/id_ed25519 bonette@192.168.0.173 'ls -lh /home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/*.html | tail -n 20'
```

#### F) Conferir no notebook se os aprovados foram baixados

```bash
ls -lh "/home/mateus/Documentos/Qota Store/Produtos Encontrados pela Zoe/"*.html
```

#### Erro comum: `No such file or directory`

- Causa mais comum: caminho com espaco sem aspas.
- Solucao: manter o caminho entre aspas exatamente como nos comandos acima.

## 5.2 Comandos de terminal do FBA (explicados)

### 5.2.1 Validar parser (sem navegador)

```bash
$NODE agents/fba/parser.js "/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/SEU_ARQUIVO.html"
```

### Para que serve

- Testar se o HTML foi lido corretamente.
- Nao abre Chrome.
- Nao faz busca real na Amazon.

### O que cada parte faz

- `$NODE`: usa o Node correto.
- `agents/fba/parser.js`: script que extrai dados do HTML.
- `"/caminho/arquivo.html"`: arquivo de entrada que sera lido.

### Quando usar

- Sempre antes de rodar processamento completo.
- Especialmente em arquivo grande (2000+ produtos).

---

### 5.2.2 Dry-run (ensaio sem execucao real)

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-fba-from-html.sh \
  --html "SEU_ARQUIVO.html" \
  --mode dry-run \
  --batch-size 120
```

### Para que serve

- Simular fluxo sem execucao completa.
- Bom para validar configuracao antes do modo real.

### O que cada parametro faz

- `--html "SEU_ARQUIVO.html"`
  - Informa qual HTML usar.
  - Pode ser nome do arquivo (se ja estiver na pasta padrao) ou caminho completo.

- `--mode dry-run`
  - Define o tipo de execucao.
  - `dry-run` = teste/simulacao.

- `--batch-size 120`
  - Tamanho do lote por ciclo.
  - `120` ajuda estabilidade em arquivos grandes.

---

### 5.2.3 Execucao automatica (real)

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-fba-from-html.sh \
  --html "SEU_ARQUIVO.html" \
  --mode auto \
  --batch-size 120
```

### Para que serve

- Executar processamento real fim a fim.
- Gera relatorio final na pasta de saida.
- Antes de iniciar, tenta ligar VPN automaticamente (se `VPN_REQUIRED=true` e `FBA_AUTO_VPN=true`).

### Diferenca para dry-run

- `--mode auto` realmente processa os produtos para aprovacao/rejeicao.

---

### 5.2.4 Retomar de onde parou

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-fba-from-html.sh --mode resume
```

### Para que serve

- Continuar processamento interrompido.
- Usa o estado salvo em `storage/state/fba.json`.

### Quando usar

- Queda de internet.
- CAPTCHA/bloqueio.
- Travamento de navegador.
- Parada manual no meio do lote.

### 5.2.4.1 Rodar sem auto-VPN (somente se voce quiser forcar manual)

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-fba-from-html.sh \
  --html "SEU_ARQUIVO.html" \
  --mode auto \
  --batch-size 120 \
  --no-auto-vpn
```

---

### 5.2.5 Modo manual (controle humano)

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-fba-from-html.sh \
  --html "SEU_ARQUIVO.html" \
  --mode manual \
  --batch-size 120
```

### Para que serve

- Dar controle manual em etapas sensiveis.
- Bom quando existe bloqueio frequente/captcha.

### O que muda no modo manual

- Pede confirmacao em momentos importantes.
- Voce pode intervir antes de continuar.

---

### 5.2.6 Acompanhar execucao e resultado

```bash
tail -f /home/bonette/openclaw-agents/storage/logs/fba-agent.log
ls -lh /home/bonette/openclaw-agents/amazon-fba/produtos-encontrados/
```

### O que cada comando faz

1. `tail -f ...fba-agent.log`
- Mostra log em tempo real.
- `-f` = "follow" (fica acompanhando novas linhas).

2. `ls -lh .../produtos-encontrados/`
- Lista os arquivos gerados.
- `-l` = lista detalhada.
- `-h` = tamanho legivel (KB, MB).

### 5.2.7 Auditoria completa (prova do processo)

Se voce quer validar se o agente realmente abriu links, buscou na Amazon e tomou decisao correta por produto:

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-fba-from-html.sh \
  --html "SEU_ARQUIVO.html" \
  --mode auto \
  --batch-size 120 \
  --audit
```

Para auditoria com screenshots de etapas (mais pesado):

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-fba-from-html.sh \
  --html "SEU_ARQUIVO.html" \
  --mode auto \
  --batch-size 120 \
  --audit-screenshots
```

Arquivos de auditoria ficam em:
`/home/bonette/openclaw-agents/storage/audit/fba/<sessao>/`

Dentro da sessao voce tera:
- `meta.json` (dados gerais da sessao)
- `events.ndjson` (evento por evento, por produto)
- screenshots (se `--audit-screenshots`)

Exemplo para inspecionar os ultimos eventos:

```bash
LATEST_AUDIT="$(ssh -i ~/.ssh/id_ed25519 bonette@192.168.0.173 'ls -dt /home/bonette/openclaw-agents/storage/audit/fba/* 2>/dev/null | head -n1')"
ssh -i ~/.ssh/id_ed25519 bonette@192.168.0.173 "tail -n 40 \"$LATEST_AUDIT/events.ndjson\""
```

## 5.3 Modos do FBA resumidos

- `dry-run`: teste/simulacao
- `auto`: execucao automatica real
- `resume`: retomar do estado salvo
- `manual`: execucao assistida por voce

## 5.4 O que mandar para ZoeBot (FBA)

### Frases validas

1. `Zoe, iniciar FBA com arquivo SEU_ARQUIVO.html`
2. `Zoe, iniciar FBA com html /home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/SEU_ARQUIVO.html`
3. `Zoe, testar FBA com arquivo SEU_ARQUIVO.html`
4. `Zoe, retomar FBA`
5. `Zoe, usar ultimo html e iniciar FBA`
6. `Zoe, iniciar FBA com arquivo SEU_ARQUIVO.html em modo manual`

### O que cada frase faz internamente

- "iniciar FBA" -> roda script `run-fba-from-html.sh` em `--mode auto`
- "testar FBA" -> roda em `--mode dry-run`
- "retomar FBA" -> roda com `--mode resume`
- "modo manual" -> roda com `--mode manual`

### Comportamento de resposta esperado da Zoe no FBA

1. Ao receber comando `iniciar FBA`, responder primeiro:
`AU AU TUDO BEM CHEFE, AGENTE FBA INICIADO`
2. Nao mandar parcial no meio da execucao.
3. Mandar apenas uma resposta final quando encerrar (sucesso ou erro).

---

## 6) Agente Moontech (Outreach comercial)

## 6.1 O que ele faz

1. Pega contatos/leads do HubSpot.
2. Monta envio comercial por e-mail (Zoho).
3. Monta envio comercial por WhatsApp (Evolution API).
4. Permite dry-run (sem disparo real) e commit (disparo real).

## 6.2 Comandos de terminal Moontech (explicados)

### 6.2.1 Dry-run completo (e-mail + WhatsApp)

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-moontech-outreach.sh \
  --limit 10 \
  --send-email \
  --send-whatsapp
```

### Para que serve

- Simular envio em 10 contatos sem enviar de verdade.

### O que cada parametro faz

- `--limit 10`: quantidade maxima de leads processados.
- `--send-email`: inclui canal e-mail no fluxo.
- `--send-whatsapp`: inclui canal WhatsApp no fluxo.
- Sem `--commit`: nao dispara real.

---

### 6.2.2 Envio real (com confirmacao forte)

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-moontech-outreach.sh \
  --limit 10 \
  --send-email \
  --send-whatsapp \
  --commit \
  --confirm-send "ENVIAR AGORA"
```

### Para que serve

- Disparo real para os canais selecionados.

### O que cada parametro extra faz

- `--commit`: habilita envio real.
- `--confirm-send "ENVIAR AGORA"`: frase de seguranca para evitar disparo acidental.

---

### 6.2.3 Apenas WhatsApp (dry-run)

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-moontech-outreach.sh \
  --limit 10 \
  --send-whatsapp
```

### Para que serve

- Testar apenas o canal WhatsApp, sem envio real.

---

### 6.2.4 Apenas e-mail (dry-run)

```bash
bash /home/bonette/.openclaw/workspace/scripts/run-moontech-outreach.sh \
  --limit 10 \
  --send-email
```

### Para que serve

- Testar apenas o canal e-mail, sem envio real.

---

### 6.2.5 Upsert de empresa no HubSpot

```bash
node /home/bonette/.openclaw/workspace/hubspot-upsert.js \
  "Nome da Empresa" \
  "https://site.com.br" \
  "Segmento" \
  "+55 11 99999-9999" \
  "Cidade, UF" \
  "Descricao curta + links"
```

### Para que serve

- Criar ou atualizar empresa no HubSpot.
- "upsert" = se existe, atualiza; se nao existe, cria.

### O que cada argumento representa

1. Nome da empresa
2. Site
3. Segmento
4. Telefone
5. Cidade/UF
6. Descricao/notas

## 6.3 O que mandar para ZoeBot (Moontech)

1. `Zoe, teste contatos`
2. `Zoe, teste contatos 20`
3. `Zoe, teste whatsapp`
4. `Zoe, teste email`
5. `Zoe, enviar mensagens`
6. `CONFIRMO ENVIO` (somente quando quiser envio real)

### Regra de seguranca importante

- Nunca comece com envio real.
- Sempre: dry-run -> revisar resumo -> confirmar envio.

---

## 7) Agente Pro-saude Social

## 7.1 O que ele faz

1. Recebe dados de produto (nome, imagem, texto).
2. Monta arte em template de rede social.
3. Prepara saida para publicacao.

### Regra atual no seu ambiente

- Remocao automatica de fundo esta desativada.
- Entao, quando necessario, envie a imagem ja sem fundo.

## 7.2 Comando tecnico de start

```bash
$NODE agents/prosaude-social/index.js
```

### O que faz

- Inicia o agente de social no terminal.

## 7.3 O que mandar para ZoeBot (Pro-saude)

1. `Zoe, criar arte Pro-saude com este produto: NOME_DO_PRODUTO`
2. `Zoe, usar template Pro-saude padrao com a imagem anexada`
3. `Zoe, gerar arte para redes sociais da Pro-saude com legenda pronta`
4. `Zoe, a imagem ja esta sem fundo, so encaixar no template`

---

## 8) Agente WhatsApp Lembretes + Tarefas (unificado)

## 8.1 O que ele faz

1. Agenda lembretes com data/hora.
2. Gerencia tarefas (criar, listar, concluir, remover).
3. Mantem checklist diario.
4. Agenda e envia follow-ups de tarefas por WhatsApp.
5. Processa fila de lembretes periodicamente.
6. Envia via API WhatsApp configurada.
7. Armazena comandos e snippets (textos, prompts e comandos de terminal).

## 8.2 Comando tecnico de start

```bash
$NODE agents/whatsapp-lembretes/index.js
```

### O que faz

- Inicia o scheduler unificado (lembretes + tarefas + follow-up).

Comando tecnico para testar os slash commands:

```bash
$NODE scripts/whatsapp-lembretes-command.js "/comandos" --phone 553598183459
```

## 8.3 O que mandar para ZoeBot (Lembretes)

1. `Zoe, criar lembrete para hoje as 17:30: enviar relatorio`
2. `Zoe, agendar lembrete diario as 08:00 para revisar tarefas`
3. `Zoe, listar meus lembretes de hoje`
4. `Zoe, cancelar lembrete ID rem-XXXX`
5. `Zoe, criar tarefa: revisar anuncios Amazon ate 18:00`
6. `Zoe, listar tarefas pendentes`
7. `Zoe, marcar tarefa task-XXXX como concluida`
8. `Zoe, criar follow-up da tarefa task-XXXX para hoje as 16:30`
9. `Zoe, /comandos`
10. `Zoe, salvar comando NOME: bash script.sh --opcao X`
11. `Zoe, mostrar comando NOME`
12. `Zoe, apagar comando NOME`
13. `Zoe, salvar texto NOME: meu texto aqui`
14. `Zoe, listar textos`
15. `Zoe, mostrar texto NOME`
16. `Zoe, apagar texto NOME`

---

## 9) Agente Moontech Prospecting (base CRM)

## 9.1 O que ele faz

1. Pesquisa e organiza potenciais empresas.
2. Ajuda classificacao de fit comercial.
3. Suporta resumo de pipeline.

## 9.2 Comando tecnico de start

```bash
$NODE agents/moontech-prospecting/index.js
```

### O que faz

- Inicia rotina/base do agente de prospeccao.

## 9.3 O que mandar para ZoeBot

1. `Zoe, buscar 10 empresas com perfil para o produto Apolo`
2. `Zoe, salvar esses leads no HubSpot`
3. `Zoe, gerar resumo do pipeline da Moontech`

---

## 10) Comandos de administracao (Open Claw)

## 10.1 Registrar agentes

```bash
cd /home/bonette/openclaw-agents
bash scripts/register-agents.sh
```

### O que faz

- Registra os 4 agentes principais no Open Claw gateway.
- Se agente ja existir, mantem e segue.

## 10.2 Ver logs importantes

```bash
tail -f /home/bonette/openclaw-agents/storage/logs/fba-agent.log
journalctl --user -u openclaw-gateway -f
```

### O que cada um faz

1. `tail -f ...fba-agent.log`
- Mostra log do FBA em tempo real.

2. `journalctl --user -u openclaw-gateway -f`
- Mostra log do servico gateway no Linux.
- `--user` = servico de usuario.
- `-u openclaw-gateway` = unidade especifica.
- `-f` = seguir ao vivo.

## 11.3 Deploy do notebook para o servidor

```bash
cd /home/mateus/Documentos/Projetos/config-open-claw
bash scripts/deploy.sh
```

### O que faz

- Envia/publica alteracoes do notebook para o servidor conforme seu script.

---

## 12) Frases curtas recomendadas para falar com a Zoe

1. `Zoe, testar contatos`
2. `Zoe, enviar mensagens`
3. `Zoe, iniciar FBA com arquivo X.html`
4. `Zoe, retomar FBA`
5. `Zoe, criar arte Pro-saude com imagem anexada`
6. `Zoe, criar lembrete para hoje as 18:00`
7. `Zoe, listar tarefas pendentes`

### O que esperar como resposta da Zoe

- Resumo do que ela executou.
- Quantos itens processou.
- Quais falharam e por que.
- Proximo passo recomendado.

---

## 13) Checklist rapido por operacao

### 13.1 FBA

1. HTML dentro de `amazon-fba/produtos-fornecedores-html/`
2. VPN US ativa no servidor
3. Chrome do servidor preparado (Keepa + AZInsight)
4. Rodar `dry-run` primeiro
5. Rodar `auto` e acompanhar log

### 13.2 Moontech envio comercial

1. HubSpot configurado
2. Zoho SMTP configurado
3. WhatsApp instance correta
4. Dry-run primeiro
5. Envio real so com confirmacao

### 13.3 Pro-saude

1. Imagem correta do produto
2. Se necessario, imagem ja sem fundo
3. Template correto
4. Revisar arte final

---

## 14) Glossario simples (sem termos dificeis)

- `dry-run`: simulacao, sem efeito real externo.
- `commit`: envio/acao real.
- `upsert`: criar ou atualizar.
- `batch`: lote de itens por execucao.
- `resume`: continuar de onde parou.
- `scheduler`: rotina que roda automaticamente por horario.
- `log`: historico textual do que o sistema fez.

---

## 15) Dica final para evitar erro operacional

Para qualquer envio externo (WhatsApp/e-mail), siga sempre:

1. rodar teste (`dry-run`),
2. revisar resumo,
3. confirmar envio real (`commit`).

Assim voce evita disparo acidental e mantem controle total.
