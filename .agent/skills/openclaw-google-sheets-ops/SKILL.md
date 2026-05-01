---
name: openclaw-google-sheets-ops
description: Use para integracao Google Sheets do projeto (credenciais, headers, append de produtos aprovados) com foco em confiabilidade.
---

# OpenClaw Google Sheets Ops

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


## Objetivo
Garantir integracao estavel com Google Sheets para gravar produtos aprovados sem perder consistencia de colunas.

## Quando Usar
- Erro ao conectar na API do Google Sheets.
- Ajuste de headers da planilha.
- Problema ao append de produto unico ou batch.
- Validacao de variaveis `GOOGLE_SHEETS_*`.

## Arquivos Foco
1. `integrations/google-sheets/index.js`
2. `core/secrets.js`
3. `config/google-credentials.json` (somente existencia/caminho)

## Fluxo Obrigatorio
1. Confirmar `credentialsPath`, `spreadsheetId` e `sheetName`.
2. Validar acesso da Service Account na planilha.
3. Garantir headers antes de append.
4. Testar append pequeno.
5. Confirmar log de sucesso.

## Regras De Seguranca
- Nunca imprimir conteudo do JSON de credenciais.
- Nunca expor tokens/chaves em resposta.
- Nao alterar estrutura de colunas sem alinhamento.

## Formato De Entrega
1. Pre-requisitos validados.
2. Ajuste aplicado.
3. Resultado do append de teste.
4. Proximo passo.

## Exemplos De Prompt
- `Use $openclaw-google-sheets-ops. Investigar erro de credenciais na integracao Google Sheets.`
- `Use $openclaw-google-sheets-ops. Ajustar appendProducts para manter consistencia dos headers.`

