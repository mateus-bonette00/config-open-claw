# Explicacao das Skills (config-open-claw)

## 1. O que e uma skill (em 1 frase)
Skill e um guia pequeno que diz ao Codex como trabalhar em um tipo de tarefa, com foco, limites e exemplos.

## 2. Como saber se a skill esta funcionando no Codex
1. Abra o painel do Codex no VS Code.
2. Clique na engrenagem (Codex Settings).
3. Clique em `Skills`.
4. Veja se a skill aparece em `Installed`.
5. Se nao aparecer:
6. Volte em `Configuration`.
7. Em `Import external agent config`, marque `Skills`.
8. Clique em `Apply selected`.
9. Reinicie o Codex.
10. Teste rapido: no prompt, digite `$` e veja se a skill aparece.

## 3. Como usar uma skill (passo simples)
1. No prompt do Codex, digite `$`.
2. Selecione a skill.
3. Diga o objetivo em 1 frase.
4. Diga quais arquivos o Codex deve ler (1 ou 2).
5. Peça resposta curta e objetiva.

## 4. Skills do projeto (explicacao simples e completa)

### 4.1 `openclaw-config-zoe-agents`
1. Para que serve: skill principal para qualquer pedido dentro do projeto, com foco em organizacao, estrutura e operacao dos agentes.
2. Quando usar: quando a tarefa nao tem uma skill especifica ou envolve o projeto inteiro.
3. Quando nao usar: quando ja existe uma skill mais especifica para o problema.
4. Exemplo: `Use $openclaw-config-zoe-agents. Revisar estrutura de um agente novo e padronizar com o core.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-config-zoe-agents/SKILL.md`

### 4.2 `openclaw-token-budget`
1. Para que serve: reduzir gasto de tokens em tarefas simples e rapidas.
2. Quando usar: ajuste pequeno, duvida curta, leitura de 1 ou 2 arquivos.
3. Quando nao usar: refatoracao grande, investigacao longa.
4. Exemplo: `Use $openclaw-token-budget. Objetivo: entender erro no deploy lendo scripts/deploy.sh.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-token-budget/SKILL.md`

### 4.3 `openclaw-safe-edit`
1. Para que serve: fazer mudanca pequena e segura sem quebrar o fluxo.
2. Quando usar: correcao pontual, mensagem de erro, ajuste de validacao.
3. Quando nao usar: refatoracao ampla ou troca de arquitetura.
4. Exemplo: `Use $openclaw-safe-edit. Ajuste minimo em agents/whatsapp-lembretes/index.js.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-safe-edit/SKILL.md`

### 4.4 `openclaw-mcp-playwright`
1. Para que serve: usar navegador para validar pagina, botao ou texto.
2. Quando usar: precisa abrir um site e confirmar algo na tela.
3. Quando nao usar: edicao de codigo local sem UI.
4. Exemplo: `Use $openclaw-mcp-playwright. Abra um site e confirme o titulo.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-mcp-playwright/SKILL.md`

### 4.5 `openclaw-fba-pipeline-ops`
1. Para que serve: operar o fluxo FBA completo (parse, browser, regras, relatorio).
2. Quando usar: erro no FBA, problema em resume/manual/dry-run, ajuste de regra.
3. Quando nao usar: tarefas fora do FBA.
4. Exemplo: `Use $openclaw-fba-pipeline-ops. Investigue falha no modo resume do FBA.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-fba-pipeline-ops/SKILL.md`

### 4.6 `openclaw-whatsapp-lembretes-ops`
1. Para que serve: operar lembretes, tarefas e follow-ups do WhatsApp.
2. Quando usar: erro em comandos, lembrete nao envia, telefone nao autorizado.
3. Quando nao usar: tarefas sem WhatsApp.
4. Exemplo: `Use $openclaw-whatsapp-lembretes-ops. Corrigir erro ao criar lembrete.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-whatsapp-lembretes-ops/SKILL.md`

### 4.7 `openclaw-varredor-fornecedores-ops`
1. Para que serve: validar parametros e iniciar varredura com seguranca.
2. Quando usar: erro ao iniciar varredura, faixa invalida, comando externo falha.
3. Quando nao usar: tarefas sem varredor.
4. Exemplo: `Use $openclaw-varredor-fornecedores-ops. Validar dry-run de 1 a 50.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-varredor-fornecedores-ops/SKILL.md`

### 4.8 `openclaw-deploy-live-ops`
1. Para que serve: deploy remoto com install, rebuild e validacao final.
2. Quando usar: deploy, falha de SSH, falha de Docker/gateway.
3. Quando nao usar: tarefas sem deploy.
4. Exemplo: `Use $openclaw-deploy-live-ops. Revisar deploy-live e checklist final.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-deploy-live-ops/SKILL.md`

### 4.9 `openclaw-google-sheets-ops`
1. Para que serve: integrar Google Sheets (credenciais, headers, append).
2. Quando usar: erro de credencial, planilha vazia, append falhando.
3. Quando nao usar: tarefas sem planilha.
4. Exemplo: `Use $openclaw-google-sheets-ops. Investigar erro de credenciais.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-google-sheets-ops/SKILL.md`

### 4.10 `openclaw-gateway-tunnel-ops`
1. Para que serve: criar e corrigir tunnel SSH para gateway.
2. Quando usar: tunnel cai, porta errada, service nao sobe.
3. Quando nao usar: tarefas sem tunnel.
4. Exemplo: `Use $openclaw-gateway-tunnel-ops. Diagnosticar queda de tunnel.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-gateway-tunnel-ops/SKILL.md`

### 4.11 `openclaw-state-log-troubleshoot`
1. Para que serve: diagnosticar falhas usando logs e estado.
2. Quando usar: agente travou, erros repetidos, resultado inconsistente.
3. Quando nao usar: tarefa nova sem historico.
4. Exemplo: `Use $openclaw-state-log-troubleshoot. Investigar por que o agente fba parou.`
5. Arquivo: `/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills/openclaw-state-log-troubleshoot/SKILL.md`
