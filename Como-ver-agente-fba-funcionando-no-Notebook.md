# Como Ver o Agente FBA (LUCAS1) Funcionando no Notebook (Guia Completo)

## 0) O que esta faltando para dar 100% certo (bem direto)
1. **Prints:** ja esta OK (o painel mostra e os arquivos sao gerados no servidor).
2. **Calcular lucro de verdade:** precisa do **AZInsight/AsinZen logado** no Chrome do servidor.
   - Se aparecer no painel/log: `AZInsight respondeu unauthorized`, significa **nao esta logado** (ou o login expirou).

## 1) O que este guia cobre (rapido)
1. Este guia e do agente FBA do OpenClaw:
`fba-amazon` (nome que voce fala: `LUCAS1`).
2. O agente roda no servidor (desktop):
`/home/bonette/openclaw-agents`
3. Onde ficam os arquivos:
- Entrada HTML: `/home/bonette/Documentos/fornecedores-produtos`
- Processados (feitos): `/home/bonette/Documentos/fornecedores-produtos/feitos`
- Relatorios: `/home/bonette/Documentos/produtos-amazon-lucros`
- Prints: `/home/bonette/openclaw-agents/storage/audit/fba/<sessao>/` e `/home/bonette/openclaw-agents/storage/screenshots`
4. Onde voce ve tudo ao vivo (no notebook):
`http://127.0.0.1:3456`

## 2) Pre-requisitos (1 vez so)

### Passo 1: confirmar SSH do notebook para o servidor
1. No notebook, abra o Terminal.
2. Rode:
`ssh openclaw-server`
3. Se abriu um terminal do servidor, esta OK. Digite `exit` para voltar.

### Passo 2: confirmar que voce esta no repo certo no notebook
1. No notebook, rode:
`cd /home/mateus/Documentos/Projetos/config-open-claw`
2. Confira o arquivo:
`ls -la Como-ver-agente-fba-funcionando-no-Notebook.md`

### Passo 3: instalar Xvfb no servidor (obrigatorio para Chrome visual)
Por que isso existe:
- O LUCAS1 precisa rodar o Chrome em modo visual para ficar mais estavel.
- Sem Xvfb o Chrome pode falhar e o agente para.

1. Entre no servidor:
`ssh openclaw-server`
2. Rode (vai pedir sua senha):
`sudo apt-get update`
`sudo apt-get install -y xvfb x11-utils`
3. Confirme:
`command -v Xvfb && echo "OK: Xvfb instalado"`
4. Saia:
`exit`

### Passo 4: garantir que o Chrome do servidor tem as extensoes logadas (AZInsight/ASINZen + Keepa)
Por que isso existe:
- O agente usa o perfil real do Chrome do servidor.
- Ele NAO faz login sozinho.
- Ele espera ate **27 segundos** pelo AZInsight aparecer na pagina (nao e 15s).

1. No servidor, abra o Chrome (perfil `Qota` / `Default`).
2. Abra a pagina de extensoes:
`chrome://extensions/`
3. Confira:
- Keepa = instalado e ativado
- AZInsight (AsinZen) = instalado e ativado
4. Agora teste o AZInsight em uma pagina da Amazon:
`https://www.amazon.com/dp/B004VV8790`
5. Se aparecer uma tela do AZInsight pedindo `Email` e `senha`:
- faca login
- depois atualize a pagina (F5) e confirme que o AZInsight passa a mostrar numeros (taxas/ROI/etc)
6. Feche o Chrome.
7. Pronto: o agente vai reutilizar esse login.

Exemplo simples:
- Se a extensao nao estiver logada, o painel vai mostrar "AZInsight nao carregou" ou dados vazios.

## 3) Rotina diaria completa (do inicio ao fim)

### Passo 1: colocar o HTML na pasta de entrada (no servidor)
1. O arquivo `.html` precisa estar em:
`/home/bonette/Documentos/fornecedores-produtos`
2. Nao coloque dentro de `feitos`.
3. Exemplo:
`Produtos_Acumulados_31_03_2026_151223.html`
4. Para conferir sem entrar no servidor manualmente:
`ssh openclaw-server "ls -lh /home/bonette/Documentos/fornecedores-produtos/*.html 2>/dev/null || echo 'Sem HTML na entrada'"`

### Passo 2: abrir o dashboard no notebook (1 comando)
1. No notebook, abra o Terminal.
2. Rode:
`cd /home/mateus/Documentos/Projetos/config-open-claw`
3. Rode:
`bash scripts/monitor-lucas1-notebook.sh`
4. O que esse comando faz:
- valida SSH
- garante o dashboard rodando no servidor
- cria o tunnel para o notebook
- abre o navegador no dashboard
5. Se nao abrir sozinho, abra voce no navegador:
`http://127.0.0.1:3456`

### Passo 3: iniciar a execucao (escolha 1 jeito)

Opcao A (recomendado): pelo dashboard
1. Abra:
`http://127.0.0.1:3456`
2. Clique no botao `Iniciar`.
3. Pronto.

Opcao B: pela Zoe no WhatsApp
1. Abra o WhatsApp.
2. Envie:
`/lucas1-iniciar`
ou
`Zoe, inicia o LUCAS1`

Opcao C: pelo terminal (SSH)
1. Rode no notebook:
`ssh openclaw-server "cd /home/bonette/openclaw-agents && bash scripts/lucas1-control.sh start"`

### Passo 4: acompanhar tudo, print por print (no dashboard)
1. No dashboard `http://127.0.0.1:3456`, acompanhe:
- `Timeline e Prints da Execucao`
- `Galeria de Prints`
- `Log Consolidado`
2. Clique no print para abrir grande.

