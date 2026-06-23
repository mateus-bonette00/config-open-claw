# GUIA_CODEX_EXTENSION

## 1. Tela Configuration (Codex Settings)
1. Com a tela `Codex Settings` aberta, fique na secao `Configuration`.
2. Para abrir o arquivo de configuracao, clique em `Open config.toml`.
3. Para ver licencas, clique em `View` em `Open source licenses`.
4. Para importar skills externas, use `Import external agent config`.
5. Marque `Skills`.
6. Confira os caminhos mostrados na tela:
7. Origem: `/home/mateus/.claude/skills`.
8. Destino: `/home/mateus/.agents/skills`.
9. Clique em `Apply selected`.
10. Reinicie o Codex para aplicar.
11. Link oficial sobre config:
```
https://developers.openai.com/codex/config-basic
```

## 2. Tela config.toml (Imagem Do Arquivo)
1. No arquivo aberto, confirme as linhas iguais a imagem:
2. `model = "gpt-5.2-codex"`.
3. `model_reasoning_effort = "xhigh"`.
4. `personality = "pragmatic"`.
5. Bloco MCP Playwright:
6. `[mcp_servers.playwright]` com `command = "npx"` e `args = ["@playwright/mcp@latest"]`.
7. Bloco `[features]` com `multi_agent = true`.
8. Para economizar tokens, mude `model_reasoning_effort` para `high` ou `medium` em tarefas simples.
9. Para manter qualidade em tarefas complexas, volte para `xhigh`.
10. Salve o arquivo.
11. Reinicie o Codex.
12. Link oficial do config:
```
https://developers.openai.com/codex/config-basic
```

## 3. IDE Settings (Menu Pequeno)
1. No painel do Codex, clique no menu e abra `IDE settings`.
2. Ajuste as opcoes da imagem:
3. `Open on startup`.
4. `Queue follow-ups`.
5. `^ + enter to send long prompts`.
6. `Fix TODO comments`.
7. `Open settings`.
8. Recomendacao para economizar tokens:
9. Mantenha `Queue follow-ups` ligado.
10. Use `^ + enter to send long prompts` para evitar envio acidental.
11. Desative `Fix TODO comments` se voce nao usa TODOs.
12. Para ver todas as configuracoes, clique em `Open settings`.

## 4. VS Code Settings Da Extensao (Tela Settings)
1. Abra `Settings` no VS Code.
2. No campo de busca, digite `@ext:openai.chatgpt`.
3. Ajuste as opcoes mostradas nas imagens:
4. `Chatgpt: Cli Executable`.
5. `Chatgpt: Comment Code Lens Enabled`.
6. `Chatgpt: Composer Enter Behavior`.
7. `Chatgpt: Follow Up Queue Mode`.
8. `Chatgpt: Locale Override`.
9. `Chatgpt: Open On Startup`.
10. `Chatgpt: Run Codex In Windows Subsystem For Linux`.
11. Recomendacao simples:
12. Deixe `Cli Executable` vazio se nao usa o CLI.
13. Mantenha `Follow Up Queue Mode` em `queue`.
14. Use `Locale Override` so se quiser forcar idioma.
15. `Run Codex In WSL` so faz sentido em Windows.
16. Link oficial das settings:
```
https://developers.openai.com/codex/ide/settings
```

## 5. Skills (Tela Skills - Installed)
1. Abra `Codex Settings`.
2. Clique em `Skills`.
3. Na area `Installed`, voce tem:
4. `Codex Skill Author`.
5. `OpenAI Docs`.
6. `OpenClaw Config Zoe Agents`.
7. `Personal Project Orchestrator`.
8. `Project Specific Delivery`.
9. `Skill Creator`.
10. `Skill Installer`.
11. Para usar uma skill, no prompt digite `$` e escolha a skill.
12. Ou use `/skills` para abrir o seletor.
13. Para este projeto, a skill principal e `OpenClaw Config Zoe Agents`.
14. Link oficial de skills:
```
https://developers.openai.com/codex/skills
```

## 6. Skills (Tela Skills - Recommended)
1. Na area `Recommended`, voce ve varias skills com o botao `+`.
2. Instale apenas o que voce realmente usa.
3. Para instalar uma, clique no `+` ao lado do nome.
4. Aguarde aparecer em `Installed`.
5. Se nao aparecer, reinicie o Codex.
6. Para este projeto, a maioria das skills recomendadas nao e necessaria.
7. Exemplo de skills que so valem se voce usa no dia a dia:
8. `Linear`, `Notion`, `Figma`, `Sentry`.

