# GUIA_USO_AGENTES_IA

## 1. Objetivo Deste Guia
1. Te ensinar a usar melhor 3 ferramentas neste projeto:
2. `Agent` no Google Antigravity.
3. Extensao do Codex na IDE.
4. Extensao do Claude Code na IDE.
5. Prioridade absoluta: gastar menos tokens sem perder qualidade tecnica.
6. Este guia foi feito para uso pratico do dia a dia, com passos claros de onde clicar e o que escrever.

## 2. Resumo Simples Do Projeto
1. Projeto: `openclaw-agents`.
2. Objetivo do projeto: operar agentes de automacao (FBA, WhatsApp, social media e prospecting).
3. Stack principal confirmada: `Node.js >=22`, JavaScript ESM, `puppeteer`, `googleapis`, `cron`, `dotenv`.
4. Pastas principais:
5. `agents/` (agentes de negocio).
6. `core/` (logger, estado, segredos, scheduler).
7. `scripts/` (deploy, registro, tunel, execucoes assistidas).
8. `skills/openclaw-config-zoe-agents/` (skill local pronta para este repo).
9. Arquivos sensiveis:
10. `.env` e `.env.example` (credenciais).
11. `storage/` (estado e logs operacionais).

## 3. Resultado Final Que Voce Vai Ganhar
1. Saber exatamente quando usar Codex, Claude Code e Antigravity.
2. Evitar releitura desnecessaria do repositorio.
3. Ter prompts curtos e reutilizaveis para reduzir consumo.
4. Usar Skills e MCP do Codex de forma objetiva.
5. Ter um kit de "skills praticas" para Claude Code e Antigravity mesmo quando o produto nao tiver a mesma feature nativa do Codex.

## 4. Regra De Ouro Para Economia De Tokens
1. Sempre comece com uma frase de objetivo.
2. Sempre limite leitura de arquivos.
3. Sempre peça resposta em formato curto.
4. Sempre valide com um comando simples.
5. Nunca envie projeto inteiro.
6. Nunca cole logs enormes.
7. Nunca misture 3 tarefas no mesmo prompt.
8. Formula curta que funciona:
9. `Objetivo + Arquivos + Restricoes + Saida esperada`.
10. Exemplo real:
11. `Objetivo: corrigir erro ENOENT no deploy. Arquivos: scripts/deploy.sh e package.json. Restricao: nao alterar outros arquivos. Saida: 3 causas + patch minimo.`

## 5. Fluxo Ponta A Ponta (Padrao Diario)
1. Abra a pasta do projeto na IDE: `/home/mateus/Documentos/Projetos/config-open-claw`.
2. Escolha a tarefa do momento em 1 linha.
3. Escolha a ferramenta certa:
4. Codex para editar codigo local com controle fino.
5. Claude Code para diagnostico rapido e revisao de abordagem.
6. Antigravity para brainstorm e delegacao exploratoria.
7. Separe contexto minimo:
8. 1 erro + 1 ou 2 arquivos no maximo.
9. Envie pedido curto.
10. Aplique a resposta.
11. Valide localmente (script, lint, log, output).
12. Se falhar, envie apenas o delta do problema (nao reenvie tudo).
13. Feche a tarefa e passe para a proxima.

## 5.1 Quadro De Decisao Rapida

| Situacao | Ferramenta Principal | Motivo |
|---|---|---|
| Precisa alterar arquivo local com seguranca | Codex | Melhor controle de edicao e fluxo de patch |
| Precisa diagnostico rapido antes de editar | Claude Code | Resposta objetiva e triagem rapida |
| Precisa ideacao ou plano de alto nivel | Antigravity | Bom para exploracao e alternativas |
| Precisa usar skill nativa | Codex | Sistema de Skills mais claro e direto |
| Precisa navegador via MCP | Codex ou Claude (se configurado) | Reduz copia de HTML grande |

## 6. Como Usar Melhor O Codex Na IDE

### 6.1 Quando Usar
1. Quando voce quer editar arquivos do repo com seguranca.
2. Quando voce quer um patch minimo e rastreavel.
3. Quando voce quer usar Skills e MCP no fluxo.

### 6.2 Quando Nao Usar
1. Quando a tarefa e so uma duvida conceitual curta.
2. Quando voce ainda nao definiu o objetivo tecnico.