O minimo que voce deve ver quando nao tiver bloqueio:
- Abrindo fornecedor
- Fornecedor carregado com preco
- Busca Amazon por UPC e/ou titulo
- Resultado da busca
- Abrindo produto na Amazon
- Analise final e resultado

### Passo 5: parar, retomar e limpar (quando der algo errado)

Parar / Pausar
1. Clique `Parar / Pausar`.
2. Ele para de forma segura.

Retomar
1. Clique `Retomar`.
2. Continua do ultimo produto.

Limpar execucao (reset real)
1. Clique `Limpar Execucao`.
2. Isso zera:
- estado da execucao
- resultados
- logs visiveis
3. Depois clique `Iniciar` de novo.

Exemplo simples:
- Viu erro? Clique `Parar / Pausar`, depois `Limpar Execucao`, e rode do zero.

### Passo 6: validar que finalizou certo
1. O HTML vai para:
`/home/bonette/Documentos/fornecedores-produtos/feitos`
2. Os relatorios saem em:
`/home/bonette/Documentos/produtos-amazon-lucros`
3. Para conferir por comando:
`ssh openclaw-server "ls -lh /home/bonette/Documentos/fornecedores-produtos/feitos | tail -n 8"`
`ssh openclaw-server "ls -lh /home/bonette/Documentos/produtos-amazon-lucros | tail -n 8"`

## 4) Onde ficam os prints (e como ver)

### No dashboard
1. `Timeline e Prints da Execucao`
2. `Galeria de Prints`

### No servidor (arquivos)
1. Auditoria por sessao:
`/home/bonette/openclaw-agents/storage/audit/fba/<sessao>/events.ndjson`
2. Imagens:
`/home/bonette/openclaw-agents/storage/screenshots`

Exemplo de comando:
`ssh openclaw-server "find /home/bonette/openclaw-agents/storage/screenshots -type f | tail -n 20"`

## 5) Comandos de controle rapido (no notebook)
1. Ver status do monitor/tunnel:
`bash scripts/monitor-lucas1-notebook.sh status`
2. Reiniciar monitor/tunnel:
`bash scripts/monitor-lucas1-notebook.sh restart`
3. Parar monitor/tunnel:
`bash scripts/monitor-lucas1-notebook.sh stop`

## 6) Erros comuns e como corrigir

### Erro A: nao conecta no servidor
1. Teste:
`ssh openclaw-server`
2. Se falhar, corrija seu SSH antes de continuar.

### Erro B: porta 3456 ocupada no notebook
1. Rode:
`OPENCLAW_LOCAL_DASHBOARD_PORT=3460 bash scripts/monitor-lucas1-notebook.sh`
2. Abra:
`http://127.0.0.1:3460`

### Erro C: dashboard nao sobe no servidor
1. Veja o log:
`ssh openclaw-server "tail -n 120 /home/bonette/openclaw-agents/storage/logs/fba-dashboard.log"`
2. Rode o monitor de novo:
`bash scripts/monitor-lucas1-notebook.sh`

### Erro D: "Nenhum HTML valido encontrado"
1. Significa: nao tem `.html` em `/home/bonette/Documentos/fornecedores-produtos`.
2. Confira:
`ssh openclaw-server "ls -lh /home/bonette/Documentos/fornecedores-produtos/*.html 2>/dev/null || echo 'Sem HTML na entrada'"`
3. Coloque o HTML e clique `Iniciar` de novo.

### Erro E: Xvfb nao encontrado (Chrome visual)
1. Instale:
`ssh openclaw-server`
`sudo apt-get update`
`sudo apt-get install -y xvfb x11-utils`
2. Volte no dashboard e clique `Iniciar`.

### Erro F: captcha / recaptcha
1. Isso vem do site do fornecedor ou da Amazon.
2. O painel vai mostrar o print do captcha.
3. Voce pode:
- clicar `Parar / Pausar`
- clicar `Limpar Execucao`
- rodar novamente depois (as vezes o bloqueio passa)

### Erro G: AZInsight pediu login (unauthorized)
Sinal no log / dashboard:
- aparece algo como `AZInsight respondeu unauthorized` ou `AZInsight pediu login`

O que fazer:
1. No servidor, abra o Chrome (perfil Qota).
2. Abra esta pagina:
`https://www.amazon.com/dp/B004VV8790`
3. Clique na extensao `AZInsight` (AsinZen) e faça login dentro dela.
4. Atualize a pagina (F5) e confirme que o AZInsight mostra numeros (taxas/ROI/etc).
5. Feche o Chrome.
6. Volte no dashboard e rode de novo (`Limpar Execucao` -> `Iniciar`).

### Erro H: dashboard com tela antiga (nao aparece timeline/galeria)
1. Atualize o servidor:
`cd /home/mateus/Documentos/Projetos/config-open-claw`
`bash scripts/deploy-live.sh`
2. Rode o monitor de novo:
`bash scripts/monitor-lucas1-notebook.sh`
3. Abra:
`http://127.0.0.1:3456`

## 7) Checklist final (rapido)
1. Tem HTML em `/home/bonette/Documentos/fornecedores-produtos`.
2. Xvfb instalado no servidor.
3. Extensoes logadas no Chrome do servidor.
4. Dashboard abriu em `http://127.0.0.1:3456`.
5. Voce clicou `Iniciar`.
6. Timeline e Galeria mostram prints.
7. No fim, HTML foi para `feitos` e saiu relatorio em `produtos-amazon-lucros`.
