---
name: openclaw-mcp-playwright
description: Use quando precisar validar pagina web, elemento de interface ou fluxo visual com MCP Playwright de forma objetiva e com baixo custo.
---

# OpenClaw MCP Playwright

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


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