## 7. Criar Skill Nova (Para Economizar Tokens)
1. Na tela `Skills`, clique em `New skill`.
2. Diga um nome simples.
3. Crie a pasta em `.agents/skills/<nome-da-skill>`.
4. Crie o arquivo `SKILL.md` dentro da pasta.
5. Exemplo simples:
```
---
name: openclaw-deploy-checklist
description: Checklist de deploy seguro para o repo config-open-claw.
---

1. Leia apenas scripts/deploy.sh e scripts/deploy-live.sh.
2. Gere checklist de pre, durante e pos deploy em 10 passos.
3. Liste 3 erros comuns e como evitar.
```
6. Reinicie o Codex se a skill nao aparecer.
7. Link oficial:
```
https://developers.openai.com/codex/skills
```

## 8. Onde O Codex Procura Skills
1. O Codex procura skills em pastas de repo e de usuario.
2. Para repo, use `.agents/skills`.
3. Para usuario, use `~/.agents/skills`.
4. O Codex aceita pastas com symlink.
5. Link oficial:
```
https://developers.openai.com/codex/skills
```

## 9. Desativar Uma Skill Sem Apagar
1. Abra `~/.codex/config.toml`.
2. Adicione:
```
[[skills.config]]
path = "/caminho/para/skill/SKILL.md"
enabled = false
```
3. Salve e reinicie o Codex.
4. Link oficial:
```
https://developers.openai.com/codex/skills
```

## 10. MCP Servers (Tela MCP Servers)
1. Abra `Codex Settings`.
2. Clique em `MCP servers`.
3. Voce vera `Custom servers` e `Recommended servers`.
4. Para adicionar servidor custom, clique em `Add server`.
5. Para instalar recomendado, clique em `Install`.
6. Na sua tela aparecem recomendados:
7. `Linear`, `Notion`, `Figma`, `Playwright`.
8. Ligue o toggle apenas do MCP que voce vai usar.
9. Para economizar tokens, desligue o que nao usa.
10. Link oficial:
```
https://developers.openai.com/codex/mcp
```

## 11. MCP Via config.toml (Avancado)
1. Abra `~/.codex/config.toml`.
2. Exemplo oficial:
```
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.context7.env]
MY_ENV_VAR = "MY_ENV_VALUE"
```
3. Salve.
4. Reinicie o Codex.
5. Link oficial:
```
https://developers.openai.com/codex/mcp
```

## 12. Como Saber Se O MCP Esta Ativo
1. Volte para `MCP servers`.
2. Veja se o toggle esta ligado.
3. Rode uma tarefa que dependa do MCP.
4. Se nao funcionar, revise o `config.toml`.

## 13. Passo A Passo Para Economizar Tokens
1. Escreva o objetivo em 1 linha.
2. Limite a leitura a 1 ou 2 arquivos.
3. Defina o formato da resposta (ex.: 5 passos curtos).
4. Use skills para tarefas repetidas.
5. Mantenha `model_reasoning_effort` em `high` ou `medium` em tarefas simples.
6. Desligue MCP que voce nao usa.
7. Evite logs grandes e HTMLs gigantes.

## 14. Checklist Final
1. `Objetivo definido?`
2. `Arquivos limitados?`
3. `Formato de resposta definido?`
4. `Skill certa escolhida?`
5. `MCP ligado apenas se precisar?`
6. `Effort adequado para o tamanho da tarefa?`

## 15. Links Das Ferramentas Citadas Nas Telas
1. VS Code:
```
https://code.visualstudio.com/
```
2. Playwright:
```
https://playwright.dev/
```
3. Linear:
```
https://linear.app/
```
4. Notion:
```
https://www.notion.so/
```
5. Figma:
```
https://www.figma.com/
```
6. Sentry:
```
https://sentry.io/
```

## 16. Links Oficiais Usados
1. Config basica do Codex:
```
https://developers.openai.com/codex/config-basic
```
2. MCP do Codex:
```
https://developers.openai.com/codex/mcp
```
3. Skills do Codex:
```
https://developers.openai.com/codex/skills
```
4. Settings do Codex IDE extension:
```
https://developers.openai.com/codex/ide/settings
```

