# Change Workflow

## 1) Entender Pedido
- Identificar agente/fluxo impactado.
- Separar fato, hipotese e risco.

## 2) Ler Contexto Certo
- Ler arquivo do agente alvo.
- Ler modulo `core` relacionado.
- Ler script operacional relacionado.

## 3) Aplicar Mudanca Minima
- Evitar refatoracao ampla sem necessidade.
- Priorizar estabilidade.

## 4) Validar
Executar validacao real do que mudou:
- fluxo de agente;
- comando de script associado;
- log/estado esperado.

## 5) Entregar
Relatar:
1. alteracoes;
2. validacoes;
3. pendencias;
4. risco residual;
5. proximo passo.

## Checklist Rapido
- [ ] Sem quebra de compatibilidade de comando.
- [ ] Sem segredo exposto.
- [ ] Sem apagar estado sem autorizacao.
- [ ] Comandos reproduziveis informados.
