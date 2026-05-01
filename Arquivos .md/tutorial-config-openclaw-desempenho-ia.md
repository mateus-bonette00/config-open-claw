# Tutorial simples: Configurar OpenClaw (Controle) para desempenho e escolha de IA

Este tutorial foi feito para **iniciante**. É passo a passo, do começo ao fim, com links diretos e o que clicar.

---

## Etapa 1 — Abrir o painel e confirmar conexão

1. Abra o painel no navegador: [OpenClaw Overview](http://127.0.0.1:18789/overview)
2. No topo da página, confirme:
   - **Status** = `OK`
   - **Gateway URL** aparece

**O que esperar:** status “OK” e painel carregado.  
**Pode dar errado:** página não abre.  
**Como corrigir:** confirme se o OpenClaw está rodando no servidor e recarregue a página.  
**Exemplo:** se a página não abrir, aperte `F5` e tente de novo.

---

## Etapa 2 — Resolver alertas que afetam desempenho

1. Ainda no Overview, veja a área **Attention**.
2. Clique em **“Skills with missing dependencies”**.
3. Vai abrir a página de skills: [OpenClaw Skills](http://127.0.0.1:18789/skills)
4. **Desligue** as skills que você não usa (toggle vermelho → OFF).
5. Para as skills que você usa, finalize a configuração necessária.

**O que esperar:** menos erros e menos custo por falha.  
**Pode dar errado:** não saber qual skill usa.  
**Como corrigir:** desative só as óbvias (ex.: Slack, Discord) e teste.  
**Exemplo:** se você não usa Slack, desligue a skill **slack**.

---

## Etapa 3 — Corrigir Cron Jobs com erro

1. Abra: [OpenClaw Cron Jobs](http://127.0.0.1:18789/cron)
2. Procure jobs com status **Error**.
3. Clique no job e depois em **“Open run chat”** para ver o erro.
4. Se o job não é importante, clique **Disable**.
5. Se o job é importante, ajuste o modelo (Etapa 6) e teste novamente.

**O que esperar:** menos erros e menos gasto de tokens.  
**Pode dar errado:** erro “forbidden” ou sem permissão.  
**Como corrigir:** confira o canal e o token usados pelo job.  
**Exemplo:** um job de “lembrete” que falha pode ser desativado até você corrigir.

---

## Etapa 4 — Verificar se o servidor está online

1. Abra: [OpenClaw Instances](http://127.0.0.1:18789/instances)
2. Veja se o **gateway** aparece como conectado.

**O que esperar:** “srv-desktop” conectado.  
**Pode dar errado:** mostrar “disconnect”.  
**Como corrigir:** reinicie o gateway e clique **Refresh**.  
**Exemplo:** se estiver “disconnect”, clique **Refresh** e aguarde 5 segundos.

---

## Etapa 5 — Configurar a IA padrão (modo mais fácil)

1. Abra: [OpenClaw Agents](http://127.0.0.1:18789/agents)
2. Na aba **Overview**, encontre **“Primary model (default)”**.
3. Escolha um modelo na lista.
4. Em **“Fallbacks”**, coloque outro modelo como backup.
5. Clique **Save**.

**O que esperar:** todos os agentes usam esse modelo padrão.  
**Pode dar errado:** campo vazio ou sem modelos.  
**Como corrigir:** configure a chave do provedor em **Config > Secrets** (Etapa 8).  
**Exemplo:** escolha um modelo “pro” para qualidade e um “flash/mini” como fallback (se existir).

---

## Etapa 6 — Configurar IA por agente (modo recomendado)

1. Ainda em [OpenClaw Agents](http://127.0.0.1:18789/agents), selecione um agente no topo (ex.: `whatsapp-lembretes`).
2. Se aparecer campo de modelo, escolha o modelo.
3. Clique **Save**.
4. Repita para os demais agentes.

**O que esperar:** cada agente usa o modelo ideal para seu trabalho.  
**Pode dar errado:** não aparecer campo de modelo.  
**Como corrigir:** se não aparece, o agente usa o modelo padrão da Etapa 5.  
**Exemplo recomendado:**  
- `whatsapp-lembretes` → modelo rápido/mais barato  
- `fba-amazon` → modelo mais forte  

---

## Etapa 7 — Ajustar WhatsApp para ficar mais leve

1. Abra: [OpenClaw Channels](http://127.0.0.1:18789/channels)
2. Na seção **WhatsApp**:
   - **Group Policy** = `allowlist`
   - **DM Policy** = `pairing`
3. Ajuste performance:
   - **WhatsApp Message Debounce (ms)** = 200–300  
   - **History Limit** = 5–10  
   - **Text Chunk Limit** = 1000–1500
4. Clique **Save**.

**O que esperar:** menos mensagens repetidas e menos custo.  
**Pode dar errado:** o bot responder “atrasado”.  
**Como corrigir:** diminua o Debounce.  
**Exemplo:** Debounce = 300, History = 8, Chunk = 1200.

---

## Etapa 8 — Configurar chaves de IA (se faltar modelo)

1. Abra: [OpenClaw Config](http://127.0.0.1:18789/config)
2. Vá na aba **Secrets**.
3. Adicione a chave do provedor que você usa.

**O que esperar:** modelos aparecerem na lista.  
**Pode dar errado:** chave inválida.  
**Como corrigir:** confirme no site do provedor se a chave está ativa.  
**Exemplo:** `OPENAI_API_KEY` ou `GOOGLE_API_KEY` (apenas se seu provedor pedir).

---

## Etapa 9 — Ajustar mensagens para reduzir ruído

1. Abra: [OpenClaw Communications](http://127.0.0.1:18789/communications)
2. Em **Messages**:
   - **Ack Reaction Emoji** vazio
   - **Ack Reaction Scope** = off/none
   - **Status Reactions** = OFF
3. Clique **Save**.

**O que esperar:** menos reações automáticas e menos poluição no chat.  
**Pode dar errado:** você sentir falta das reações.  
**Como corrigir:** ative novamente se quiser.  
**Exemplo:** deixe tudo desligado para reduzir ruído.

---

## Etapa 10 — Talk/Áudio (somente se você usa voz)

1. Em [OpenClaw Communications](http://127.0.0.1:18789/communications), clique na aba **Talk**.
2. Preencha:
   - **Talk API Key**
   - **Talk Active Provider**
   - **Talk Model ID**
3. Clique **Save**.

**O que esperar:** voz funcionando quando você usar.  
**Pode dar errado:** áudio não sair.  
**Como corrigir:** confira o provider e o modelo.  
**Exemplo:** se usa ElevenLabs, provider = `elevenlabs`.

---

## Etapa 11 — Ajustar segurança x velocidade de execução

1. Abra: [OpenClaw Nodes](http://127.0.0.1:18789/nodes)
2. Em **Exec approvals**:
   - **Ask** = OFF (mais rápido)
   - **Ask fallback** = Full
3. Clique **Save**.

**O que esperar:** menos travas em tarefas automáticas.  
**Pode dar errado:** você querer aprovar manualmente.  
**Como corrigir:** ligue “Ask” se quiser aprovação.  
**Exemplo:** para cron jobs, deixe OFF.

---

## Etapa 12 — Monitorar se melhorou

1. Abra: [OpenClaw Usage](http://127.0.0.1:18789/usage)
2. Veja:
   - **Error rate** diminuindo
   - **Tokens** reduzindo
3. Clique **Refresh** depois de testar.

**O que esperar:** menos erros e menos custo.  
**Pode dar errado:** erros continuarem altos.  
**Como corrigir:** volte nas etapas 2 e 3 e resolva os jobs/skills com erro.  
**Exemplo:** se o erro cair de 17% para 5%, já melhorou bastante.

---

# Modo Terminal (um comando único)

> **Observação importante:** este comando já aplica **Etapa 6, 7, 9, 10, 11** e **roda a Etapa 12**.  
> **Assunção:** “GPT-5.3 extra high” = `thinking="high"` e “GPT-5.2 Medium” = `thinking="medium"`.  
> Se você quiser outro nível, me diga.

### Comando único (recomendado — cole tudo de uma vez)

```bash
ssh openclaw-server <<'EOF'
set -euo pipefail

OPENCLAW_BIN="$(command -v openclaw)"
if [ -z "$OPENCLAW_BIN" ]; then
  echo "ERRO: openclaw não encontrado no servidor."
  exit 1
fi

# (Opcional) Se você usa voz, preencha aqui:
TALK_PROVIDER=""     # exemplo: elevenlabs
TALK_API_KEY=""      # sua chave
TALK_MODEL_ID=""     # exemplo: eleven_v3
TALK_OUTPUT=""       # exemplo: mp3_44100_128

# 1) Modelos (Etapa 6)
"$OPENCLAW_BIN" config set 'agents.defaults.models["openai/gpt-5.3"].alias' '"gpt-5.3"'
"$OPENCLAW_BIN" config set 'agents.defaults.models["openai/gpt-5.2"].alias' '"gpt-5.2"'
"$OPENCLAW_BIN" config set 'agents.defaults.model.primary' '"openai/gpt-5.2"'
"$OPENCLAW_BIN" config set 'agents.defaults.model.thinkingDefault' '"medium"'

AGENTS_JSON="$("$OPENCLAW_BIN" config get agents.list --json)"
UPDATED_AGENTS="$(printf '%s' "$AGENTS_JSON" | jq '
  map(
    if .id == "fba-amazon" then
      .model = { primary: "openai/gpt-5.3" } |
      .params = (.params // {}) |
      .params.thinking = "high"
    else
      .model = { primary: "openai/gpt-5.2" } |
      .params = (.params // {}) |
      .params.thinking = "medium"
    end
  )
')"
"$OPENCLAW_BIN" config set agents.list "$UPDATED_AGENTS" --strict-json

# 2) WhatsApp (Etapa 7)
"$OPENCLAW_BIN" config set channels.whatsapp.dmPolicy '"pairing"'
"$OPENCLAW_BIN" config set channels.whatsapp.groupPolicy '"allowlist"'
"$OPENCLAW_BIN" config set channels.whatsapp.debounceMs 300
"$OPENCLAW_BIN" config set channels.whatsapp.textChunkLimit 1200
"$OPENCLAW_BIN" config set channels.whatsapp.chunkMode '"length"'
"$OPENCLAW_BIN" config set channels.whatsapp.sendReadReceipts false
"$OPENCLAW_BIN" config set channels.whatsapp.historyLimit 8
"$OPENCLAW_BIN" config set channels.whatsapp.dmHistoryLimit 10
"$OPENCLAW_BIN" config set messages.groupChat.historyLimit 8
"$OPENCLAW_BIN" config set messages.inbound.byChannel.whatsapp 300
"$OPENCLAW_BIN" config set channels.whatsapp.configWrites false

# 3) Mensagens (Etapa 9)
"$OPENCLAW_BIN" config set messages.ackReaction '""'
"$OPENCLAW_BIN" config set messages.ackReactionScope '"group-mentions"'
"$OPENCLAW_BIN" config set messages.statusReactions.enabled false

# 4) Talk/Áudio (Etapa 10)
if [ -n "$TALK_PROVIDER" ]; then
  "$OPENCLAW_BIN" config set talk.provider "\"$TALK_PROVIDER\""
  "$OPENCLAW_BIN" config set talk.apiKey "\"$TALK_API_KEY\""
  "$OPENCLAW_BIN" config set talk.modelId "\"$TALK_MODEL_ID\""
  "$OPENCLAW_BIN" config set talk.outputFormat "\"$TALK_OUTPUT\""
else
  "$OPENCLAW_BIN" config unset talk
fi

# 5) Exec approvals (Etapa 11)
printf '%s' '{"version":1,"defaults":{"security":"full","ask":"off","askFallback":"full","autoAllowSkills":true},"agents":{}}' \
  | "$OPENCLAW_BIN" approvals set --stdin

# 6) Monitorar (Etapa 12)
"$OPENCLAW_BIN" status --usage
EOF
```

**O que esperar:** o comando aplica tudo e mostra o status no final.  
**Pode dar errado:** não ter o `jq` instalado no servidor.  
**Como corrigir:** instale com `sudo apt-get install jq` e rode o comando de novo.  
**Exemplo:** se der erro “jq: command not found”, instale e repita.

---

# Resumo rápido (principais passos)
1. Abrir o painel e confirmar conexão.
2. Resolver alertas de skills e cron jobs com erro.
3. Definir modelo padrão e, se possível, modelo por agente.
4. Ajustar WhatsApp (debounce, history, chunk).
5. Ajustar mensagens e monitorar uso.

---

## Dicas úteis
- **Menos erros = menos custo.** Sempre corrija jobs falhando.
- **Modelo mais forte só para agentes críticos.** O resto pode ser “rápido”.
- **Desative o que não usa.** Skills e recursos desnecessários só gastam mais.