## 17. Guia Completo Ponta A Ponta (config-open-claw)

### 17.1 Passo 1 - Preparar O Codex Para O Projeto
1. No VS Code, abra a pasta `config-open-claw`.
2. Abra o painel do Codex.
3. Clique no icone de engrenagem no canto superior direito.
4. Clique em `Configuration`.
5. Em `Import external agent config`, marque `Skills`.
6. Clique em `Apply selected`.
7. Reinicie o Codex.
8. Resultado esperado:
9. As skills importadas aparecem na tela `Skills`.

### 17.2 Passo 2 - Ajustar Config Para Economizar Tokens
1. Ainda no `Codex Settings`, clique em `Open config.toml`.
2. No arquivo aberto, troque:
3. `model_reasoning_effort = "xhigh"`
4. Para:
5. `model_reasoning_effort = "high"`
6. Quando usar `xhigh`:
7. Apenas em tarefa dificil (bug complexo, arquitetura, investigacao longa).
8. Quando usar `high`:
9. Tarefas normais de manutencao e edicao.
10. Quando usar `medium`:
11. Tarefas pequenas e repetitivas.
12. Salve o arquivo e reinicie o Codex.
13. Resultado esperado:
14. Menor gasto de tokens na maioria das tarefas.

### 17.3 Passo 3 - Ajustar IDE Settings (Do Jeito Mais Eficiente)
1. No painel do Codex, abra `IDE settings`.
2. Configure assim:
3. `Queue follow-ups`: ligado.
4. `^ + enter to send long prompts`: ligado.
5. `Open on startup`: opcional.
6. `Fix TODO comments`: desligado se voce nao usa TODO com frequencia.
7. Clique em `Open settings`.
8. Em `@ext:openai.chatgpt`, confirme:
9. `Chatgpt: Follow Up Queue Mode = queue`.
10. `Chatgpt: Composer Enter Behavior = enter` ou o modo que evita envio acidental para voce.
11. `Chatgpt: Cli Executable`: vazio.
12. Resultado esperado:
13. Menos retrabalho, menos envio acidental, melhor controle do fluxo.

### 17.4 Passo 4 - Criar Arquivos Que Ajudam Este Projeto (Skills Completas)
1. No Explorer do VS Code, clique com botao direito na raiz do projeto.
2. Clique em `New Folder` e crie `.agents`.
3. Dentro de `.agents`, crie a pasta `skills`.
4. Dentro de `skills`, crie estas 3 pastas:
5. `.agents/skills/openclaw-token-budget`
6. `.agents/skills/openclaw-safe-edit`
7. `.agents/skills/openclaw-mcp-playwright`
8. Em cada pasta, crie o arquivo `SKILL.md`.
9. Copie e cole exatamente o conteudo abaixo em cada arquivo.

