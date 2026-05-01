#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_SCRIPT="${OPENCLAW_WORKSPACE_COMMAND_PATH:-/home/bonette/.openclaw/workspace/scripts/fba-automation-bot-command.sh}"
BACKUP_SCRIPT="${WORKSPACE_SCRIPT%.sh}.orig.sh"
CONTROL_SCRIPT="${OPENCLAW_LUCAS1_CONTROL_SCRIPT:-/home/bonette/openclaw-agents/scripts/lucas1-control.sh}"
ZOE_TAREFAS_COMMAND_SCRIPT="${OPENCLAW_ZOE_TAREFAS_COMMAND_PATH:-/home/bonette/.openclaw/workspace/scripts/zoe-tarefas-prioridade-command.sh}"
MAIN_WORKSPACE_DIR="${OPENCLAW_MAIN_WORKSPACE_DIR:-/home/bonette/.openclaw/workspace}"
MAIN_AGENTS_PATH="${MAIN_WORKSPACE_DIR}/AGENTS.md"
MAIN_TOOLS_PATH="${MAIN_WORKSPACE_DIR}/TOOLS.md"
MAIN_COMMANDS_PATH="${MAIN_WORKSPACE_DIR}/COMMANDS.md"

log() {
  printf '[install-workspace-lucas1] %s\n' "$*"
}

die() {
  printf '[install-workspace-lucas1][ERRO] %s\n' "$*" >&2
  exit 1
}

mkdir -p "$(dirname "$WORKSPACE_SCRIPT")"

if [[ -f "$WORKSPACE_SCRIPT" ]] && ! grep -q 'LUCAS1 WORKSPACE WRAPPER' "$WORKSPACE_SCRIPT"; then
  cp "$WORKSPACE_SCRIPT" "$BACKUP_SCRIPT"
  chmod +x "$BACKUP_SCRIPT"
  log "Backup do script original criado em $BACKUP_SCRIPT"
fi

[[ -f "$BACKUP_SCRIPT" ]] || die "Script original nao encontrado para fallback em $BACKUP_SCRIPT"

cat > "$WORKSPACE_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail

# LUCAS1 WORKSPACE WRAPPER
ORIGINAL_SCRIPT="$BACKUP_SCRIPT"
LUCAS1_CONTROL_SCRIPT="$CONTROL_SCRIPT"
ZOE_TAREFAS_COMMAND_SCRIPT="$ZOE_TAREFAS_COMMAND_SCRIPT"

trim() {
  local s="\$*"
  s="\${s#\${s%%[![:space:]]*}}"
  s="\${s%\${s##*[![:space:]]}}"
  printf "%s" "\$s"
}

normalize_for_match() {
  local raw="\$1"
  local low
  low="\$(printf "%s" "\$raw" | tr '[:upper:]' '[:lower:]')"
  low="\$(printf "%s" "\$low" | sed -E 's/^[[:space:]]*(zoe(bot)?)[,:]?[[:space:]]+//')"
  printf "%s" "\$(trim "\$low")"
}

run_lucas1_control() {
  local action="\$1"
  [[ -x "\$LUCAS1_CONTROL_SCRIPT" ]] || return 127
  bash "\$LUCAS1_CONTROL_SCRIPT" "\$action"
}

run_zoe_tarefas_command() {
  local raw="\$1"
  local output
  if [[ ! -x "\$ZOE_TAREFAS_COMMAND_SCRIPT" ]]; then
    echo "Nao consegui processar tarefas agora: script nao encontrado em \$ZOE_TAREFAS_COMMAND_SCRIPT."
    return 0
  fi

  if output="\$(bash "\$ZOE_TAREFAS_COMMAND_SCRIPT" "\$raw" 2>&1)"; then
    printf "%s\n" "\$output"
    return 0
  fi

  if [[ -n "\$output" ]]; then
    printf "%s\n" "\$output"
  else
    echo "Falha ao processar comando de tarefas."
  fi
  return 0
}

