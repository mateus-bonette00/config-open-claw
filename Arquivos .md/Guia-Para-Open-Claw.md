http://192.168.0.173:9000# Guia Completo — Open Claw + Plataforma Multi-Agente

> Versao: 1.0 | Data: 2026-03-05
> Autor: Mateus Bonette
> Servidor: bonette@192.168.0.173 | Notebook: mateus@mateus-IdeaPad-3-15ALC6

---

## Indice

1. [Visao Geral](#1-visao-geral)
2. [Arquitetura do Sistema](#2-arquitetura-do-sistema)
3. [Pre-requisitos](#3-pre-requisitos)
4. [Setup Inicial — Servidor](#4-setup-inicial--servidor)
5. [Setup Inicial — Notebook](#5-setup-inicial--notebook)
6. [Conexao SSH entre Maquinas](#6-conexao-ssh-entre-maquinas)
7. [Open Claw — Conceitos Basicos](#7-open-claw--conceitos-basicos)
8. [Agente FBA Amazon (Prioridade 1)](#8-agente-fba-amazon-prioridade-1)
9. [Agente WhatsApp Lembretes](#9-agente-whatsapp-lembretes)
10. [Agente Pro-saude Social Media](#10-agente-pro-saude-social-media)
11. [Agente Moontech Prospecting](#11-agente-moontech-prospecting)
12. [Relatorio HTML FBA — Configuracao](#12-relatorio-html-fba--configuracao)
13. [Deploy e Atualizacoes](#13-deploy-e-atualizacoes)
14. [Monitoramento e Logs](#14-monitoramento-e-logs)
15. [Troubleshooting](#15-troubleshooting)
16. [Checklist de Validacao](#16-checklist-de-validacao)
17. [Glossario](#17-glossario)

---

## 1. Visao Geral

Este projeto e uma plataforma de automacao com multiplos agentes inteligentes rodando no Open Claw. O servidor desktop (192.168.0.173) executa tudo, e o notebook controla remotamente.

**Agentes disponiveis:**

| Agente | Funcao | Status |
|--------|--------|--------|
| LUCAS1 | Sourcing automatizado de produtos para venda na Amazon | Implementado |
| Varredor de Fornecedores | Dispara a automacao de varredura com indices, preco minimo/maximo e abas | Implementado |
| WhatsApp Lembretes | Lembretes agendados via WhatsApp | Implementado |
| Pro-saude Social | Criar e publicar posts no Instagram/Facebook | Implementado |
| Moontech Prospecting | Geracao de leads e CRM (HubSpot) | Implementado |

---

## 2. Arquitetura do Sistema

```
Notebook (mateus)                    Servidor (bonette@192.168.0.173)
+------------------+                +-----------------------------------+
| VSCode           |   SSH tunnel   | Open Claw Gateway :18789          |
| Claude Code      | <============> | (systemd user service)            |
| Controle remoto  |                |                                   |
+------------------+                | Agentes:                          |
                                    |   - LUCAS1 (id tecnico fba-amazon)|
                                    |   - varredor-fornecedores         |
                                    |   - whatsapp-lembretes            |
                                    |   - prosaude-social               |
                                    |   - moontech-prospecting          |
                                    |                                   |
                                    | Node v22 | Docker | Chrome        |
                                    +-----------------------------------+
```

**Portas:**
- 18789: Open Claw Gateway (loopback, acessivel via SSH tunnel)
- 8511: Neuro Desktop Dashboard (Streamlit, ja rodando)

---

## 3. Pre-requisitos

### No Servidor (ja confirmados):
- [x] Ubuntu Linux com systemd
- [x] Open Claw v2026.3.2 instalado
- [x] Node.js v22.22.0 (via ~/.local/openclaw-node22/)
- [x] Docker v29.2.1
- [x] Chrome/Chromium (para extensoes Keepa/AZInsight)
- [x] SSH ativo e chave do notebook autorizada

### No Notebook (ja confirmados):
- [x] Node.js v22.20.0
- [x] Docker Desktop
- [x] SSH key configurada
- [x] VSCode + Claude Code

### Credenciais necessarias (configurar no .env):
- [ ] WhatsApp API (Evolution API ou similar)
- [ ] Meta/Instagram Access Token (para Pro-saude)
- [ ] HubSpot API Key (para Moontech)
- [ ] VPN US (para Amazon)

---

## 4. Setup Inicial — Servidor

### 4.1 O Open Claw ja esta rodando

O Open Claw foi instalado e esta ativo como servico systemd:

```bash
# Verificar status
systemctl --user status openclaw-gateway

# O gateway esta em:
# Porta: 18789 (loopback only)
# Token: 9ee947bb94ce5d80114c2894f33a91dfeac71ccc5645b1b3
# Config: ~/.openclaw/openclaw.json
```

### 4.2 Deploy do projeto de agentes

No notebook, rode:

```bash
cd ~/Documentos/Projetos/config-open-claw
bash scripts/deploy.sh
```

Isso sincroniza todos os arquivos para o servidor em `/home/bonette/openclaw-agents/`.

### 4.3 Configurar .env no servidor

```bash
ssh bonette@192.168.0.173
cd ~/openclaw-agents
nano .env
# Preencher todas as variaveis com credenciais reais
```

### 4.4 Registrar agentes no Open Claw

```bash
# No servidor:
cd ~/openclaw-agents
bash scripts/register-agents.sh
```

---

## 5. Setup Inicial — Notebook

### 5.1 Instalar dependencias (apenas para desenvolvimento local)

```bash
cd ~/Documentos/Projetos/config-open-claw
npm install
```

### 5.2 Copiar .env.example para .env

```bash
cp .env.example .env
# Editar com suas credenciais
```

---

## 6. Conexao SSH entre Maquinas

### 6.1 Teste rapido

```bash
ssh bonette@192.168.0.173
# Deve conectar sem pedir senha (chave ja autorizada)
```

### 6.2 Tunnel para Open Claw Gateway

Para acessar o gateway do notebook:

```bash
# Modo manual (termina com Ctrl+C):
bash scripts/ssh-tunnel.sh

# Modo persistente (servico systemd):
bash scripts/ssh-tunnel-service.sh
```

Depois do tunnel, o gateway fica acessivel em `localhost:18789`.

### 6.3 Configurar SSH config (opcional, facilita uso)

Adicione em `~/.ssh/config`:

```
Host openclaw-server
  HostName 192.168.0.173
  User bonette
  IdentityFile ~/.ssh/id_ed25519
  AddressFamily inet
  LocalForward 127.0.0.1:18789 127.0.0.1:18789
  ServerAliveInterval 30
```

Depois basta: `ssh openclaw-server`

---

## 7. Open Claw — Conceitos Basicos

### O que e o Open Claw?
Plataforma para criar e gerenciar agentes de IA que executam tarefas autonomamente.

### Componentes:
- **Gateway**: Servico central que gerencia comunicacao entre agentes
- **Agente**: Programa autonomo que executa uma funcao especifica
- **Workspace**: Diretorio com arquivos de configuracao do Open Claw (~/.openclaw/workspace/)
- **Channel**: Canal de comunicacao (Telegram, WhatsApp, etc.)

### Comandos essenciais:

```bash
OPENCLAW="$(find "$HOME/.nvm/versions/node" -maxdepth 4 -path '*/bin/openclaw' 2>/dev/null | sort -V | tail -n1)"

# Listar agentes
$OPENCLAW agents list

# Adicionar agente
$OPENCLAW agents add --name "meu-agente" --description "Descricao"

# Enviar mensagem para agente
$OPENCLAW agent --name "meu-agente" --message "Faca X"

# Agendar tarefa cron
$OPENCLAW cron add --agent "meu-agente" --schedule "0 9 * * *" --message "Tarefa diaria"

# Adicionar canal (ex: Telegram)
$OPENCLAW channels add --type telegram --token "BOT_TOKEN"

# Ver logs
journalctl --user -u openclaw-gateway -f
```

---

## 8. Agente FBA Amazon (Prioridade 1)

### 8.1 O que faz

Automatiza o processo de sourcing de produtos para FBA em lote.

Fluxo completo:

1. Le um arquivo HTML (pode ter 500, 2000+ ou mais linhas) com produtos de fornecedores.
2. Extrai os dados da tabela do HTML (nome, UPC, link do fornecedor, links de busca na Amazon, etc).
3. Para cada produto:
   - abre fornecedor para validar preco real;
   - busca na Amazon por UPC e, se necessario, por titulo;
   - abre o melhor resultado (ASIN);
   - coleta dados do Keepa (historico de vendas);
   - coleta dados do AZInsight (preco, taxas, margem, ROI);
   - aplica regras de negocio para aprovar, rejeitar ou mandar para revisao.
4. Salva estado do processamento em `storage/state/fba.json` para permitir retomada.
5. Gera relatorio HTML final com os produtos aprovados em `amazon-fba/produtos-encontrados/`.

Importante sobre seu caso (HTML com 2000+ produtos):
- O agente funciona com arquivo grande.
- O processamento e feito em lotes (`FBA_BATCH_SIZE`) para ficar estavel.
- Os links da tabela do HTML original (clicaveis) sao usados na extracao dos URLs.

### 8.2 Estrutura de arquivos

```
agents/fba/
  parser.js   — Parseia o HTML de produtos
  browser.js  — Automacao do Chrome (Amazon, Keepa, AZInsight)
  rules.js    — Regras de negocio (margem, ROI, etc.)
  report.js   — Gerador do relatorio HTML formatado
  index.js    — Orquestrador principal
```

### 8.3 Regras de negocio

| Regra | Valor |
|-------|-------|
| Taxa de prep por unidade | $1.90 |
| Margem FBA minima | 10% |
| ROI minimo | 15% |
| Min. quedas BSR (Keepa) | 3 nos ultimos 30 dias |
| Rejeitar se Amazon vende | Sim |
| Preco max fornecedor | $80 |

**Formula Buy Cost:** preco_fornecedor + $1.90

**Formula Margem:** (preco_amazon - taxas_fba - buy_cost) / preco_amazon

### 8.3.1 Planejamento FBA por fases (a partir de video .mp4)

Arquivo base para mapear as fases:
`agents/fba/phase-plan.template.json`

Como usar:
1. voce grava/manda o video com audio explicando cada fase;
2. preenchemos esse arquivo com fases reais (gatilho, entrada, acao, saida e validacao);
3. depois automatizamos fase por fase com teste antes de ir para producao.

### 8.4 Como rodar

Esta secao foi escrita para quem nunca fez isso antes.

No final dela, voce vai conseguir:
1. pegar um HTML no notebook e enviar para o servidor;
2. rodar o agente FBA do inicio ao fim;
3. retomar execucao sem perder progresso;
4. baixar o relatorio HTML final no notebook.

Tempo medio da primeira vez: 40 a 90 minutos.
Nivel: iniciante.

#### 8.4.1 Fase 1 - encontrar seu HTML no notebook

Objetivo:
1. localizar o arquivo HTML que veio do fornecedor.

O que fazer:
1. No notebook, abra o app Terminal.
2. Rode:
   ```bash
   ls -lh ~/Downloads/*.html
   ```
3. Se nao estiver em `Downloads`, procure:
   ```bash
   find ~ -type f -name "*.html" | head -n 30
   ```

O que voce deve ver:
1. o nome do arquivo, por exemplo `Produtos_Fornecedor_ABC.html`.

Se der erro:
1. `No such file or directory`: o arquivo esta em outra pasta; use o `find`.

#### 8.4.2 Fase 2 - copiar o HTML do notebook para o servidor (passo que mais gera duvida)

Objetivo:
1. transferir o HTML para o desktop servidor (`192.168.0.173`).

Forma mais facil para iniciantes (recomendada):
1. Ainda no notebook, rode este comando trocando o nome do arquivo:
   ```bash
   scp "/home/mateus/Downloads/Produtos_Fornecedor_ABC.html" bonette@192.168.0.173:/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/
   ```

O que voce deve ver:
1. uma barra de progresso da copia.
2. no final, retorno ao prompt sem erro.

Como confirmar que copiou:
1. conecte no servidor e liste o arquivo:
   ```bash
   ssh bonette@192.168.0.173
   ls -lh /home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/*.html
   ```

Se der erro:
1. `Permission denied`: problema de chave SSH.
2. `No such file`: caminho do HTML no notebook esta errado.

#### 8.4.3 Fase 3 - entrar no servidor e preparar variaveis

Objetivo:
1. deixar o terminal pronto para rodar o agente.

O que fazer:
1. Entre no servidor:
   ```bash
   ssh bonette@192.168.0.173
   ```
2. Entre na pasta:
   ```bash
   cd ~/openclaw-agents
   pwd
   ```
3. Defina o Node:
   ```bash
   export NODE=~/.local/openclaw-node22/current/bin/node
   ```
4. Defina o arquivo HTML:
   ```bash
   export FBA_HTML_PATH="$HOME/openclaw-agents/amazon-fba/produtos-fornecedores-html/Produtos_Fornecedor_ABC.html"
   ```
5. Para arquivo grande (2000+), use lote menor:
   ```bash
   export FBA_BATCH_SIZE=120
   ```

O que voce deve ver:
1. `pwd` mostrando `/home/bonette/openclaw-agents`.
2. nenhum erro nos comandos `export`.

Se der erro:
1. `node: command not found`: use sempre `$NODE ...` nos comandos.

#### 8.4.4 Fase 4 - testar parser (sem abrir navegador)

Objetivo:
1. confirmar que o HTML foi lido corretamente.

O que fazer:
1. rode:
   ```bash
   $NODE agents/fba/parser.js
   ```

O que voce deve ver:
1. total de linhas do HTML;
2. total de produtos validos;
3. agrupamento por fornecedor.

Se der erro:
1. poucos produtos validos: veja secao 8.6 (linhas nao-produtivas sao puladas).

#### 8.4.5 Fase 5 - dry-run (ensaio sem abrir Amazon/fornecedor)

Objetivo:
1. testar fluxo sem navegacao real.

O que fazer:
1. rode:
   ```bash
   $NODE agents/fba/index.js --dry-run
   ```

O que voce deve ver:
1. execucao rapida;
2. criacao/atualizacao de estado em `storage/state/fba.json`.

Se der erro:
1. confirme que esta na pasta `~/openclaw-agents`.
2. confirme `FBA_HTML_PATH`.

#### 8.4.6 Fase 6 - execucao completa automatica

Objetivo:
1. processar de verdade com fornecedor + Amazon + Keepa + AZInsight.

O que fazer:
1. rode:
   ```bash
   $NODE agents/fba/index.js
   ```

O que voce deve ver:
1. logs produto por produto;
2. aprovados, rejeitados e revisao;
3. relatorio salvo em `amazon-fba/produtos-encontrados/`.

Se der erro:
1. CAPTCHA ou bloqueio: pare e use `--resume` depois.
2. travou navegador: feche Chrome e retome.

#### 8.4.7 Fase 7 - retomar de onde parou

Objetivo:
1. continuar sem perder trabalho.

O que fazer:
1. rode:
   ```bash
   $NODE agents/fba/index.js --resume
   ```

O que voce deve ver:
1. retomada do ultimo indice salvo no estado.

#### 8.4.8 Fase 8 - modo manual (quando automatico ficar instavel)

Objetivo:
1. deixar voce no controle dos casos dificeis.

O que fazer:
1. rode:
   ```bash
   $NODE agents/fba/index.js --manual
   ```

No prompt manual:
1. `Enter`: continuar.
2. `s`: pular produto.
3. `q`: encerrar.

Quando usar:
1. CAPTCHA frequente.
2. fornecedor bloqueando acesso.
3. preco do fornecedor nao encontrado automaticamente.

#### 8.4.9 Fase 9 - monitorar e baixar resultado

Objetivo:
1. acompanhar progresso e pegar o arquivo final.

O que fazer:
1. ver logs:
   ```bash
   tail -f ~/openclaw-agents/storage/logs/fba-agent.log
   ```
2. listar relatorios:
   ```bash
   ls -lh ~/openclaw-agents/amazon-fba/produtos-encontrados/fba-aprovados-*.html
   ```
3. no notebook, baixar:
   ```bash
   scp bonette@192.168.0.173:~/openclaw-agents/amazon-fba/produtos-encontrados/fba-aprovados-*.html ~/Downloads/
   ```

#### 8.4.10 Estrategia recomendada para 2000+ produtos

Ordem recomendada:
1. parser.
2. dry-run.
3. automatico com `FBA_BATCH_SIZE=120`.
4. se parar, `--resume`.
5. se persistir instavel, `--manual` apenas nos trechos problematicos.

### 8.5 Pre-requisitos do FBA

Esta secao e o checklist obrigatorio antes da execucao real.

#### 8.5.1 Pre-requisito 1 - Chrome com Keepa e AZInsight

Objetivo:
1. permitir leitura de dados de mercado.

Onde ir:
1. no servidor com tela grafica, abra Chrome.
2. acesse `chrome://extensions/`.

O que deve estar ativo:
1. Keepa.
2. AZInsight.

Cuidado importante:
1. antes de rodar o agente no terminal, feche todas as janelas do Chrome.

#### 8.5.2 Pre-requisito 2 - VPN dos EUA

Objetivo:
1. reduzir bloqueio por regiao.

Onde ir:
1. no aplicativo da sua VPN, conecte em servidor US.

Como validar:
1. abra https://ipwho.is/
2. confirme que o pais e US/United States.

No `.env`, confira:
1. `VPN_REQUIRED=true`
2. `VPN_ALLOWED_COUNTRIES=US`

#### 8.5.3 Pre-requisito 3 - pasta de exportacao com permissao

Objetivo:
1. garantir salvamento do relatorio.

Comandos:
```bash
mkdir -p ~/openclaw-agents/amazon-fba/produtos-encontrados
ls -ld ~/openclaw-agents/amazon-fba/produtos-encontrados
```

Se der permissao negada:
```bash
chmod u+rwx ~/openclaw-agents/amazon-fba/produtos-encontrados
```

### 8.6 Produtos pulados automaticamente

Esta secao explica por que "nem toda linha vira produto".

Linhas puladas de forma normal:
1. `"All Products"` ou `"All Products - Page X"`.
2. `"Sem titulo"`.
3. `"Your connection needs to be verified"`.
4. UPC vazio ou invalido.

O que esperar:
1. total de linhas do HTML maior que total de produtos validos.
2. isso e comportamento correto.

Quando investigar:
1. quando quase tudo for pulado.

Como conferir:
```bash
$NODE agents/fba/parser.js
```
Leia no resultado quantas linhas entraram e quantos produtos validos sairam.

### 8.7 Estado e resume

Esta secao e vital para lotes grandes.

Onde fica o estado:
1. `storage/state/fba.json`.

O que ele guarda:
1. ultimo produto processado.
2. resultado por produto.
3. estatisticas da execucao.

Como abrir e ler:
```bash
cat ~/openclaw-agents/storage/state/fba.json | python3 -m json.tool
```

Como retomar sem perder trabalho:
```bash
$NODE agents/fba/index.js --resume
```

Quando usar `--resume`:
1. internet caiu.
2. navegador travou.
3. CAPTCHA bloqueou.
4. voce precisou interromper manualmente.

Dica:
1. em HTML com 2000+ produtos, `--resume` faz parte do fluxo normal.

### 8.8 Iniciar tudo pela ZoeBot (sem terminal manual)

Se voce nao quiser rodar comandos manualmente, pode pedir direto para a Zoe no WhatsApp.

Comandos recomendados no chat da Zoe:

1. Iniciar com caminho completo:
   - `Zoe, iniciar FBA com html /home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/Produtos_Fornecedor.html`
2. Iniciar com nome do arquivo:
   - `Zoe, iniciar FBA com arquivo Produtos_Fornecedor.html`
3. Teste sem execucao real (dry-run):
   - `Zoe, testar FBA com html /home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html/Produtos_Fornecedor.html`
4. Retomar de onde parou:
   - `Zoe, retomar FBA`
5. Usar ultimo HTML detectado:
   - `Zoe, usar ultimo html e iniciar FBA`

Se voce enviar o `.html` no WhatsApp:
1. mande o arquivo na conversa da Zoe;
2. depois mande:
   - `Zoe, usar html anexado e iniciar FBA`

O script da Zoe:
1. copia o HTML para `amazon-fba/produtos-fornecedores-html/`;
2. define `FBA_HTML_PATH` automaticamente;
3. inicia parser + execucao conforme comando.

---

## 9. Agente WhatsApp Lembretes

### O que faz
- Agenda lembretes com data/hora
- Gerencia tarefas (criar, listar, concluir, remover)
- Agenda e envia follow-ups de tarefas
- Checklist diario automatico
- Envia via WhatsApp (Evolution API)
- Suporta recorrencia (diario, semanal, mensal)
- Retry automatico em caso de falha (3 tentativas)
- Armazena comandos e snippets (textos, prompts e comandos de terminal)

### Pre-requisitos
1. Evolution API ou similar rodando
2. Variaveis no .env: `WHATSAPP_API_URL`, `WHATSAPP_API_TOKEN`, `WHATSAPP_INSTANCE`
3. `WHATSAPP_LEMBRETES_OWNER_PHONE` para fixar o numero do Mateus
4. (Opcional) `WHATSAPP_REMINDER_DEFAULT_PHONE` para compatibilidade

### Arquivo: `agents/whatsapp-lembretes/index.js`

Teste rapido de slash command no terminal:

```bash
node scripts/whatsapp-lembretes-command.js "/comandos" --phone 553598183459
```

---

## 10. Agente Pro-saude Social Media

### O que faz
1. Recebe imagem + nome do produto (via WhatsApp)
2. Remove fundo da imagem (rembg ou remove.bg)
3. Compoe no template da marca
4. (Opcional) Aguarda aprovacao manual
5. Publica no Instagram e Facebook

### Pre-requisitos
1. rembg instalado (`pip install rembg`) ou REMOVEBG_API_KEY
2. Meta Graph API tokens (META_ACCESS_TOKEN, META_PAGE_ID, INSTAGRAM_ACCOUNT_ID)
3. Templates de imagem em `config/prosaude-templates/`

### Arquivo: `agents/prosaude-social/index.js`

---

## 11. Agente Moontech Prospecting

### O que faz
- Gerencia leads (nome, email, empresa, fonte)
- Pipeline: new → contacted → qualified → proposal → negotiation → won/lost
- Sincroniza com HubSpot CRM
- Controles de compliance (limites diarios, horarios, opt-out)

### Pre-requisitos
1. HubSpot API Key (HUBSPOT_API_KEY)
2. WhatsApp API para outreach

### Arquivo: `agents/moontech-prospecting/index.js`

---

## 12. Relatorio HTML FBA — Configuracao

O agente FBA salva os aprovados em um arquivo `.html` organizado em tabela.

### Formato aplicado da tabela

- Largura de cada coluna: **225px**
- Altura de cada linha: **65px**
- Texto centralizado na horizontal e vertical
- Borda em todas as celulas
- Linha 1 (cabecalho) com preenchimento **laranja**
- Quebra de linha habilitada em cabecalho e celulas

### Colunas do relatorio

1. Indice
2. Produto
3. Fornecedor
4. Link Fornecedor
5. Titulo Amazon
6. ASIN
7. Link Amazon
8. UPC
9. Preco Fornecedor ($)
10. Preco Amazon ($)
11. Buy Cost ($)
12. FBA Fees ($)
13. Margem (%)
14. ROI (%)
15. Lucro ($)
16. Quedas BSR (30d)
17. Origem Preco Fornecedor

### Onde o arquivo e salvo

- Pasta: `amazon-fba/produtos-encontrados/`
- Nome: `fba-aprovados-AAAA-MM-DDTHH-MM-SS.html`

### Como abrir no servidor

```bash
cd ~/openclaw-agents
ls -lh amazon-fba/produtos-encontrados/fba-aprovados-*.html
```

### Como baixar para o notebook

```bash
scp bonette@192.168.0.173:~/openclaw-agents/amazon-fba/produtos-encontrados/fba-aprovados-*.html ~/Downloads/
```

---

## 13. Deploy e Atualizacoes

### Deploy inicial
```bash
cd ~/Documentos/Projetos/config-open-claw
bash scripts/deploy.sh
```

### Atualizar apos mudancas
```bash
# Mesmo comando — rsync sincroniza apenas o que mudou
bash scripts/deploy.sh
```

### Deploy com Docker (alternativa)
```bash
# No servidor:
cd ~/openclaw-agents
docker compose up -d
```

---

## 14. Monitoramento e Logs

### Logs dos agentes
```bash
# No servidor:
tail -f ~/openclaw-agents/storage/logs/fba-agent.log
tail -f ~/openclaw-agents/storage/logs/errors.log

# Todos os logs:
ls ~/openclaw-agents/storage/logs/
```

### Logs do Open Claw Gateway
```bash
journalctl --user -u openclaw-gateway -f
```

### Estado dos agentes
```bash
cat ~/openclaw-agents/storage/state/fba.json | python3 -m json.tool
```

---

## 15. Troubleshooting

### "Arquivo HTML nao encontrado"
- Copie o HTML para o servidor: `scp Produtos_*.html bonette@192.168.0.173:~/openclaw-agents/amazon-fba/produtos-fornecedores-html/`
- Ou defina `FBA_HTML_PATH` no .env

### "CAPTCHA detectado na Amazon"
- O agente salva screenshot em `storage/screenshots/`
- Em `--manual`, resolva no Chrome do servidor e pressione Enter no terminal
- Em modo automatico, use `--resume` depois de resolver o bloqueio

### "CAPTCHA ou bloqueio no fornecedor"
- O agente tambem tenta abrir a pagina real do fornecedor para extrair o preco
- Em `--manual`, resolva o bloqueio no navegador e continue no terminal
- Se o preco nao for encontrado, voce pode informar manualmente em USD

### "Chrome nao abre"
- Feche todas as instancias do Chrome no servidor primeiro
- Verifique se DISPLAY esta configurado (necessario para modo nao-headless)
- Para rodar via SSH, configure X forwarding ou use VNC

### "Keepa/AZInsight nao carregam"
- Verifique se as extensoes estao instaladas no Chrome do servidor
- O Chrome deve usar o perfil real (Default)
- As extensoes precisam de render real (headless=false)

### "VPN US nao validada"
- Verifique se a VPN dos EUA esta conectada antes de iniciar o agente
- Confira `VPN_REQUIRED`, `VPN_ALLOWED_COUNTRIES` e `VPN_CHECK_URL` no `.env`
- Se alguns fornecedores nao abrirem, quase sempre e IP/regiao

### "SSH tunnel nao conecta"
- Verifique se o servidor esta ligado: `ping 192.168.0.173`
- Verifique a chave SSH: `ssh -v bonette@192.168.0.173`
- Verifique se a porta 18789 esta ativa no servidor: `ssh bonette@192.168.0.173 "ss -tlnp | grep 18789"`

### "node: command not found" no servidor
- O Node do Open Claw esta em `~/.local/openclaw-node22/current/bin/node`
- Adicione ao PATH: `export PATH="$HOME/.local/openclaw-node22/current/bin:$PATH"`
- Ou edite ~/.bashrc para persistir

### "openclaw: command not found" no servidor
- Descubra o binario: `OPENCLAW="$(find "$HOME/.nvm/versions/node" -maxdepth 4 -path '*/bin/openclaw' 2>/dev/null | sort -V | tail -n1)"`
- Garanta `node` no PATH da mesma versao: `export PATH="$(dirname "$OPENCLAW"):$PATH"`
- Use o comando pelo caminho completo: `$OPENCLAW agents list`

### "Relatorio HTML nao gerado"
- Verifique permissao de escrita em `amazon-fba/produtos-encontrados/`
- Verifique se ha produtos aprovados na execucao
- Verifique erros do agente em `storage/logs/fba-agent.log`

---

## 16. Checklist de Validacao

### Infraestrutura
- [ ] SSH do notebook para servidor funciona sem senha
- [ ] SSH tunnel ativo (localhost:18789 acessivel)
- [ ] Open Claw gateway rodando (systemctl --user status openclaw-gateway)
- [ ] Node.js disponivel no servidor
- [ ] Docker disponivel no servidor

### Agente FBA
- [ ] Parser roda sem erros: `node agents/fba/parser.js`
- [ ] Dry-run funciona: `node agents/fba/index.js --dry-run`
- [ ] Chrome abre com extensoes Keepa/AZInsight
- [ ] VPN US ativa
- [ ] Relatorio HTML gerado em `amazon-fba/produtos-encontrados/`
- [ ] Modo resume funciona: `--resume`

### Credenciais
- [ ] .env preenchido no servidor
- [ ] WhatsApp API acessivel (se usando lembretes)
- [ ] Meta API tokens validos (se usando Pro-saude)
- [ ] HubSpot API key valida (se usando Moontech)

---

## 17. Glossario

| Termo | Significado |
|-------|-------------|
| **ASIN** | Amazon Standard Identification Number — ID unico de produto na Amazon |
| **UPC** | Universal Product Code — codigo de barras (12 ou 13 digitos) |
| **BSR** | Best Sellers Rank — ranking de vendas na Amazon |
| **FBA** | Fulfillment by Amazon — Amazon armazena e envia seus produtos |
| **Keepa** | Extensao Chrome que mostra historico de precos e vendas na Amazon |
| **AZInsight** | Extensao Chrome que calcula lucro/margem FBA |
| **Buy Cost** | Custo total de aquisicao = preco fornecedor + $1.90 (prep) |
| **ROI** | Return on Investment = lucro / custo |
| **Margem** | Percentual de lucro sobre o preco de venda |
| **Open Claw** | Plataforma de agentes IA usada neste projeto |
| **Gateway** | Servico central do Open Claw que gerencia agentes |
| **Evolution API** | API open-source para WhatsApp |
| **rembg** | Ferramenta Python para remocao de fundo de imagens |
