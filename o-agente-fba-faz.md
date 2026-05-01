# O Que o Agente FBA Faz (Do Comeco ao Fim)

## 1. O que eu analisei
1. Codigo do agente no servidor/projeto:
`/home/bonette/openclaw-agents/agents/fba/index.js`
`/home/bonette/openclaw-agents/agents/fba/parser.js`
`/home/bonette/openclaw-agents/agents/fba/browser.js`
`/home/bonette/openclaw-agents/agents/fba/rules.js`
`/home/bonette/openclaw-agents/agents/fba/report.js`
`/home/bonette/openclaw-agents/scripts/run-fba-from-html.sh`
2. Esse documento explica o comportamento real do codigo, sem alterar nada.

## 2. Resumo em 1 frase
1. O agente pega um HTML com produtos de fornecedor, valida/limpa os dados, abre fornecedor e Amazon no navegador, calcula lucro/margem/ROI com Keepa + AZInsight, decide se aprova ou nao, e gera relatorio HTML final.
2. O nome do arquivo pode ser qualquer um, desde que termine com `.html`.

## 3. Mapa visual rapido
```text
HTML de entrada
    ->
Runner (run-fba-from-html.sh)
    ->
Valida VPN + prepara ambiente
    ->
Parser (limpa, deduplica, filtra lixo)
    ->
Loop de produtos (batch)
    ->
Fornecedor (preco/estoque/sku/marca)
    ->
Busca Amazon (UPC, depois titulo)
    ->
Pagina do produto Amazon
    ->
Keepa + AZInsight
    ->
Regras de aprovacao (margem, ROI, Amazon vende?, etc)
    ->
Status final (approved/rejected/needs_review/skipped/error)
    ->
Estado salvo + relatorio HTML + mover HTML para Feitos
```

## 4. Fluxo completo ponta a ponta (passo a passo)
1. Inicio pelo runner (`run-fba-from-html.sh`):
Ele recebe parametros como `--mode auto|dry-run|resume|manual`, `--html`, `--batch-size`, `--audit`.
2. Carrega variaveis do `.env`:
Principalmente `FBA_INPUT_DIR`, `FBA_OUTPUT_DIR`, flags de VPN e auditoria.
3. Resolve qual HTML sera usado:
Pode vir de `--html`, do estado antigo (`resume`) ou do arquivo `.html` mais novo encontrado.
4. Copia o HTML para a inbox padrao (quando nao e resume):
Isso deixa a entrada organizada em `/home/bonette/Documentos/fornecedores-produtos`.
5. Valida VPN (se `VPN_REQUIRED=true`):
Confere pais por endpoints de IP. Se pais nao permitido, tenta subir VPN automaticamente.
6. Valida parser antes da execucao principal (quando aplicavel):
Roda `agents/fba/parser.js` para conferir se o HTML esta consistente.
7. Entra no `index.js`:
Inicia log, estado (`storage/state/fba.json`), modo de execucao e trilha de auditoria (se ativada).
8. Le e parseia o HTML:
Extrai linhas da tabela e transforma em produtos validos.
9. Limpa e filtra entradas ruins no parser:
Ignora pagina de listagem/colecao, URL invalida, URL duplicada de fornecedor, linha incompleta etc.
10. Guarda avisos de qualidade:
Exemplo: UPC invalido nao mata o produto, mas marca aviso.
11. Agrupa por dominio de fornecedor:
Serve para metricas e visibilidade do lote.
12. Decide ponto de inicio:
Se `--resume`, continua do ultimo indice salvo; senao zera estado e comeca do zero.
13. Se for `dry-run`:
Nao navega pesado; marca itens como `needs_review`, gera relatorio e finaliza.
14. Se for execucao normal/manual:
Abre Chrome com Puppeteer (perfil real para tentar usar Keepa e AZInsight).
15. Processa em lotes (`FBA_BATCH_SIZE`):
Vai produto por produto dentro de batches para controlar carga.
16. Para cada produto, abre pagina do fornecedor:
Detecta captcha/challenge/bloqueio e tenta fluxo de recuperacao manual quando permitido.
17. Extrai dados do fornecedor:
Titulo, preco atual, preco anterior, status de estoque, SKU, marca, categoria, imagem.
18. Se fornecedor estiver sem estoque:
Produto vira `skipped` com motivo.
19. Se preco nao for encontrado automaticamente:
No modo manual, operador pode digitar preco; se nao tiver preco, vai para `needs_review`.
20. Busca na Amazon:
Primeiro por UPC (se valido), depois por titulo (fallback).
21. Se nao achar resultado na Amazon:
Produto vira `skipped` com motivo claro.
22. Escolhe o melhor match:
Usa primeiro resultado da lista Amazon retornada.
23. Abre pagina do produto Amazon:
Valida bloqueios, espera carregar extensoes (Keepa/AZInsight).
24. Coleta sinais de mercado:
Keepa (sinal de historico) e se Amazon e vendedora direta.
25. Calcula Buy Cost:
`buyCost = supplierPrice + prepFee`.
No codigo atual, `prepFee = 2.00`.
26. Tenta preencher Buy Cost no AZInsight:
Para melhorar calculo de lucro/margem dentro do painel.
27. Extrai dados do AZInsight:
Preco Amazon, taxas FBA, referral fee, lucro estimado, ROI, margem.
28. Aplica regras de negocio (`rules.js`):
Decide `approved`, `rejected` ou `needs_review`.
29. Regras atuais importantes:
`MAX_SUPPLIER_PRICE=80`, `MIN_MARGIN_FBA=10%`, `MIN_ROI=15%`, `MIN_BSR_DROPS=3`, rejeita se Amazon vende.
30. Salva resultado no estado:
Grava por produto em `/home/bonette/openclaw-agents/storage/state/fba.json`.
31. Faz controle de erro:
Se ocorrer erro inesperado, tira screenshot, grava erro, continua.
32. Protecao anti-travamento:
Se bater 5 erros consecutivos, para execucao e pede retomar com `--resume`.
33. Finalizacao:
Gera relatorio HTML com aprovados em `/home/bonette/Documentos/produtos-amazon-lucros`, move HTML processado para `/home/bonette/Documentos/fornecedores-produtos/feitos`, salva estatisticas finais e fecha navegador.