handle_zoe_tarefas() {
  local raw="\$1"
  local low
  low="\$(normalize_for_match "\$raw")"

  case "\$low" in
    /afazer-ajuda|/afazer-status|/afazer-lista|/afazer-add*|/afazer-feita*|/afazer-remover*|/afazer-mover*)
      run_zoe_tarefas_command "\$raw"
      return \$?
      ;;
  esac

  if [[ "\$low" =~ ^(adiciona|adicionar|inclui|incluir|cria|criar)[[:space:]]+(a[[:space:]]+)?tarefa[[:space:]]+.+$ ]]; then
    run_zoe_tarefas_command "\$raw"
    return \$?
  fi

  if [[ "\$low" =~ ^(adiciona|adicionar|inclui|incluir|cria|criar)[[:space:]]+.+$ ]] && [[ ! "\$low" =~ ^(adiciona|adicionar|inclui|incluir|cria|criar)[[:space:]]+(lembrete|resumo|status) ]]; then
    run_zoe_tarefas_command "\$raw"
    return \$?
  fi

  if [[ "\$low" =~ ^(listar|lista|mostrar|ver)[[:space:]]+((minhas|meus)[[:space:]]+)?(tarefas|afazeres)([[:space:]]+pendentes)?$ || "\$low" =~ ^(listar|lista|mostrar|ver)[[:space:]]+lista[[:space:]]+(de[[:space:]]+)?(tarefas|afazeres)$ || "\$low" =~ ^quais[[:space:]]+sao[[:space:]]+((minhas|meus)[[:space:]]+)?(tarefas|afazeres)([[:space:]]+pendentes)?$ ]]; then
    run_zoe_tarefas_command "\$raw"
    return \$?
  fi

  if [[ "\$low" =~ ^(concluir|conclui|finalizar|finaliza|marcar)[[:space:]]+(a[[:space:]]+)?tarefa[[:space:]]+[0-9]+([[:space:]]+como[[:space:]]+concluida)?$ || "\$low" =~ ^tarefa[[:space:]]+[0-9]+[[:space:]]+concluida$ ]]; then
    run_zoe_tarefas_command "\$raw"
    return \$?
  fi

  if [[ "\$low" =~ ^(remover|remove|excluir|exclui|apagar|apaga)[[:space:]]+(a[[:space:]]+)?tarefa[[:space:]]+[0-9]+$ ]]; then
    run_zoe_tarefas_command "\$raw"
    return \$?
  fi

  if [[ "\$low" =~ 10[[:space:]]*em[[:space:]]*10 ]] && [[ "\$low" =~ (tarefa|afazer|afazeres|lembrete|resumo) ]]; then
    run_zoe_tarefas_command "\$raw"
    return \$?
  fi

  return 1
}

handle_lucas1() {
  local raw="\$1"
  local low
  low="\$(normalize_for_match "\$raw")"

  case "\$low" in
    "/lucas1-iniciar"|"/lucas1-start"|"/iniciar-lucas1"|"inicia o lucas1"|"inicia lucas1"|"iniciar o lucas1"|"iniciar lucas1"|"inicia o agente fba"|"iniciar agente fba"|"inicia fba"|"iniciar fba")
      run_lucas1_control start
      return \$?
      ;;
    "/lucas1-retomar"|"/lucas1-resume"|"/retomar-lucas1"|"retomar lucas1"|"retomar o lucas1"|"continuar lucas1"|"retomar fba")
      run_lucas1_control resume
      return \$?
      ;;
    "/lucas1-parar"|"/lucas1-pausar"|"/parar-lucas1"|"parar lucas1"|"parar o lucas1"|"para o lucas1"|"parar fba"|"parar o fba"|"parar agente fba")
      run_lucas1_control stop
      return \$?
      ;;
    "/lucas1-limpar"|"/lucas1-reset"|"/limpar-lucas1"|"limpar lucas1"|"resetar lucas1")
      run_lucas1_control reset
      return \$?
      ;;
    "/lucas1-reiniciar"|"/lucas1-do-zero"|"/reiniciar-lucas1"|"reiniciar lucas1"|"lucas1 do zero")
      run_lucas1_control restart
      return \$?
      ;;
  esac

  return 1
}

if [[ "\$#" -eq 0 ]]; then
  exec bash "\$ORIGINAL_SCRIPT"
fi

RAW_MSG="\$*"

if handle_zoe_tarefas "\$RAW_MSG"; then
  exit \$?
fi

if handle_lucas1 "\$RAW_MSG"; then
  exit \$?
fi

exec bash "\$ORIGINAL_SCRIPT" "\$@"
EOF

chmod +x "$WORKSPACE_SCRIPT"
log "Wrapper do LUCAS1 instalado em $WORKSPACE_SCRIPT"

mkdir -p "$MAIN_WORKSPACE_DIR"

