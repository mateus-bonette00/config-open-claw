# zoe-conhecimento

Agente de RAG (retrieval-augmented generation). **É a única exceção deliberada** à regra do resto do projeto — ver seção 1.3 e 3 do `README.md` raiz: todos os outros agentes são 100% determinísticos, sem chamada a LLM. Este aqui chama um LLM diretamente (Google Gemini), de propósito isolado num agente próprio, num processo separado do `openclaw-zoe.service`, para que uma eventual alucinação ou falha de API não tenha qualquer chance de contaminar a lógica determinística dos outros agentes.

## O que faz

Responde perguntas em linguagem natural sobre o histórico real do projeto (tarefas, produtos FBA analisados, documentação interna), citando as fontes usadas. Se a pergunta sair do que está indexado, a instrução de prompt obriga o modelo a admitir que não sabe, em vez de inventar.

## Comando

```
/zoe-sabe <pergunta>
/pergunta <pergunta>
```

## Setup

1. Gerar uma chave gratuita em <https://aistudio.google.com/apikey>
2. Colar em `.env`: `GOOGLE_GENAI_API_KEY=...`
3. `npm install`
4. `npm run conhecimento:ingest` — indexa o corpus (roda de novo sempre que quiser atualizar a base)

## Corpus indexado hoje

- `storage/state/fba.json` — produtos Amazon analisados
- `storage/state/zoe-tarefas-prioridade.json` — histórico de tarefas
- `storage/state/whatsapp-lembretes.json` (ou `.bak`)
- `storage/state/COMMANDS.md`
- `docs/RUNBOOK.md`, `docs/Guia-Para-Open-Claw.md`

## Arquitetura interna

- `ingest.js` — lê o corpus, gera chunks (granular para JSON de estado, `RecursiveCharacterTextSplitter` para markdown), embeda com `GoogleGenerativeAIEmbeddings` e salva em `storage/state/zoe-conhecimento-index.json` via `StateManager`
- `retriever.js` — cosine similarity manual sobre os embeddings salvos (sem vector store de terceiros — corpus pequeno, busca por força bruta é da ordem de milissegundos)
- `index.js` — `handleSlashCommand({text, phone})`: parse do comando, retrieval, prompt RAG via `ChatPromptTemplate`, resposta via `ChatGoogleGenerativeAI`

## Teste direto (sem WhatsApp)

```bash
node scripts/zoe-conhecimento-command.js "/zoe-sabe quais produtos foram rejeitados e por quê" --phone 553598183459
```

## Pendência fora deste repositório

O roteamento de `/zoe-sabe` para `scripts/zoe-conhecimento-command.js` precisa ser configurado no OpenClaw Gateway (software externo) — isso não é código deste repositório.