## 5. Entradas, processamento e saidas (visual simples)
1. Entrada:
`/home/bonette/Documentos/fornecedores-produtos/*.html`
2. Processamento:
`parser.js` -> `index.js` -> `browser.js` -> `rules.js`
3. Estado persistente:
`/home/bonette/openclaw-agents/storage/state/fba.json`
4. Logs:
`/home/bonette/openclaw-agents/storage/logs/fba-agent.log`
`/home/bonette/openclaw-agents/storage/logs/fba-browser.log`
`/home/bonette/openclaw-agents/storage/logs/fba-parser.log`
5. Relatorios de saida:
`/home/bonette/Documentos/produtos-amazon-lucros/fba-aprovados-*.html`
`/home/bonette/Documentos/produtos-amazon-lucros/produtos-lucro-*.html`
6. HTML ja processado:
`/home/bonette/Documentos/fornecedores-produtos/feitos/`
7. Screenshots e auditoria (se ativado):
`/home/bonette/openclaw-agents/storage/screenshots/`
`/home/bonette/openclaw-agents/storage/audit/fba/`

## 6. Exemplo real simples (1 produto)
1. Produto entra do HTML com nome + UPC + URL do fornecedor.
2. Parser limpa URL e aceita o item.
3. Agente abre o fornecedor e pega preco, por exemplo `$18.00`.
4. Busca Amazon por UPC e acha item com preco `$39.99`.
5. Abre pagina Amazon, puxa taxas FBA, por exemplo `$8.50`.
6. Calcula `buyCost = 18.00 + 2.00 = 20.00`.
7. Lucro estimado `39.99 - 8.50 - 20.00 = 11.49`.
8. Calcula margem e ROI.
9. Se passar nas regras, marca `approved`.
10. No fim, ele aparece no relatorio HTML de aprovados.

## 7. O que o agente nao faz sozinho
1. Nao garante 100% contra captcha/bloqueio (ele detecta e trata, mas pode precisar acao manual).
2. Nao inventa preco quando nao acha no fornecedor (sem manual, fica para revisao).
3. Nao aprova produto sem dados minimos confiaveis (preco/taxa ausente vira revisao).

## 8. Em qual ordem os modos funcionam
1. `auto`: fluxo completo automatico.
2. `manual`: fluxo completo com prompts para operador decidir/ajudar.
3. `resume`: continua de onde parou no estado salvo.
4. `dry-run`: nao executa navegacao completa; serve para pre-checagem e revisao.

## 9. Conclusao objetiva
1. O agente FBA e um pipeline de triagem e decisao: ele transforma HTML bruto de fornecedor em relatorio de oportunidades aprovadas com base em regra financeira e sinais de marketplace.
2. O foco dele e reduzir trabalho manual, mas mantendo pontos de revisao quando os dados ficam incertos.