10. Conteudo para `.agents/skills/openclaw-token-budget/SKILL.md`:
```md
---
name: openclaw-token-budget
description: Use para reduzir consumo de tokens em tarefas do projeto config-open-claw sem perder qualidade tecnica. Ideal para diagnostico rapido, ajustes pequenos, leitura controlada e respostas objetivas.
---

# OpenClaw Token Budget

## Objetivo
Entregar resultado util com baixo custo de contexto e baixo retrabalho.

## Quando Usar
- Tarefas de manutencao rapida.
- Ajustes pequenos em 1 ou 2 arquivos.
- Duvidas objetivas sobre um fluxo especifico.
- Revisao curta de comando de script.

## Quando Nao Usar
- Refatoracao grande.
- Investigacao longa com muitos modulos.
- Mudanca arquitetural.
- Auditoria completa de seguranca.

## Escopo Prioritario Do Projeto
Priorizar leitura nesta ordem:
1. `package.json` (scripts oficiais).
2. `agents/<agente>/index.js` do fluxo alvo.
3. `core/logger.js`, `core/state.js`, `core/secrets.js`, `core/scheduler.js`.
4. `scripts/*.sh` relacionados ao pedido.
5. `integrations/*` apenas se houver integracao envolvida.

Evitar leitura de pastas grandes sem necessidade:
- `node_modules`, `dist`, `build`, `coverage`, `logs`, `data`, `backups`, `storage` inteiro.

## Fluxo Obrigatorio
1. Reescrever o objetivo em 1 frase simples.
2. Listar no maximo 2 arquivos para abrir primeiro.
3. Ler somente esses arquivos.
4. Entregar diagnostico curto com:
   - Fato confirmado.
   - Risco principal.
   - Acao minima recomendada.
5. Se faltar contexto, pedir liberacao de no maximo +2 arquivos e explicar por que.
6. Quando editar, fazer mudanca minima e localizada.
7. Sugerir validacao local curta (1 ou 2 comandos).
8. Finalizar com proximo passo unico e objetivo.

## Limites De Resposta
- Maximo 8 passos.
- Frases curtas.
- Sem repetir contexto ja conhecido.
- Sem listar alternativas demais quando uma ja resolve.

## Formato De Saida Recomendado
1. Objetivo.
2. Arquivos lidos.
3. Diagnostico.
4. Ajuste sugerido/aplicado.
5. Como validar.
6. Proximo passo.

## Regras De Seguranca
- Nunca expor segredo real.
- Sempre mascarar token/chave (`***`).
- Nao sugerir comando destrutivo sem confirmacao.

## Exemplos De Prompt
- `Use $openclaw-token-budget. Objetivo: corrigir falha no deploy. Leia apenas scripts/deploy.sh e package.json. Responda em 6 passos.`
- `Use $openclaw-token-budget. Objetivo: ajustar mensagem de erro no agente WhatsApp. Leia somente agents/whatsapp-lembretes/index.js e core/logger.js.`
- `Use $openclaw-token-budget. Objetivo: validar script de tunnel. Leia apenas scripts/ssh-tunnel.sh e scripts/deploy-live.sh.`
```

11. Conteudo para `.agents/skills/openclaw-safe-edit/SKILL.md`:
```md
---
name: openclaw-safe-edit
description: Use para alteracoes seguras e minimas no projeto config-open-claw, preservando comandos, contratos e estabilidade operacional.
---

# OpenClaw Safe Edit

## Objetivo
Aplicar mudanca pequena, clara e com baixo risco de regressao.

## Quando Usar
- Correcao pontual em arquivo especifico.
- Ajuste de mensagem de erro.
- Pequena melhoria de validacao.
- Ajuste de script operacional sem mudar o fluxo inteiro.

## Quando Nao Usar
- Refatoracao ampla de varios modulos.
- Mudanca de arquitetura.
- Reescrita completa de agente.

## Regras Principais
1. Alterar somente os arquivos pedidos.
2. Nao renomear comandos existentes no `package.json` sem necessidade.
3. Nao quebrar interface publica de scripts usados em producao.
4. Nao remover logs essenciais de operacao.
5. Preservar compatibilidade com estado atual (`core/state.js`, `storage/state/*`).

## Checklist Antes De Editar
1. Confirmar arquivo alvo.
2. Confirmar comportamento atual esperado.
3. Identificar risco da mudanca.
4. Definir validacao minima.

## Fluxo Obrigatorio De Edicao
1. Ler arquivo alvo por completo.
2. Identificar trecho exato da alteracao.
3. Fazer mudanca minima necessaria.
4. Evitar efeitos colaterais em outros modulos.
5. Validar sintaxe/comando basico.
6. Entregar diff com explicacao simples.

## Validacao Minima Recomendada
Use de acordo com o tipo de arquivo alterado:
- Arquivo `.js`:
  - `node --check <arquivo.js>`
- Script `.sh`:
  - `bash -n <arquivo.sh>`
- Fluxo com npm script:
  - `npm run <script_relacionado>`

## Formato De Entrega
1. O que foi alterado.
2. Por que foi alterado.
3. Arquivos tocados.
4. Como validar localmente.
5. Risco residual (se houver).

## Regras De Seguranca
- Nunca vazar segredo em log ou resposta.
- Nunca usar comando destrutivo sem autorizacao.
- Nunca apagar arquivo de estado sem necessidade real.

## Exemplos De Prompt
- `Use $openclaw-safe-edit. Ajuste minimo em agents/whatsapp-lembretes/index.js para tratar erro 401 sem alterar outros arquivos.`
- `Use $openclaw-safe-edit. Corrija validacao de entrada em agents/varredor-fornecedores/index.js. Mudanca minima, sem refactor amplo.`
- `Use $openclaw-safe-edit. Corrija script scripts/run-fba-from-html.sh sem mudar assinatura dos parametros.`
```

12. Conteudo para `.agents/skills/openclaw-mcp-playwright/SKILL.md`:
```md
---
name: openclaw-mcp-playwright
description: Use quando precisar validar pagina web, elemento de interface ou fluxo visual com MCP Playwright de forma objetiva e com baixo custo.
---

# OpenClaw MCP Playwright

## Objetivo
Usar navegador automatizado apenas quando a tarefa realmente depende de verificacao visual/web.

## Quando Usar
- Confirmar titulo de pagina.
- Verificar se botao/campo/texto existe.
- Testar fluxo curto de clique e resposta visual.
- Coletar evidencia de UI para validar correcoes.

## Quando Nao Usar
- Edicao de codigo local sem interface web.
- Analise de backend sem tela.
- Tarefas resolvidas apenas com leitura de arquivo.

## Pre-Checklist Obrigatorio
1. Confirmar necessidade real de navegador.
2. Confirmar URL alvo.
3. Definir no maximo 3 verificacoes objetivas.
4. Garantir que MCP Playwright esta ligado.

## Fluxo Padrao De Execucao
1. Abrir URL.
2. Esperar carregamento basico.
3. Rodar verificacoes objetivas (titulo, botao, texto, status).
4. Registrar resultado de cada verificacao como `OK` ou `FALHOU`.
5. Se falhar, indicar exatamente onde falhou.
6. Entregar proximo passo pratico.

## Limites De Escopo
- Evitar navegacao longa sem necessidade.
- Nao testar mais de 1 fluxo por vez.
- Evitar print/screenshot excessivo quando texto ja comprova.

## Formato De Resposta
1. URL testada.
2. Verificacoes executadas.
3. Resultado (`OK`/`FALHOU`).
4. Evidencia curta (ex.: texto encontrado).
5. Proximo passo.

## Boas Praticas Para Economizar Tokens
- Fazer checks curtos e diretos.
- Nao repetir HTML completo.
- Focar apenas no criterio solicitado.

## Encerramento
Se nao houver uso continuo de navegador, recomendar desligar MCP para reduzir custo operacional.

## Exemplos De Prompt
- `Use $openclaw-mcp-playwright. Abra https://example.com e confirme o titulo da pagina em 4 linhas.`
- `Use $openclaw-mcp-playwright. Valide se existe botao "Entrar" na home e retorne OK/FALHOU.`
- `Use $openclaw-mcp-playwright. Teste formulario basico em http://localhost:3000 e diga em qual etapa falha.`
```
13. Salve os 3 arquivos.
14. Reinicie o Codex.
15. Resultado esperado:
16. Voce passa a ter skills proprias, completas, com regra de uso, limite, formato de resposta e exemplos prontos.

### 17.4A Passo 4A - Skills Extras Do Projeto Completo
1. Para cobrir o projeto inteiro, use tambem estas skills extras na pasta `.agents/skills`:
2. `openclaw-fba-pipeline-ops`
3. `openclaw-whatsapp-lembretes-ops`
4. `openclaw-varredor-fornecedores-ops`
5. `openclaw-deploy-live-ops`
6. `openclaw-google-sheets-ops`
7. `openclaw-gateway-tunnel-ops`
8. `openclaw-state-log-troubleshoot`
9. O que cada uma cobre, em 1 linha:
12. `openclaw-fba-pipeline-ops`: parse, browser, regras, relatorio, resume/manual/dry-run do FBA.
13. `openclaw-whatsapp-lembretes-ops`: comandos, tarefas, follow-up e telefone autorizado do agente WhatsApp.
14. `openclaw-varredor-fornecedores-ops`: validacao de faixa/abas/perfil e disparo seguro da varredura.
15. `openclaw-deploy-live-ops`: deploy remoto com validacao de Docker e gateway.
16. `openclaw-google-sheets-ops`: credenciais, headers e append na planilha.
17. `openclaw-gateway-tunnel-ops`: tunnel manual/persistente para acessar gateway localmente.
18. `openclaw-state-log-troubleshoot`: diagnostico por logs e estado sem acao destrutiva.
19. Exemplo rapido de uso no prompt:
22. `Use $openclaw-fba-pipeline-ops para investigar falha no modo resume lendo apenas agents/fba/index.js e scripts/run-fba-from-html.sh.`
23. `Use $openclaw-deploy-live-ops para revisar deploy-live e me dar checklist de validacao final.`
24. Resultado esperado:
25. Skill certa para cada parte do projeto, com menos retrabalho e respostas mais objetivas.

### 17.4B Passo 4B - Guia Detalhado Das Skills (Projeto Completo)
1. Como saber se uma skill esta funcionando no Codex:
2. Abra `Codex Settings`.
3. Clique em `Skills`.
4. Veja se a skill aparece em `Installed`.
5. Se nao aparecer:
6. Volte em `Configuration`.
7. Em `Import external agent config`, marque `Skills`.
8. Clique em `Apply selected`.
9. Reinicie o Codex.
10. Teste rapido:
11. No prompt, digite `$` e veja se a skill aparece no seletor.
12. Se aparecer, ela esta funcionando.
13. Se nao aparecer, verifique se existe o arquivo `SKILL.md` dentro da pasta correta.

14. Guia detalhado por skill:

15. `openclaw-fba-pipeline-ops`
16. O que faz: cuida do fluxo FBA inteiro (parse, browser, regras, relatorio, resume/manual/dry-run).
17. Quando usar: erro no FBA, duvida no parser, problema no browser, ajuste de regra.
18. Quando nao usar: tarefas fora do FBA.
19. Arquivos que ela costuma ler: `agents/fba/*` e `scripts/run-fba-from-html.sh`.
20. Exemplo: `Use $openclaw-fba-pipeline-ops. Investigue falha no modo resume do FBA.`

21. `openclaw-whatsapp-lembretes-ops`
22. O que faz: opera lembretes, tarefas e follow-ups do agente WhatsApp com validacao de telefone.
23. Quando usar: erro em comando, lembrete nao envia, telefone nao autorizado.
24. Quando nao usar: ajustes em outro agente.
25. Arquivos que ela costuma ler: `agents/whatsapp-lembretes/index.js` e `scripts/whatsapp-lembretes-command.js`.
26. Exemplo: `Use $openclaw-whatsapp-lembretes-ops. Corrigir erro ao criar lembrete com phone autorizado.`

27. `openclaw-varredor-fornecedores-ops`
28. O que faz: valida faixa de indices/preco/abas e garante start seguro da varredura.
29. Quando usar: erro ao iniciar varredura, faixa invalida, comando externo falhando.
30. Quando nao usar: tarefas sem varredor.
31. Arquivos que ela costuma ler: `agents/varredor-fornecedores/index.js`.
32. Exemplo: `Use $openclaw-varredor-fornecedores-ops. Validar dry-run de 1 a 50 com preco 0 a 85.`

33. `openclaw-deploy-live-ops`
34. O que faz: deploy remoto, install, rebuild, restart e validacao final.
35. Quando usar: deploy, falha de SSH, falha de Docker/gateway.
36. Quando nao usar: tarefas sem deploy.
37. Arquivos que ela costuma ler: `scripts/deploy.sh`, `scripts/deploy-live.sh`, `scripts/register-agents.sh`.
38. Exemplo: `Use $openclaw-deploy-live-ops. Revisar deploy-live e montar checklist final.`

39. `openclaw-google-sheets-ops`
40. O que faz: integra Google Sheets (credenciais, headers, append).
41. Quando usar: erro de credencial, planilha vazia, append falhando.
42. Quando nao usar: tarefas sem planilha.
43. Arquivos que ela costuma ler: `integrations/google-sheets/index.js` e `core/secrets.js`.
44. Exemplo: `Use $openclaw-google-sheets-ops. Investigar erro de credenciais na planilha.`

45. `openclaw-gateway-tunnel-ops`
46. O que faz: cria e conserta tunnel SSH para acessar o gateway localmente.
47. Quando usar: tunnel cai, porta errada, service nao sobe.
48. Quando nao usar: tarefas sem tunnel.
49. Arquivos que ela costuma ler: `scripts/ssh-tunnel.sh` e `scripts/ssh-tunnel-service.sh`.
50. Exemplo: `Use $openclaw-gateway-tunnel-ops. Diagnosticar por que o tunnel cai apos alguns minutos.`

51. `openclaw-state-log-troubleshoot`
52. O que faz: usa logs e estado para achar causa raiz e retomar execucao.
53. Quando usar: agente travou, erros repetidos, resultado inconsistente.
54. Quando nao usar: tarefas novas sem historico.
55. Arquivos que ela costuma ler: `core/state.js`, `core/logger.js`, `storage/state/*`, `storage/logs/*`.
56. Exemplo: `Use $openclaw-state-log-troubleshoot. Investigar por que o agente fba parou no meio.`

### 17.5 Passo 5 - Usar Skills Corretamente No Dia A Dia
1. Abra o painel do Codex.
2. No prompt, digite `$`.
3. Selecione uma skill.
4. Envie a tarefa ja com objetivo claro.
5. Exemplo com `openclaw-token-budget`:
6. `Objetivo: ajustar logs do deploy. Leia somente scripts/deploy.sh e package.json. Responda em 6 passos curtos.`
7. Exemplo com `openclaw-safe-edit`:
8. `Ajuste minimo em scripts/run-fba-from-html.sh sem alterar outros arquivos.`
9. Resultado esperado:
10. Respostas mais curtas, diretas e com menor custo de contexto.

### 17.6 Passo 6 - Usar MCP Sem Confusao (Quando Usar E Quando Nao Usar)
1. Abra `Codex Settings`.
2. Clique em `MCP servers`.
3. Voce vera `Custom servers` e `Recommended servers`.
4. Para ligar um recomendado, clique em `Install`.
5. Para o Playwright, use o toggle para ligar/desligar.
6. Quando usar MCP:
7. Quando a tarefa precisa de ferramenta externa (ex.: abrir pagina, validar UI, buscar dado fora do repo).
8. Quando nao usar MCP:
9. Quando a tarefa e editar arquivo local ou explicar codigo local.
10. Exemplo pratico de uso MCP Playwright:
11. `Use MCP Playwright para abrir https://example.com e confirmar o titulo da pagina.`
12. Se funcionar, o Codex retorna a verificacao.
13. Se nao funcionar, revise toggle e `config.toml`.
14. Resultado esperado:
15. MCP vira ferramenta de apoio, nao custo extra desnecessario.

### 17.7 Passo 7 - Fluxo Diario Ideal (Rapido E Eficiente)
1. Escolha 1 tarefa por vez.
2. Escolha 1 skill para aquela tarefa.
3. Limite a leitura para 1 ou 2 arquivos.
4. Use MCP so se necessario.
5. Peca resposta curta com formato fixo.
6. Aplique a mudanca.
7. Rode validacao local.
8. Se precisar de ajuste, mande so o delta.
9. Resultado esperado:
10. Menos tokens, menos retrabalho, mais produtividade.

### 17.8 Passo 8 - Prompts Prontos Para Usar Agora
1. Prompt para economia de tokens:
2. `Use $openclaw-token-budget. Objetivo: resolver erro de deploy. Leia somente scripts/deploy.sh e scripts/deploy-live.sh. Responda em 6 passos curtos.`
3. Prompt para edicao segura:
4. `Use $openclaw-safe-edit. Ajuste minimo em agents/whatsapp-lembretes/index.js para melhorar mensagem de erro. Nao altere outros arquivos.`
5. Prompt para MCP Playwright:
6. `Use $openclaw-mcp-playwright. Valide se o botao principal existe em https://example.com e retorne resultado em 4 linhas.`

### 17.9 Passo 9 - Checklist Final De Controle
1. `Skill certa selecionada?`
2. `Effort adequado (medium/high/xhigh)?`
3. `Leitura limitada a no maximo 2 arquivos?`
4. `MCP ligado so se necessario?`
5. `Prompt curto e objetivo?`
6. `Validacao local executada?`

### 17.10 Links Diretos Para Cada Parte Do Processo
1. Config basica do Codex:
```
https://developers.openai.com/codex/config-basic
```
2. Skills do Codex:
```
https://developers.openai.com/codex/skills
```
3. MCP do Codex:
```
https://developers.openai.com/codex/mcp
```
4. Settings da extensao:
```
https://developers.openai.com/codex/ide/settings
```
5. VS Code:
```
https://code.visualstudio.com/
```