### 6.3 Passo A Passo Basico No Codex (Tela)
1. Abra a IDE com este projeto.
2. Clique no icone do Codex na barra lateral.
3. Clique em `New chat` ou `New task`.
4. Cole um prompt curto no formato da regra de ouro.
5. Se precisar, anexe apenas os arquivos necessarios.
6. Execute.
7. Revise o plano de mudanca.
8. Aplique mudancas.
9. Rode validacao local.
10. Se estiver certo, finalize a tarefa.

### 6.4 Passo A Passo De `Codex settings`
1. No painel do Codex, abra `Settings`.
2. Entre em `Codex settings`.
3. Confira modelo e effort.
4. Para economizar tokens em tarefas simples, prefira effort medio.
5. Para tarefas complexas, use effort alto.
6. Salve.
7. Rode uma tarefa curta para confirmar que a configuracao esta ativa.

### 6.5 Passo A Passo De `Open config.toml`
1. No Codex, clique em `Open config.toml`.
2. Arquivo atual confirmado: `/home/mateus/.codex/config.toml`.
3. O que existe hoje:
4. `model = "gpt-5.3-codex"`.
5. `model_reasoning_effort = "high"`.
6. `personality = "pragmatic"`.
7. MCP Playwright configurado.
8. `multi_agent = true`.
9. Quando vale mudar:
10. Se custo estiver alto em tarefas simples, reduzir effort para `medium`.
11. Se nao usa MCP Playwright no dia a dia, manter desligado na interface.
12. Como validar alteracao:
13. Salve o arquivo.
14. Reinicie a sessao do Codex na IDE.
15. Rode tarefa curta e confira comportamento.

### 6.6 Passo A Passo De `Skills settings` No Codex
1. Abra Codex.
2. Clique em `Skills settings`.
3. Veja `Installed skills`.
4. Veja `Recommended skills`.
5. Clique em `Install` em skill que tenha uso real no seu fluxo.
6. Para criar nova, clique em `Create new skill`.
7. Diga nome, descricao e regras.
8. Salve.
9. Teste chamando a skill no prompt.
10. Exemplo de chamada:
11. `@openclaw-config-zoe-agents Analise risco de regressao no deploy com foco em scripts/deploy.sh`.

### 6.7 Skills Codex Que Fazem Sentido Neste Projeto
1. `openclaw-config-zoe-agents` (ja existe no repo).
2. Skill de `diagnostico-fba-log-curto` (foco em erros do FBA com 30-50 linhas de log).
3. Skill de `checklist-deploy-openclaw` (foco em deploy seguro e verificacao pos deploy).
4. Skill de `hardening-secrets` (foco em evitar exposicao de chave/token).
5. Quando criar skill nova:
6. Quando a tarefa se repete 3 vezes ou mais por semana.
7. Quando NAO criar skill nova:
8. Tarefa rara ou unica.

### 6.8 Passo A Passo De `MCP settings` No Codex
1. Abra Codex.
2. Clique em `MCP settings`.
3. Para adicionar servidor, clique em `Add server`.
4. Para servidor recomendado, clique em `Install recommended MCP` (se aparecer).
5. Ative no toggle `Enabled`.
6. Confirme status `Connected` ou equivalente.
7. Faça um teste simples pedindo uso do MCP.
8. Se nao usar mais, desligue o toggle para reduzir complexidade.

### 6.9 MCP No Codex Via Arquivo
1. Abra `config.toml`.
2. Exemplo ja existente neste ambiente:
3. `[mcp_servers.playwright]` com `npx @playwright/mcp@latest`.
4. Salve.
5. Reinicie o Codex.
6. Teste com uma tarefa que realmente precisa de browser.
7. Se o MCP nao for usado com frequencia, mantenha desativado na rotina.

### 6.10 Prompts Curtos Prontos Para Codex
1. `Leia somente agents/fba/index.js e core/logger.js. Liste 3 gargalos de tokens e 3 melhorias.`
2. `Ajuste scripts/deploy.sh para logar inicio/fim e falha. Nao altere outros arquivos.`
3. `Use @openclaw-config-zoe-agents e gere checklist de deploy seguro em 10 passos curtos.`

## 7. Como Usar Melhor O Claude Code Na IDE

### 7.1 Quando Usar
1. Diagnostico rapido de erro.
2. Revisao de abordagem antes de editar muito.
3. Comparacao de alternativas tecnicas curtas.

### 7.2 Quando Nao Usar
1. Refactor grande com varios arquivos ao mesmo tempo.
2. Tarefa que exige controle forte de patch local e historico detalhado.