cat > "$MAIN_AGENTS_PATH" <<EOF
# AGENTS.md

## Regra principal
- Responda em portugues do Brasil.
- Seja direto.
- Para Mateus, chame de Papai.
- Evite texto longo quando uma resposta curta resolver.

## Fonte de comandos
- O arquivo COMMANDS.md e a fonte unica de verdade para todos os comandos da Zoe.
- Ao receber \`/comandos\`, leia e exiba o COMMANDS.md integralmente.
- Ao receber \`/prompts\`, leia os arquivos de prompts do workspace e liste.
- Ao receber \`/codigos\`, leia o CODIGOS_TERMINAL.md e liste.
- Ao receber \`/contatos\`, leia o ALLOWFROM_CONTATOS.md e liste.

## Zoe Afazeres (obrigatorio)
- Se a mensagem comecar com \`/afazer-\` ou for uma frase de tarefas (ex.: "adiciona tarefa pagar boleto", "listar tarefas", "concluir tarefa 2"), execute SEMPRE:
  \`bash ${ZOE_TAREFAS_COMMAND_SCRIPT} "<mensagem original do usuario>"\`
- Nesses casos, responda somente com a saida do script.
- Nunca responda que \`/afazer-*\` nao existe.
- O lembrete automatico de afazeres fica ativo a cada 10 minutos, com silencio entre 21:00 e 07:00 (America/Sao_Paulo).

## FBA automacao
- Para comandos da automacao FBA, use sempre:
  \`bash ${WORKSPACE_SCRIPT} "<mensagem original do usuario>"\`
- Nao invente parametros da automacao.
- Nao transforme ausencia de dado em suposicao.

## Seguranca operacional
- Nao rode comando destrutivo sem necessidade clara.
- Se um comando ja tem script oficial no workspace, use o script oficial.

## Resposta imediata (alta urgencia)
- Se a mensagem for para iniciar FBA (ex.: "inicia o agente fba", "inicia o lucas1", "procura os produtos que dao lucro"), execute o script FBA e responda so com o retorno curto do script: "Iniciado." ou "Ja estava iniciado.".
- Nao adicione explicacao extra nesses casos.
- Para saudacao simples ("oi", "ola", "bom dia", "boa tarde", "boa noite"), responda em 1 linha curta.
- Para \`/comandos\`, mostre o COMMANDS.md direto, sem texto introdutorio.
EOF

cat > "$MAIN_TOOLS_PATH" <<EOF
# TOOLS.md

## Zoe Afazeres
- Script oficial: \`${ZOE_TAREFAS_COMMAND_SCRIPT}\`
- Ajuda: \`bash ${ZOE_TAREFAS_COMMAND_SCRIPT} "/afazer-ajuda"\`
- Status: \`bash ${ZOE_TAREFAS_COMMAND_SCRIPT} "/afazer-status"\`
- Lista: \`bash ${ZOE_TAREFAS_COMMAND_SCRIPT} "/afazer-lista"\`
- Adicionar: \`bash ${ZOE_TAREFAS_COMMAND_SCRIPT} "/afazer-add Pagar boleto"\`
- Concluir: \`bash ${ZOE_TAREFAS_COMMAND_SCRIPT} "/afazer-feita 1"\`
- Remover: \`bash ${ZOE_TAREFAS_COMMAND_SCRIPT} "/afazer-remover 1"\`

## FBA automacao
- Script oficial do bot: \`${WORKSPACE_SCRIPT}\`
- Backend API: \`http://127.0.0.1:8001/api/automation/bot/command\`
- Log principal: \`/home/bonette/apps/fba-automation/backend/logs/automation_run.log\`
- Exportacoes: \`/home/bonette/apps/fba-automation/backend/exports/ARQUIVOS XLSX\`

## Comandos uteis FBA
- Status: \`bash ${WORKSPACE_SCRIPT} "status automacao"\`
- Listar perfis: \`bash ${WORKSPACE_SCRIPT} "listar automacoes"\`
- Parar: \`bash ${WORKSPACE_SCRIPT} "parar automacao"\`
EOF

cat > "$MAIN_COMMANDS_PATH" <<'EOF'
# Comandos da Zoe

## Comandos gerais

- `/comandos` -> mostra TODOS os comandos desta lista, integralmente.
- `Zoe, o que voce faz?` -> resume as capacidades da Zoe.

## Prompts salvos

- `/prompts` -> lista todos os prompts salvos disponiveis.
- `/prompt <nome>` -> mostra o conteudo do prompt especificado.
- `/salvar-prompt <nome>` -> salva o texto que o usuario enviar como um novo prompt no arquivo `prompts/<nome>.md`.
- `/deletar-prompt <nome>` -> apaga o prompt especificado.

Arquivos de prompts ficam em:
- `PROMPT_FORNECEDOR_MARCA_ESPECIFICA.md` (raiz do workspace)
- `prompts/PROMPT_PARA_CATEGORIAS.md`
- Novos prompts salvos via `/salvar-prompt` vao para a pasta `prompts/`.

## Codigos de terminal (Linux)

- `/codigos` -> lista todos os codigos/comandos de terminal salvos.
- `/salvar-codigo <nome> <comando>` -> salva um novo codigo de terminal.
- `/deletar-codigo <nome>` -> apaga o codigo especificado.
- `/rodar-codigo <nome>` -> executa o codigo salvo no terminal do servidor.

Arquivo de referencia: `CODIGOS_TERMINAL.md`

## Zoe Afazeres (novo)

- `/afazer-ajuda` -> mostra a ajuda dos comandos de tarefas.
- `/afazer-status` -> mostra status do lembrete automatico.
- `/afazer-lista` -> mostra lista atual em ordem de cadastro.
- `/afazer-add <tarefa>` -> adiciona tarefa no fim da lista.
- `/afazer-feita <posicao>` -> conclui a tarefa da posicao.
- `/afazer-remover <posicao>` -> remove a tarefa da posicao.
- Lembrete automatico: envio da lista a cada 10 minutos entre 07:00 e 20:59.
- Silencio noturno: nao envia entre 21:00 e 07:00 (America/Sao_Paulo).

Frases naturais aceitas:
- `adiciona tarefa pagar boleto`
- `listar tarefas`
- `concluir tarefa 2`
- `remover tarefa 3`

## Lembretes antigos (compatibilidade)

- `Zoe, me lembra de <assunto> em <data/hora>` -> cria um lembrete agendado.
- `Zoe, me lembra de <assunto> todo dia as <hora>` -> cria lembrete recorrente diario.
- `Zoe, listar lembretes` -> lista todos os lembretes e tarefas agendadas.
- `Zoe, cancelar lembrete <descricao ou id>` -> cancela um lembrete especifico.
- `Zoe, cancelar todos os lembretes` -> cancela todos os lembretes ativos.

Obs: o fuso horario e America/Sao_Paulo. Informe data e hora normalmente (ex: "amanha as 9h", "sexta as 15h30").

## Contatos (AllowFrom)

- `/contatos` -> lista os contatos autorizados no WhatsApp.

Arquivo de referencia: `ALLOWFROM_CONTATOS.md`

## Pro-saude (Arte para redes sociais)

- `Zoe, criar arte pro-saude <descricao>` -> delega criacao de arte ao agente prosaude-social.
- `Zoe, post pro-saude <tema>` -> gera arte e texto para publicacao.

Obs: envie imagens de referencia ja sem fundo (PNG transparente).

## Moontech (Prospeccao comercial)

- `Zoe, prospectar leads <criterios>` -> delega busca e prospeccao ao agente moontech-prospecting.
- `Zoe, buscar empresas <segmento>` -> busca empresas no segmento especificado.
- `Zoe, enviar proposta <empresa>` -> inicia fluxo de envio comercial (sempre com dry-run antes).

Obs: nenhum disparo comercial e feito sem confirmacao explicita do Papai.

## Regras internas (para a Zoe)

- Ao receber `/comandos`, exibir TODOS os comandos desta lista, sem omitir nenhuma secao.
- Todo novo comando implementado deve ser adicionado neste arquivo.
- Este arquivo e a fonte unica de verdade dos comandos da Zoe.
- Nao inventar comandos que nao estejam aqui.
- Para `/prompts`, ler os arquivos de prompt do workspace e listar os nomes disponiveis.
- Para `/codigos`, ler o arquivo CODIGOS_TERMINAL.md e listar os codigos salvos.
EOF

log "AGENTS.md principal atualizado em $MAIN_AGENTS_PATH"
log "TOOLS.md principal atualizado em $MAIN_TOOLS_PATH"
log "COMMANDS.md principal atualizado em $MAIN_COMMANDS_PATH"
