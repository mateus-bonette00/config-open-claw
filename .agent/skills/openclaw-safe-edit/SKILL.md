---
name: openclaw-safe-edit
description: Use para alteracoes seguras e minimas no projeto config-open-claw, preservando comandos, contratos e estabilidade operacional.
---

# OpenClaw Safe Edit

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


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