### 7.3 Passo A Passo Basico No Claude Code
1. Abra a extensao Claude Code na IDE.
2. Clique em `New chat`.
3. Envie pedido curto com arquivos-alvo.
4. Peça resposta em formato fixo (exemplo: 5 passos).
5. Aplique so o que fizer sentido.
6. Valide com comando local.

### 7.4 Passo A Passo De Configuracao Do Claude Code
1. Documentacao oficial: `https://docs.anthropic.com/en/docs/claude-code/settings`.
2. No projeto, voce ja tem: `.claude/settings.local.json`.
3. Esse arquivo ja bloqueia leitura de pastas pesadas e arquivos desnecessarios.
4. Isso ajuda diretamente na economia de tokens.
5. Ajuste apenas se voce souber o impacto.

### 7.5 MCP No Claude Code (Quando For Necessario)
1. Documentacao oficial MCP: `https://docs.anthropic.com/en/docs/claude-code/mcp`.
2. Voce pode configurar via `.mcp.json` por projeto.
3. Se usar CLI do Claude Code, tambem pode usar `claude mcp add ...`.
4. Ative apenas MCP que tenha uso real no seu fluxo.
5. Valide com uma pergunta que exige essa ferramenta externa.
6. Se nao for usar, desative para manter simplicidade.

### 7.6 Skills Para Claude Code (Importante)
1. Nao assuma que Claude Code usa exatamente o mesmo sistema de Skills do Codex.
2. Recurso oficial proximo de "skills" no Claude Code:
3. Subagents (agentes especializados) e padroes reutilizaveis de prompt.
4. Referencia oficial: `https://docs.anthropic.com/en/docs/claude-code/settings` (secao de subagents).
5. Estrategia pratica para voce:
6. Criar "skills de prompt" reutilizaveis com nome fixo.
7. Opcionalmente criar subagents em `.claude/agents/` se voce quiser padrao mais forte.

### 7.7 Exemplo De Skill De Prompt Para Claude Code
1. Nome sugerido: `SKILL_CLAUDE_DIAGNOSTICO_DEPLOY`.
2. Prompt base:
3. `Voce e especialista em deploy OpenClaw. Leia apenas scripts/deploy.sh e package.json. Me entregue: causa raiz provavel, risco, correcao minima e comando de validacao.`
4. Como usar:
5. Cole esse prompt sempre que o problema for deploy.
6. Beneficio:
7. Nao reescreve instrucoes toda vez.

### 7.8 Prompts Curtos Prontos Para Claude Code
1. `Leia apenas scripts/run-fba-from-html.sh. Explique 5 pontos de falha mais comuns e como prevenir.`
2. `Analise core/secrets.js e diga 5 melhorias de seguranca sem quebrar compatibilidade.`
3. `Revise agents/whatsapp-lembretes/index.js e liste 3 riscos operacionais + 3 mitigacoes.`

## 8. Como Usar Melhor O Agent No Google Antigravity

### 8.1 Transparencia Importante
1. Nao encontrei documentacao oficial robusta do Antigravity equivalente aos docs do Codex/Claude.
2. Entao o guia abaixo usa pratica operacional segura, sem assumir botao especifico que nao conseguimos confirmar.
3. Se o nome do botao mudar na sua tela, procure o equivalente.

### 8.2 Quando Usar Antigravity
1. Para ideacao e exploracao rapida.
2. Para gerar planos de automacao antes de codar.
3. Para comparar abordagens sem editar o repo todo.

### 8.3 Quando Nao Usar Antigravity
1. Para patch local detalhado com controle fino de arquivo.
2. Para tarefas que exigem leitura longa do repositorio inteiro.

### 8.4 Passo A Passo Basico No Antigravity
1. Abra o Antigravity pelo atalho/app que voce ja usa.
2. Clique em `New chat` ou equivalente.
3. Escreva objetivo em 1 linha.
4. Limite o escopo de leitura.
5. Peça resposta curta em formato fixo.
6. Valide no projeto real antes de aplicar.

### 8.5 Skills Para Antigravity (Formato Pratico)
1. Se a ferramenta nao tiver skill nativa clara, use "skills de prompt".
2. O que e isso:
3. Um bloco pronto com nome fixo que voce cola sempre no inicio.
4. Exemplo de skill de prompt:
5. `SKILL_ANTIGRAVITY_MAPA_RAPIDO_OPENCLAW: Leia somente package.json, agents/fba/index.js e scripts/deploy.sh. Entregue: mapa do fluxo, 5 riscos e 5 otimizações de tokens.`
6. Beneficio:
7. Menos repeticao e menos tokens desperdicados.

