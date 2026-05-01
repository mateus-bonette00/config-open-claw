---
name: openclaw-varredor-fornecedores-ops
description: Use para operar e resolver problemas do agente varredor-fornecedores (faixa de preco, indices, abas, perfil e comando externo). Acione sempre que o usuario falar de varredura, fornecedores, erro no comando externo ou dry-run.
---

# OpenClaw Varredor Fornecedores Ops (agente varredor-fornecedores)

## Ambiente do Servidor
- **Servidor:** Desktop rodando Ubuntu 24 (`srv-desktop`).
- **Hospedagem:** O Open Claw e todos os agentes estão hospedados neste servidor.
- **Acesso:** Realizado via notebook através do terminal usando o comando `ssh openclaw-server`.
- **User/Host:** `bonette@srv-desktop`.


## Objetivo (1 frase)
Executar a varredura com parametros corretos e risco baixo.

## Formato de resposta (obrigatorio)
1. Responder sempre em passos numerados.
2. Linguagem simples e direta.
3. Sempre incluir 1 exemplo pratico no final.
4. Se envolver site/painel, incluir link direto.

## Quando usar (gatilhos)
1. Erro ao iniciar varredura.
2. Duvida sobre indices, faixa de preco, abas ou perfil.
3. Precisa validar `dry-run`.
4. Comando externo nao encontrado.

## Antes de comecar (perguntas obrigatorias)
1. Quais parametros voce quer usar (inicio, fim, preco min/max, abas)?
2. Voce quer `dry-run` ou execucao real?
3. Qual erro aparece (texto exato)?

## Arquivos principais (abrir primeiro)
1. `agents/varredor-fornecedores/index.js`
2. `package.json`
3. `.env`
4. `storage/logs/varredor-fornecedores.log`
5. `storage/state/varredor-fornecedores.json`

## Guia rapido (passo a passo)
1. Confirme os parametros: `startIndex`, `endIndex`, `minPrice`, `maxPrice`, `tabs`, `profile`.
2. Rode o status: `node agents/varredor-fornecedores/index.js --status`.
3. Rode primeiro em `dry-run`:
   `node agents/varredor-fornecedores/index.js --start-index 1 --end-index 20 --min-price 0 --max-price 85 --tabs 8 --dry-run`.
4. Confira `commandPath` e `logPath` no resultado.
5. Se estiver tudo OK, rode a execucao real (sem `--dry-run`).
6. Veja o log em `storage/logs/varredor-fornecedores.log`.
7. Veja o estado em `storage/state/varredor-fornecedores.json` (campo `lastRun`).
8. Se falhar, ajuste apenas o ponto exato e rode de novo.

## Fluxos comuns (passo a passo)
### 1) Comando externo nao encontrado
1. Rode `node agents/varredor-fornecedores/index.js --status`.
2. Veja o `commandPath` retornado.
3. Confirme se o arquivo existe no servidor.
4. Se nao existir, ajuste `SUPPLIER_SWEEP_COMMAND` no `.env`.
Exemplo: se o status mostrar `commandExists: false`, corrija o caminho no `.env` e rode o `dry-run` de novo.

### 2) Faixa de preco invalida
1. Confirme `minPrice` e `maxPrice`.
2. Garanta que `minPrice <= maxPrice`.
3. Rode `dry-run` com a faixa corrigida.
Exemplo: se voce usou `minPrice=90` e `maxPrice=80`, inverta e rode novamente.

## Comandos prontos (copiar e colar)
1. `node agents/varredor-fornecedores/index.js --status`
2. `npm run supplier-sweep -- --start-index 1 --end-index 20 --min-price 0 --max-price 85 --tabs 8 --dry-run`
3. `npm run supplier-sweep -- --start-index 1 --end-index 20 --min-price 0 --max-price 85 --tabs 8`

## O que nao fazer
1. Nao iniciar execucao real sem `dry-run`.
2. Nao usar `startIndex > endIndex`.
3. Nao rodar com faixa de preco invalida.

## Exemplo pratico
Se voce quer varrer de 1 a 50 com preco 0 a 85 e 10 abas, rode o `dry-run` primeiro e depois a execucao real.
