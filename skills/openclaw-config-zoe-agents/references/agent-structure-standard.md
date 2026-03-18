# Agent Structure Standard

## Objetivo
Padronizar qualquer criacao ou ajuste de agente.

## Esqueleto Obrigatorio
1. Importar `createLogger`, `StateManager` e `schedule` quando necessario.
2. Definir logger com nome do agente.
3. Definir estado com nome estavel do agente.
4. Validar entrada de funcao publica.
5. Tratar erro e registrar em log.
6. Expor funcoes claras para operacao/teste.

## Padrao Minimo
```js
import { createLogger, StateManager, schedule } from '../../core/index.js';
import { config } from '../../core/secrets.js';

const log = createLogger('nome-agente');
const state = new StateManager('nome-agente');
```

## Estado E Logs
- Persistir estado em checkpoints de recuperacao.
- Evitar escrita excessiva sem necessidade.
- Registrar eventos de inicio, sucesso, erro e resumo.

## Integracoes Externas
- Ler credenciais somente via `config`/`getSecret`.
- Validar presenca de credencial antes da chamada externa.
- Tratar falhas de API com mensagem objetiva.

## Compatibilidade Operacional
- Preservar comandos ja usados no projeto.
- Se criar agente novo, atualizar scripts e docs de operacao quando necessario.