### 8.6 Prompts Curtos Prontos Para Antigravity
1. `Nao leia o projeto inteiro. Leia so package.json e scripts/deploy.sh. Liste 5 ganhos de eficiencia operacional.`
2. `Analise somente agents/fba/index.js. Quais partes geram mais custo de contexto? Responda em 6 itens.`
3. `Monte plano em 7 passos para reduzir retrabalho entre Codex e Claude Code neste repo.`

## 9. Kit De Skills Praticas (Codex, Claude, Antigravity)

### 9.1 Skill 1: Diagnostico FBA Curto
1. Objetivo: achar causa raiz rapida em erros FBA.
2. Entrada: 30-50 linhas de log + `agents/fba/index.js`.
3. Saida: causa, risco, patch minimo, comando de validacao.
4. Onde usar:
5. Codex como skill nativa.
6. Claude e Antigravity como skill de prompt.

### 9.2 Skill 2: Checklist Deploy Seguro
1. Objetivo: evitar regressao no deploy.
2. Entrada: `scripts/deploy.sh`, `scripts/deploy-live.sh`, `package.json`.
3. Saida: checklist de pre, durante e pos deploy.
4. Onde usar:
5. Codex skill nativa.
6. Claude e Antigravity como prompt reutilizavel.

### 9.3 Skill 3: Hardening De Segredos
1. Objetivo: evitar exposicao de tokens/chaves.
2. Entrada: `.env.example`, `core/secrets.js`.
3. Saida: pontos de risco + plano de saneamento.
4. Onde usar:
5. Codex, Claude, Antigravity.

### 9.4 Skill 4: Revisao De Token Budget
1. Objetivo: reduzir consumo por tarefa.
2. Entrada: prompt atual + arquivos que a tarefa le.
3. Saida: versao otimizada do prompt e corte de contexto.
4. Onde usar:
5. Codex, Claude, Antigravity.

### 9.5 Skill 5: Triagem De Incidente Operacional
1. Objetivo: responder incidente sem caos.
2. Entrada: sintoma + 1 log curto + script relacionado.
3. Saida: causa provavel, impacto, acao imediata, acao preventiva.
4. Onde usar:
5. Codex, Claude, Antigravity.

## 10. Como Criar Skill Nova No Codex (Passo A Passo Real)
1. Abra `Skills settings` no Codex.
2. Clique em `Create new skill`.
3. Nomeie com padrao claro, ex: `openclaw-checklist-deploy`.
4. Escreva descricao objetiva de quando usar.
5. Defina regras fixas (arquivos alvo, formato de resposta, limites).
6. Salve.
7. Teste com tarefa real curta.
8. Ajuste a skill se a resposta vier longa demais.
9. Marque a skill como padrao para tarefas iguais.

## 11. Como Criar Skill Reutilizavel No Claude Code
1. Escolha um nome fixo de skill de prompt.
2. Escreva um bloco base curto com objetivo e limites.
3. Guarde esse bloco em um arquivo de apoio do seu uso pessoal.
4. Exemplo de arquivo pessoal:
5. `~/Documentos/Prompts/skills-claude-openclaw.md`.
6. Sempre cole o bloco antes da tarefa.
7. Opcional avancado: criar subagent em `.claude/agents/` seguindo docs oficiais.
8. Valide se a resposta ficou mais curta e consistente.

## 12. Como Criar Skill Reutilizavel No Antigravity
1. Escolha nome fixo da skill de prompt.
2. Crie um texto padrao com:
3. Papel.
4. Escopo de leitura.
5. Formato da resposta.
6. Criterio de validacao.
7. Salve num bloco pronto para copiar e colar.
8. Use sempre o mesmo cabecalho para reduzir variacao e consumo.

## 13. Avaliacao Honesta De MCPs Para Este Projeto

| MCP | Serve para este projeto? | Ganho de produtividade | Ganho de tokens | Esforco manutencao | Vale a pena agora? |
|---|---|---|---|---|---|
| Playwright MCP | Validar paginas e fluxos web sem colar HTML | Medio | Medio | Medio | Sim, uso sob demanda |
| Docs MCP OpenAI | Consultar docs do Codex sem copiar docs longas | Medio | Medio | Baixo | Sim, se consulta docs frequente |
| MCPs genericos sem caso de uso | Nao traz ganho claro aqui | Baixo | Baixo | Medio/Alto | Nao |

## 14. Ordem Recomendada De Uso Das 3 Ferramentas
1. Comece no Claude Code para diagnostico curto.
2. Passe para Codex para implementacao local controlada.
3. Use Antigravity para explorar melhorias maiores ou alternativas.
4. Volte para Codex para consolidar patch final.
5. Valide localmente.

