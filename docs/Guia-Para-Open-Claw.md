# Guia Completo — Open Claw + Plataforma Multi-Agente

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
12. [Google Sheets — Configuracao](#12-google-sheets--configuracao)
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
- [ ] Google Sheets Service Account (para FBA)
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

Automatiza o processo de sourcing de produtos para FBA:

1. Le arquivo HTML com 502+ produtos de fornecedores
2. Para cada produto:
   - Busca na Amazon por UPC e titulo
   - Analisa com Keepa (historico de vendas)
   - Analisa com AZInsight (margens de lucro)
   - Aplica regras de negocio
3. Registra produtos aprovados no Google Sheets

### 8.2 Estrutura de arquivos

```
agents/fba/
  parser.js   — Parseia o HTML de produtos
  browser.js  — Automacao do Chrome (Amazon, Keepa, AZInsight)
  rules.js    — Regras de negocio (margem, ROI, etc.)
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

```bash
# 1. Testar o parser (nao precisa browser):
~/.local/openclaw-node22/current/bin/node agents/fba/parser.js

# 2. Rodar em modo dry-run (sem browser):
~/.local/openclaw-node22/current/bin/node agents/fba/index.js --dry-run

# 3. Rodar completo (usa VPN US + abre fornecedor + Amazon + Keepa + AZInsight):
~/.local/openclaw-node22/current/bin/node agents/fba/index.js

# 4. Retomar de onde parou:
~/.local/openclaw-node22/current/bin/node agents/fba/index.js --resume

# 5. Modo manual (human-in-the-loop):
~/.local/openclaw-node22/current/bin/node agents/fba/index.js --manual
```

Observacoes do modo manual:
- Pede confirmacao antes de abrir fornecedor, buscar Amazon e abrir o ASIN
- Permite resolver CAPTCHA ou desafio anti-bot no navegador e continuar
- Permite informar o preco do fornecedor manualmente quando a extracao automatica falhar

### 8.5 Pre-requisitos do FBA

1. **Chrome com Keepa e AZInsight instalados** no servidor
   - Instalar extensoes no Chrome do servidor (bonette)
   - O agente usa o perfil real do Chrome
   - Chrome deve estar FECHADO antes de rodar o agente

2. **VPN US ativa** (Amazon US e alguns fornecedores exigem IP americano)
   - O agente valida se o IP atual esta nos EUA antes de iniciar
   - Configure no `.env`: `VPN_REQUIRED=true`, `VPN_ALLOWED_COUNTRIES=US`

3. **Google Sheets configurado** (ver secao 13)

### 8.6 Produtos pulados automaticamente

O parser ignora linhas que nao sao produtos reais:
- "All Products" ou "All Products – Page X" (paginas de colecao)
- "Sem titulo"
- "Your connection needs to be verified" (erros de captcha)
- UPC vazio ou invalido (mas ainda busca por titulo)

### 8.7 Estado e resume

O agente salva seu progresso em `storage/state/fba.json`:
- Ultimo produto processado
- Resultado de cada produto (aprovado/rejeitado/erro)
- Estatisticas gerais

Se o agente parar (erro, captcha, etc.), rode com `--resume` para continuar de onde parou.

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

## 12. Google Sheets — Configuracao

O agente FBA salva produtos aprovados numa planilha Google Sheets.

### Passo a passo:

1. **Criar projeto no Google Cloud Console:**
   - Acesse https://console.cloud.google.com/
   - Crie um novo projeto (ou use existente)
   - Ative a "Google Sheets API"

2. **Criar Service Account:**
   - IAM & Admin → Service Accounts → Create
   - Nome: "openclaw-sheets"
   - Crie uma chave JSON
   - Baixe o arquivo JSON

3. **Colocar credenciais no projeto:**
   ```bash
   # Copie o JSON baixado para:
   cp ~/Downloads/credenciais.json config/google-credentials.json
   ```

4. **Criar planilha e compartilhar:**
   - Crie uma nova planilha no Google Sheets
   - Compartilhe com o email do Service Account (esta no JSON, campo "client_email")
   - Copie o ID da planilha (parte da URL: docs.google.com/spreadsheets/d/**ID_AQUI**/edit)

5. **Configurar no .env:**
   ```
   GOOGLE_SHEETS_CREDENTIALS_PATH=./config/google-credentials.json
   GOOGLE_SHEETS_SPREADSHEET_ID=cole_o_id_aqui
   GOOGLE_SHEETS_SHEET_NAME=Produtos Aprovados
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
- Copie o HTML para o servidor: `scp Produtos_*.html bonette@192.168.0.173:~/openclaw-agents/`
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

### "Google Sheets erro de autenticacao"
- Verifique se o Service Account tem acesso a planilha (compartilhamento)
- Verifique se o arquivo de credenciais existe em config/google-credentials.json
- Verifique se a Google Sheets API esta ativada no projeto

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
- [ ] Google Sheets configurado e acessivel
- [ ] Modo resume funciona: `--resume`

### Credenciais
- [ ] .env preenchido no servidor
- [ ] Google Sheets credentials JSON presente
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
| **Service Account** | Conta de servico Google para acesso automatizado a APIs |