## 15. Erros Comuns Que Aumentam Muito O Custo
1. Pedir analise do repositorio inteiro sem recorte.
2. Enviar logs gigantescos.
3. Enviar HTMLs de milhares de linhas sem necessidade.
4. Nao definir formato de resposta.
5. Misturar multiplas tarefas em um prompt so.
6. Nao reutilizar skill/prompt padrao.
7. Deixar MCP ligado sem uso real.

## 16. Como Corrigir Cada Erro Rapido
1. Erro: prompt grande e vago.
2. Correcao: usar formula `Objetivo + Arquivos + Restricoes + Saida`.
3. Erro: contexto longo demais.
4. Correcao: limite de 2 arquivos por iteracao.
5. Erro: custo alto por effort sempre alto.
6. Correcao: effort medio para tarefas simples.
7. Erro: resposta longa e pouco util.
8. Correcao: "responda em 5 passos curtos".

## 17. Configuracao Recomendada De Economia (Pratica)
1. Codex:
2. Tarefas simples: `model_reasoning_effort = medium`.
3. Tarefas complexas: `high`.
4. MCP ligado apenas quando usar.
5. Claude Code:
6. Manter bloqueios de leitura desnecessaria em `.claude/settings.local.json`.
7. Ativar MCP somente para tarefa que realmente precisa.
8. Antigravity:
9. Sempre com prompt curto e recorte de arquivo.
10. Skill de prompt fixa para nao repetir instrucoes toda vez.

## 18. Checklist Final De Aplicacao
1. Eu sei quando usar cada ferramenta.
2. Eu uso prompts curtos com objetivo claro.
3. Eu limito leitura de arquivos por tarefa.
4. Eu uso a skill `openclaw-config-zoe-agents` no Codex quando faz sentido.
5. Eu sei abrir `config.toml` do Codex e validar mudanca.
6. Eu sei abrir `Skills settings` e `MCP settings` no Codex.
7. Eu sei quando ativar e desativar MCP.
8. Eu uso skills de prompt no Claude Code e Antigravity.
9. Eu valido resultado com comando simples antes de seguir.

## 19. Links Diretos Oficiais
1. OpenAI Codex (visao geral):
2. `https://openai.com/codex/`
3. Codex app (skills e uso geral):
4. `https://openai.com/index/introducing-the-codex-app/`
5. Codex na plataforma de developers:
6. `https://developers.openai.com/codex/cloud`
7. Docs MCP OpenAI (Codex/IDE):
8. `https://developers.openai.com/learn/docs-mcp`
9. Help OpenAI sobre Codex no ChatGPT:
10. `https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan`
11. Claude Code IDE Integrations (oficial Anthropic):
12. `https://docs.anthropic.com/en/docs/claude-code/ide-integrations`
13. Claude Code settings (oficial Anthropic):
14. `https://docs.anthropic.com/en/docs/claude-code/settings`
15. Claude Code MCP (oficial Anthropic):
16. `https://docs.anthropic.com/en/docs/claude-code/mcp`
17. MCP Specification:
18. `https://modelcontextprotocol.info/specification/`
19. Antigravity:
20. Nao encontrei documentacao oficial consolidada confiavel no momento desta analise. Use o painel oficial da sua conta e valide nomes de menu diretamente na interface.

## 20. Aviso De Seguranca Importante
1. O `.env.example` deste repo parece conter valores que aparentam ser reais.
2. Isso e risco serio de seguranca.
3. Acao recomendada:
4. Rotacionar chaves/tokens.
5. Trocar no arquivo por placeholders (`SEU_TOKEN_AQUI`).
6. Evitar enviar qualquer segredo em prompts para IA.

## 21. Kit Copia E Cola (Prompts Prontos)
1. Prompt rapido universal:
2. `Objetivo: <tarefa>. Leia somente: <arquivos>. Restricoes: nao alterar outros arquivos, resposta curta. Saida: causa raiz, patch minimo, validacao.`
3. Prompt de economia de tokens:
4. `Reescreva este prompt para gastar menos tokens sem perder qualidade. Limite em 6 linhas.`
5. Prompt de deploy:
6. `Foque em scripts/deploy.sh e scripts/deploy-live.sh. Liste risco, mitigacao e check final em 8 passos.`
7. Prompt de FBA:
8. `Foque em agents/fba/index.js e parser.js. Liste gargalos de contexto e melhorias de token budget.`
