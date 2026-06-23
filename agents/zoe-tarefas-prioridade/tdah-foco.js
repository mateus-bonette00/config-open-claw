import fs from 'fs';
import path from 'path';

const TDAH_STATE_KEY = 'tdah';
const DEFAULT_DASHBOARD_URL = 'http://127.0.0.1:3456/central-tdah/';
const MAX_DOPAMINA_HISTORY = 12;
const FOCUS_CHECKIN_MINUTES = 20;
const FOCUS_TOTAL_MINUTES = 30;

const DOPAMINA_STATE_CATALOG = [
  { key: 'sem_energia', label: 'Sem energia', aliases: ['sem energia'] },
  { key: 'travado', label: 'Travado', aliases: ['travado', 'travada'] },
  { key: 'disperso', label: 'Disperso', aliases: ['disperso', 'dispersa'] },
  { key: 'entediado', label: 'Entediado', aliases: ['entediado', 'entediada'] },
  { key: 'ansioso', label: 'Ansioso', aliases: ['ansioso', 'ansiosa'] },
  { key: 'dificuldade_comecar', label: 'Com dificuldade de comecar', aliases: ['dificuldade de comecar', 'com dificuldade de comecar'] },
  { key: 'procrastinando', label: 'Procrastinando', aliases: ['procrastinando'] },
  { key: 'sem_vontade', label: 'Sem vontade de fazer nada', aliases: ['sem vontade de fazer nada', 'sem vontade'] }
];

const DOPAMINA_MICRO_STEPS = {
  sem_energia: 'Beba agua agora e sente no local da tarefa.',
  travado: 'Abra a tarefa e pare na primeira linha.',
  disperso: 'Feche 1 aba que nao e da tarefa.',
  entediado: 'Abra a tarefa e escolha so 1 parte pequena.',
  ansioso: 'Respire 3 vezes e abra a tarefa.',
  procrastinando: 'Ative timer de 1 minuto e abra a tarefa.',
  dificuldade_comecar: 'Abra apenas o arquivo inicial.',
  sem_vontade: 'Sente e abra a tarefa por 1 minuto.'
};

const DOPAMINA_STATE_LIST = DOPAMINA_STATE_CATALOG.map(item => `- ${item.label}`);

const FALLBACK_PROMPTS = {
  travado: {
    titulo: 'Destravar tarefa',
    descricao: 'Quebra uma tarefa travada em micro-passos.',
    prompt_base: 'Aja com linguagem curta e entregue so o primeiro micro-passo.',
    exemplo: '/tdah-travado -> "Primeiro passo: abra o arquivo e me responda: feito".',
    resposta_curta: 'Primeiro passo de menos de 1 minuto e pedido de resposta curta.'
  },
  organizar: {
    titulo: 'Organizar cabeca',
    descricao: 'Organiza pendencias em Agora, Depois e Lixo.',
    prompt_base: 'Classifique de forma simples e entregue so o proximo passo do Agora.',
    exemplo: '/tdah-organizar',
    resposta_curta: 'Lista curta e uma acao agora.'
  },
  foco: {
    titulo: 'Sessao foco',
    descricao: 'Cria sessao de foco de 30 minutos com check-in.',
    prompt_base: 'Tom direto, primeiro passo simples e check-ins curtos.',
    exemplo: '/tdah-foco',
    resposta_curta: 'Abrir a tarefa + responder aberto/feito.'
  },
  dopamina: {
    titulo: 'Cardapio de dopamina',
    descricao: 'Gera menu de ativacao com 15+20+10 minutos.',
    prompt_base: 'Variar opcoes por estado emocional e terminar com micro-passo.',
    exemplo: '/tdah-dopamina',
    resposta_curta: '3 blocos curtos + primeiro passo + feito.'
  },
  jogo: {
    titulo: 'Tarefa em missao',
    descricao: 'Transforma tarefa chata em missao com etapas e pontos.',
    prompt_base: 'Etapas simples, pontuacao curta e recompensa final.',
    exemplo: '/tdah-jogo',
    resposta_curta: 'Missao com 3 a 5 etapas.'
  },
  tempo: {
    titulo: 'Tempo real',
    descricao: 'Mostra etapas escondidas e estimativa realista.',
    prompt_base: 'Evite lista gigante e entregue estimativa curta.',
    exemplo: '/tdah-tempo',
    resposta_curta: 'Etapas escondidas + tempo realista.'
  },
  transicao: {
    titulo: 'Transicao rapida',
    descricao: 'Ajuda na troca de tarefa em 3 minutos.',
    prompt_base: 'Fechar, anotar pendencia, abrir nova e iniciar micro-passo.',
    exemplo: '/tdah-transicao',
    resposta_curta: 'Checklist curto de transicao.'
  },
  limpeza: {
    titulo: 'Limpeza mental',
    descricao: 'Organiza incomodos em resolver agora/depois/ignorar.',
    prompt_base: 'Entregar apenas o essencial e 1 primeira acao.',
    exemplo: '/tdah-limpeza',
    resposta_curta: 'Classificacao curta e acao simples.'
  },
  afazeres: {
    titulo: 'Afazeres com foco TDAH',
    descricao: 'Reorganiza afazeres em Fazer agora/depois/So lembrar.',
    prompt_base: 'Sugira micro-passo e comando recomendado.',
    exemplo: '/tdah-afazeres',
    resposta_curta: 'Priorizacao curta com primeiro passo.'
  }
};

const FALLBACK_LEMBRETES = {
  manha: [
    'Comece leve: escolha 1 tarefa e abra o material.',
    'Se travar, use /tdah-travado.'
  ],
  tarde: [
    'Pausa curta e volta: use /tdah-foco para 30 minutos guiados.'
  ],
  noite: [
    'Feche o dia com 1 micro-passo para amanha.'
  ],
  lembrete_horario_afazeres: [
    'Lembrete de foco:',
    'Tarefa principal: {task}',
    'Primeiro passo: {microStep}',
    'Se travar: /tdah-travado',
    'Foco acompanhado: /tdah-foco'
  ]
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function toPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function shuffle(list) {
  const cloned = [...list];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = cloned[i];
    cloned[i] = cloned[j];
    cloned[j] = temp;
  }
  return cloned;
}

function splitItems(input) {
  const normalized = String(input || '')
    .replace(/\r/g, '\n')
    .replace(/[;]+/g, ',');

  const rawItems = normalized
    .split(/\n|,/)
    .map(item => normalizeText(item))
    .filter(Boolean);

  return [...new Set(rawItems)];
}

function humanizeActionTitle(title) {
  const trimmed = normalizeText(title);
  if (!trimmed) return 'essa tarefa';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function guessMicroStep(taskTitle) {
  const comparable = normalizeForMatch(taskTitle);
  if (!comparable) return 'Abra apenas o que voce precisa para comecar.';
  if (/\bestud|curso|aula|ia|n8n|ler\b/.test(comparable)) return 'Abra apenas o material de estudo.';
  if (/\bcurricul|cv\b/.test(comparable)) return 'Abra apenas o arquivo do curriculo.';
  if (/\bemail|e-mail|gmail\b/.test(comparable)) return 'Abra apenas sua caixa de entrada.';
  if (/\bplanilha|excel|sheet\b/.test(comparable)) return 'Abra apenas a planilha da tarefa.';
  if (/\bdocument|contrato|boleto|imposto|fgts\b/.test(comparable)) return 'Abra apenas o documento principal.';
  if (/\borganizar|arrumar|limpar\b/.test(comparable)) return 'Separe so 1 item para organizar agora.';
  if (/\bsite|codigo|projeto|deploy|openclaw\b/.test(comparable)) return 'Abra apenas o arquivo principal do projeto.';
  return `Abra apenas o ponto inicial de "${humanizeActionTitle(taskTitle)}".`;
}

function buildStepsFromTask(taskTitle, count = 4) {
  const base = humanizeActionTitle(taskTitle);
  const options = [
    `Abrir o material de ${base}.`,
    `Separar o que voce precisa para ${base}.`,
    `Fazer so a primeira parte de ${base}.`,
    `Fechar com uma anotacao do proximo passo de ${base}.`,
    `Conferir apenas 1 ponto essencial de ${base}.`
  ];
  return shuffle(options).slice(0, Math.max(3, Math.min(count, 5)));
}

function estimateHiddenSteps(taskTitle) {
  const generic = [
    'Abrir o material certo.',
    'Separar informacoes e arquivos.',
    'Executar a primeira parte.',
    'Revisar e salvar.',
    'Anotar proximo passo.'
  ];

  const comparable = normalizeForMatch(taskTitle);
  const custom = [];

  if (/\bemail|e-mail\b/.test(comparable)) {
    custom.push('Escolher qual email responder primeiro.');
    custom.push('Ler contexto antes de escrever.');
  }
  if (/\bestud|curso|aula|ia|n8n\b/.test(comparable)) {
    custom.push('Escolher apenas 1 topico.');
    custom.push('Separar bloco curto para pratica.');
  }
  if (/\bcurricul|cv|linkedin\b/.test(comparable)) {
    custom.push('Escolher so 1 secao para editar.');
  }

  const merged = [...custom, ...generic];
  return [...new Set(merged)].slice(0, 4);
}

function resolveProjectRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}

function loadJson(filePath, fallbackValue, log, label) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    log.error(`Erro ao carregar ${label}: ${err.message}`);
    return fallbackValue;
  }
}

function loadTdahData(log) {
  const projectRoot = resolveProjectRoot();
  const dataDir = path.join(projectRoot, 'data', 'tdah');
  const prompts = loadJson(path.join(dataDir, 'prompts.json'), FALLBACK_PROMPTS, log, 'prompts TDAH');
  const lembretes = loadJson(path.join(dataDir, 'lembretes.json'), FALLBACK_LEMBRETES, log, 'lembretes TDAH');
  const dopamina = loadJson(path.join(dataDir, 'dopamina.json'), {}, log, 'dopamina TDAH');
  return { prompts, lembretes, dopamina };
}

function getTdahRoot(state) {
  const current = state.get(TDAH_STATE_KEY, {});
  const safe = current && typeof current === 'object' ? { ...current } : {};
  if (!safe.users || typeof safe.users !== 'object') safe.users = {};
  return safe;
}

function getUserState(root, phone) {
  const user = root.users[phone];
  if (user && typeof user === 'object') return { ...user };
  return {
    status: 'idle',
    context: {},
    focusSession: null,
    dopaminaHistory: {}
  };
}

function saveUserState(state, root, phone, userState) {
  root.users[phone] = {
    status: userState.status || 'idle',
    context: userState.context && typeof userState.context === 'object' ? userState.context : {},
    focusSession: userState.focusSession || null,
    dopaminaHistory: userState.dopaminaHistory && typeof userState.dopaminaHistory === 'object' ? userState.dopaminaHistory : {}
  };
  state.set(TDAH_STATE_KEY, root);
}

function clearUserFlow(state, root, phone, userState) {
  const cleared = {
    ...userState,
    status: 'idle',
    context: {},
    focusSession: null
  };
  saveUserState(state, root, phone, cleared);
  return cleared;
}

function isActiveStatus(status) {
  return Boolean(status && status !== 'idle');
}

function resolveDopaminaState(rawInput) {
  const comparable = normalizeForMatch(rawInput);
  for (const stateEntry of DOPAMINA_STATE_CATALOG) {
    for (const alias of stateEntry.aliases) {
      if (comparable === normalizeForMatch(alias)) return stateEntry;
    }
  }
  return null;
}

function formatTdahMenu() {
  return [
    'Central de Foco TDAH',
    '',
    'Escolha uma opcao:',
    '/tdah-travado',
    '/tdah-organizar',
    '/tdah-foco',
    '/tdah-dopamina',
    '/tdah-jogo',
    '/tdah-tempo',
    '/tdah-transicao',
    '/tdah-limpeza',
    '/tdah-afazeres',
    '/tdah-html'
  ].join('\n');
}

function chooseWithoutRecent(options, recent = [], count = 5) {
  const validOptions = toArray(options).map(item => normalizeText(item)).filter(Boolean);
  if (!validOptions.length) return [];

  const uniqueValid = [...new Set(validOptions)];
  const recentSet = new Set(toArray(recent).map(item => normalizeText(item)));
  const fresh = uniqueValid.filter(item => !recentSet.has(item));
  const chosen = [];

  for (const item of shuffle(fresh)) {
    if (chosen.length >= count) break;
    chosen.push(item);
  }

  if (chosen.length < count) {
    for (const item of shuffle(uniqueValid)) {
      if (chosen.length >= count) break;
      if (!chosen.includes(item)) chosen.push(item);
    }
  }

  return chosen;
}

function updateRecentHistory(history, usedItems) {
  const merged = [...toArray(usedItems), ...toArray(history)];
  const deduped = [];
  for (const item of merged) {
    const normalized = normalizeText(item);
    if (!normalized || deduped.includes(normalized)) continue;
    deduped.push(normalized);
    if (deduped.length >= MAX_DOPAMINA_HISTORY) break;
  }
  return deduped;
}

function formatNumberedList(items) {
  if (!items.length) return '- sem opcao cadastrada';
  return items.map(item => `- ${item}`).join('\n');
}

function buildDopaminaCard({
  userState,
  selectedState,
  dopaminaData
}) {
  const stateData = dopaminaData[selectedState.key] || {};
  const userHistory = userState.dopaminaHistory?.[selectedState.key] || {};

  const activities = chooseWithoutRecent(stateData.atividades_15min, userHistory.atividades_15min, 5);
  const blocks = chooseWithoutRecent(stateData.blocos_20min, userHistory.blocos_20min, 5);
  const pauses = chooseWithoutRecent(stateData.pausas_10min, userHistory.pausas_10min, 5);
  const firstStep = DOPAMINA_MICRO_STEPS[selectedState.key] || 'Abra apenas o ponto inicial da tarefa.';

  return {
    message: [
      'Cardapio de Dopamina',
      '',
      `Estado: ${selectedState.label}`,
      '',
      '1. Atividade rapida, 15 minutos:',
      'Escolha uma:',
      formatNumberedList(activities),
      '',
      '2. Bloco de trabalho, 20 minutos:',
      'Escolha uma:',
      formatNumberedList(blocks),
      '',
      '3. Pausa criativa, 10 minutos:',
      'Escolha uma:',
      formatNumberedList(pauses),
      '',
      'Primeiro passo agora:',
      firstStep,
      '',
      'Depois responda:',
      'feito'
    ].join('\n'),
    used: {
      atividades_15min: activities,
      blocos_20min: blocks,
      pausas_10min: pauses
    }
  };
}

function buildAfazeresTdahMessage(tasks) {
  const normalizedTasks = toArray(tasks).filter(task => normalizeText(task?.title));
  if (!normalizedTasks.length) return null;

  const sorted = [...normalizedTasks].sort((a, b) => {
    const order = ['P0', 'P1', 'P2', 'P3', 'P4'];
    const left = order.indexOf(String(a.priority || 'P2').toUpperCase());
    const right = order.indexOf(String(b.priority || 'P2').toUpperCase());
    return left - right;
  });

  const agora = sorted.filter(task => ['P0', 'P1'].includes(String(task.priority || '').toUpperCase())).slice(0, 3);
  const depois = sorted.filter(task => ['P2', 'P3'].includes(String(task.priority || '').toUpperCase())).slice(0, 4);
  const lembrar = sorted.filter(task => String(task.priority || '').toUpperCase() === 'P4').slice(0, 4);

  const principal = agora[0] || sorted[0];
  const firstStep = guessMicroStep(principal.title);
  const command = ['P0', 'P1'].includes(String(principal.priority || '').toUpperCase()) ? '/tdah-foco' : '/tdah-travado';

  const formatSection = (title, list) => {
    if (!list.length) return `${title}:\n- sem itens`;
    return `${title}:\n${list.map((task, index) => `${index + 1}. ${task.title}`).join('\n')}`;
  };

  return [
    'Seus afazeres com foco TDAH:',
    '',
    formatSection('Fazer agora', agora),
    '',
    `Primeiro passo da principal: ${firstStep}`,
    'Tempo sugerido: 20 minutos',
    `Use: ${command}`,
    '',
    formatSection('Fazer depois', depois),
    '',
    formatSection('So lembrar', lembrar)
  ].join('\n');
}

function classifyItemsForOrganize(items) {
  const agora = [];
  const depois = [];
  const lixo = [];

  const urgenteRegex = /(hoje|agora|prazo|boleto|imposto|documento|cliente|urgente|reuniao|pagamento)/;
  const lixoRegex = /(talvez|futuro|ideia solta|depois vejo|qualquer dia|sem pressa)/;

  for (const item of items) {
    const comparable = normalizeForMatch(item);
    if (urgenteRegex.test(comparable) && agora.length < 3) {
      agora.push(item);
      continue;
    }
    if (lixoRegex.test(comparable)) {
      lixo.push(item);
      continue;
    }
    if (depois.length < 5) {
      depois.push(item);
      continue;
    }
    lixo.push(item);
  }

  while (agora.length < 1 && depois.length > 0) {
    agora.push(depois.shift());
  }

  return { agora, depois, lixo };
}

function formatOrganizedMentalMap({ agora, depois, lixo }, firstStepLabel = 'Proximo passo agora') {
  const nowItem = agora[0];
  const nowStep = nowItem ? guessMicroStep(nowItem) : 'Escolha 1 item e abra agora.';
  const render = (items) => (items.length ? items.map((item, idx) => `${idx + 1}. ${item}`).join('\n') : '- sem itens');

  return [
    'Organizacao rapida:',
    '',
    'Agora:',
    render(agora),
    '',
    'Depois:',
    render(depois),
    '',
    'Lixo:',
    render(lixo),
    '',
    `${firstStepLabel}:`,
    nowStep,
    '',
    'Me responda: feito'
  ].join('\n');
}

function buildTransicaoMessage(previousTask, nextTask) {
  const nextStep = guessMicroStep(nextTask);
  return [
    'Transicao de 3 minutos:',
    '1. Feche a tarefa anterior.',
    `2. Anote 1 pendencia de "${humanizeActionTitle(previousTask)}".`,
    '3. Respire fundo e beba agua.',
    `4. Abra a nova tarefa: "${humanizeActionTitle(nextTask)}".`,
    `5. Primeiro micro-passo: ${nextStep}`,
    '',
    'Depois me responda: feito'
  ].join('\n');
}

function buildDopaminaStateQuestion() {
  return [
    'Como voce esta agora?',
    '',
    ...DOPAMINA_STATE_LIST
  ].join('\n');
}

function handleTdahCommand({
  command,
  phone,
  userState,
  root,
  state,
  log,
  getTasks,
  dashboardUrl,
  prompts,
  dopaminaData
}) {
  const cleanedCommand = normalizeForMatch(command);
  const setStatus = (status, context = {}) => {
    const nextUser = { ...userState, status, context };
    saveUserState(state, root, phone, nextUser);
  };

  if (cleanedCommand === '/tdah' || cleanedCommand === '/tdah-menu') {
    clearUserFlow(state, root, phone, userState);
    return { handled: true, response: formatTdahMenu() };
  }

  if (cleanedCommand === '/tdah-cancelar') {
    clearUserFlow(state, root, phone, userState);
    return { handled: true, response: 'Fluxo TDAH cancelado. Envie /tdah para abrir o menu.' };
  }

  if (cleanedCommand === '/tdah-html') {
    clearUserFlow(state, root, phone, userState);
    return {
      handled: true,
      response: [
        'Central TDAH:',
        dashboardUrl || DEFAULT_DASHBOARD_URL
      ].join('\n')
    };
  }

  if (cleanedCommand === '/tdah-travado') {
    setStatus('aguardando_tarefa_travada');
    return { handled: true, response: 'Qual tarefa esta travada?' };
  }

  if (cleanedCommand === '/tdah-organizar') {
    setStatus('aguardando_despejo_mental');
    return { handled: true, response: 'Despeje tudo que esta na sua cabeca agora. Pode mandar em lista curta.' };
  }

  if (cleanedCommand === '/tdah-foco') {
    setStatus('aguardando_tarefa_foco');
    return { handled: true, response: 'No que voce quer focar pelos proximos 30 minutos?' };
  }

  if (cleanedCommand === '/tdah-jogo') {
    setStatus('aguardando_tarefa_chata');
    return { handled: true, response: 'Qual tarefa esta chata agora?' };
  }

  if (cleanedCommand === '/tdah-tempo') {
    setStatus('aguardando_tarefa_tempo');
    return { handled: true, response: 'Qual tarefa voce acha que vai ser rapida?' };
  }

  if (cleanedCommand === '/tdah-transicao') {
    setStatus('aguardando_transicao_tarefa_anterior');
    return { handled: true, response: 'Qual tarefa voce acabou de finalizar?' };
  }

  if (cleanedCommand === '/tdah-limpeza') {
    setStatus('aguardando_limpeza_mental');
    return { handled: true, response: 'Escreva tudo que esta te incomodando agora.' };
  }

  if (cleanedCommand === '/tdah-afazeres') {
    try {
      const tasks = toArray(getTasks()).filter(task => task?.status !== 'feita');
      const message = buildAfazeresTdahMessage(tasks);
      if (message) {
        clearUserFlow(state, root, phone, userState);
        return { handled: true, response: message };
      }
      setStatus('aguardando_afazeres_manual');
      return {
        handled: true,
        response: 'Nao consegui ler afazeres agora. Cole seus afazeres, 1 por linha, que eu organizo.'
      };
    } catch (err) {
      log.error(`Erro ao buscar afazeres para TDAH: ${err.message}`);
      setStatus('aguardando_afazeres_manual');
      return {
        handled: true,
        response: 'Nao consegui ler afazeres agora. Cole seus afazeres, 1 por linha, que eu organizo.'
      };
    }
  }

  if (cleanedCommand === '/tdah-dopamina') {
    setStatus('aguardando_estado_dopamina');
    return {
      handled: true,
      response: buildDopaminaStateQuestion()
    };
  }

  if (cleanedCommand === '/tdah-prompts') {
    const available = Object.keys(prompts || {});
    clearUserFlow(state, root, phone, userState);
    return {
      handled: true,
      response: `Prompts TDAH carregados: ${available.join(', ')}`
    };
  }

  return { handled: false };
}

function handleTdahContinuation({
  input,
  phone,
  userState,
  root,
  state,
  log,
  getTasks,
  dopaminaData
}) {
  const comparable = normalizeForMatch(input);

  if (comparable === 'cancelar' || comparable === 'cancel') {
    clearUserFlow(state, root, phone, userState);
    return {
      handled: true,
      response: 'Fluxo TDAH cancelado. Se quiser, mande /tdah para abrir o menu.'
    };
  }

  const status = userState.status;
  const context = userState.context || {};

  if (status === 'aguardando_tarefa_travada') {
    const step = guessMicroStep(input);
    clearUserFlow(state, root, phone, userState);
    return {
      handled: true,
      response: [
        'Primeiro passo:',
        step,
        '',
        'Nao faca o resto agora.',
        'So esse passo.',
        '',
        'Depois me responda: feito'
      ].join('\n')
    };
  }

  if (status === 'aguardando_despejo_mental') {
    const items = splitItems(input);
    const organized = classifyItemsForOrganize(items);
    clearUserFlow(state, root, phone, userState);
    return { handled: true, response: formatOrganizedMentalMap(organized, 'Proximo passo pratico') };
  }

  if (status === 'aguardando_tarefa_foco') {
    const taskTitle = normalizeText(input) || 'tarefa atual';
    const microStep = guessMicroStep(taskTitle);
    const session = {
      id: `foco-${Date.now()}`,
      taskTitle,
      startedAtMs: Date.now(),
      startedAt: nowIso(),
      checkin20Sent: false,
      finishedSent: false
    };
    const nextUser = {
      ...userState,
      status: 'em_sessao_foco',
      context: {},
      focusSession: session
    };
    saveUserState(state, root, phone, nextUser);
    log.info(`Inicio de sessao foco TDAH para ${phone}: ${taskTitle}`);

    return {
      handled: true,
      response: [
        'Beleza.',
        `Comece agora: ${microStep}`,
        'Nao finalize tudo.',
        'So abra e comecar.',
        '',
        'Me responda: aberto'
      ].join('\n')
    };
  }

  if (status === 'em_sessao_foco') {
    return {
      handled: true,
      response: [
        'Perfeito.',
        'Continue no foco.',
        `Eu te chamo em ${FOCUS_CHECKIN_MINUTES} minutos para atualizar.`
      ].join('\n')
    };
  }

  if (status === 'aguardando_tarefa_chata') {
    const taskTitle = normalizeText(input);
    const steps = buildStepsFromTask(taskTitle, 4);
    const firstStep = guessMicroStep(taskTitle);
    clearUserFlow(state, root, phone, userState);
    return {
      handled: true,
      response: [
        `Missao: ${humanizeActionTitle(taskTitle)}`,
        '',
        'Etapas:',
        ...steps.map((step, idx) => `${idx + 1}. ${step}`),
        '',
        `Pontuacao: ${steps.length * 10} pontos (10 por etapa).`,
        'Recompensa final: pausa leve de 10 minutos sem redes sociais.',
        '',
        `Primeiro passo: ${firstStep}`,
        '',
        'Depois me responda: feito'
      ].join('\n')
    };
  }

  if (status === 'aguardando_tarefa_tempo') {
    const hidden = estimateHiddenSteps(input);
    const estimate = Math.max(25, hidden.length * 8 + 8);
    clearUserFlow(state, root, phone, userState);
    return {
      handled: true,
      response: [
        'Etapas que voce pode estar esquecendo:',
        ...hidden.map(item => `- ${item}`),
        '',
        `Estimativa mais realista: ${estimate} a ${estimate + 15} minutos.`,
        'Comece pelo primeiro passo de menos de 1 minuto:',
        guessMicroStep(input)
      ].join('\n')
    };
  }

  if (status === 'aguardando_transicao_tarefa_anterior') {
    const nextUser = {
      ...userState,
      status: 'aguardando_transicao_tarefa_nova',
      context: { previousTask: normalizeText(input) || 'tarefa anterior' }
    };
    saveUserState(state, root, phone, nextUser);
    return {
      handled: true,
      response: 'Qual tarefa voce vai iniciar agora?'
    };
  }

  if (status === 'aguardando_transicao_tarefa_nova') {
    const previousTask = context.previousTask || 'tarefa anterior';
    const nextTask = normalizeText(input) || 'nova tarefa';
    clearUserFlow(state, root, phone, userState);
    return {
      handled: true,
      response: buildTransicaoMessage(previousTask, nextTask)
    };
  }

  if (status === 'aguardando_limpeza_mental') {
    const items = splitItems(input);
    const organized = classifyItemsForOrganize(items);
    clearUserFlow(state, root, phone, userState);
    return {
      handled: true,
      response: formatOrganizedMentalMap(
        { agora: organized.agora, depois: organized.depois, lixo: organized.lixo },
        'Primeira acao simples'
      )
        .replace('Agora:', 'Resolver agora:')
        .replace('Depois:', 'Resolver depois:')
        .replace('Lixo:', 'Ignorar por enquanto:')
    };
  }

  if (status === 'aguardando_afazeres_manual') {
    const manualTasks = splitItems(input).map(title => ({ title, priority: 'P2' }));
    clearUserFlow(state, root, phone, userState);
    const message = buildAfazeresTdahMessage(manualTasks);
    return {
      handled: true,
      response: message || 'Nao consegui organizar. Tente colar em linhas separadas.'
    };
  }

  if (status === 'aguardando_estado_dopamina') {
    const selectedState = resolveDopaminaState(input);
    if (!selectedState) {
      return {
        handled: true,
        response: [
          'Nao entendi o estado.',
          'Escolha uma opcao da lista:',
          ...DOPAMINA_STATE_LIST
        ].join('\n')
      };
    }

    const card = buildDopaminaCard({
      userState,
      selectedState,
      dopaminaData
    });

    const userHistory = userState.dopaminaHistory && typeof userState.dopaminaHistory === 'object'
      ? { ...userState.dopaminaHistory }
      : {};
    const stateHistory = userHistory[selectedState.key] || {};

    userHistory[selectedState.key] = {
      atividades_15min: updateRecentHistory(stateHistory.atividades_15min, card.used.atividades_15min),
      blocos_20min: updateRecentHistory(stateHistory.blocos_20min, card.used.blocos_20min),
      pausas_10min: updateRecentHistory(stateHistory.pausas_10min, card.used.pausas_10min)
    };

    const nextUser = clearUserFlow(state, root, phone, userState);
    nextUser.dopaminaHistory = userHistory;
    saveUserState(state, root, phone, nextUser);
    return { handled: true, response: card.message };
  }

  log.info(`Estado TDAH ativo sem match explicito para ${phone}: ${status}`);
  return {
    handled: true,
    response: 'Estou no fluxo TDAH. Responda o passo atual ou digite: cancelar'
  };
}

export function handleTdahRouting({
  text,
  phone,
  state,
  log,
  getTasks,
  dashboardUrl
}) {
  const input = normalizeText(text);
  if (!input) return { handled: false };

  const safePhone = toPhone(phone);
  const root = getTdahRoot(state);
  const userState = getUserState(root, safePhone);
  const { prompts, dopamina } = loadTdahData(log);
  const isTdahCommand = normalizeForMatch(input).startsWith('/tdah');
  const isSlashCommand = input.startsWith('/');

  const active = isActiveStatus(userState.status);
  if (active && !isTdahCommand && !isSlashCommand) {
    return handleTdahContinuation({
      input,
      phone: safePhone,
      userState,
      root,
      state,
      log,
      getTasks,
      dopaminaData: dopamina
    });
  }

  if (!isTdahCommand) return { handled: false };

  const commandResult = handleTdahCommand({
    command: input,
    phone: safePhone,
    userState,
    root,
    state,
    log,
    getTasks,
    dashboardUrl,
    prompts,
    dopaminaData: dopamina
  });

  if (commandResult.handled) {
    log.info(`Comando TDAH usado por ${safePhone}: ${input}`);
  }
  return commandResult;
}

export function hasTdahActiveState({ state, phone }) {
  const safePhone = toPhone(phone);
  const root = getTdahRoot(state);
  const user = getUserState(root, safePhone);
  return isActiveStatus(user.status);
}

export async function processTdahFocusSessions({
  state,
  log,
  sendWhatsAppMessage
}) {
  const root = getTdahRoot(state);
  const users = root.users || {};
  const nowMs = Date.now();
  let changed = false;

  const entries = Object.entries(users);
  for (const [phone, user] of entries) {
    if (!user || user.status !== 'em_sessao_foco' || !user.focusSession) continue;

    const session = { ...user.focusSession };
    const elapsedMinutes = (nowMs - Number(session.startedAtMs || nowMs)) / 60000;

    if (elapsedMinutes >= FOCUS_CHECKIN_MINUTES && !session.checkin20Sent) {
      try {
        await sendWhatsAppMessage(phone, [
          'Check-in rapido do foco:',
          `Ja passaram ${FOCUS_CHECKIN_MINUTES} minutos.`,
          'Me atualize em 1 linha: avancou em que ponto?'
        ].join('\n'));
        session.checkin20Sent = true;
        changed = true;
      } catch (err) {
        log.error(`Erro ao enviar check-in de foco TDAH para ${phone}: ${err.message}`);
      }
    }

    if (elapsedMinutes >= FOCUS_TOTAL_MINUTES && !session.finishedSent) {
      try {
        await sendWhatsAppMessage(phone, [
          'Fim da sessao de foco (30 min).',
          'O que voce concluiu?',
          'Se quiser continuar, use: /tdah-foco'
        ].join('\n'));
        session.finishedSent = true;
        user.status = 'idle';
        user.context = {};
        user.focusSession = null;
        user.lastFocusFinishedAt = nowIso();
        changed = true;
        log.info(`Fim de sessao foco TDAH para ${phone}`);
      } catch (err) {
        log.error(`Erro ao finalizar sessao foco TDAH para ${phone}: ${err.message}`);
      }
    } else {
      user.focusSession = session;
    }

    users[phone] = user;
  }

  if (changed) {
    root.users = users;
    state.set(TDAH_STATE_KEY, root);
  }
}

export function buildTdahReminderBlock({ tasks, state, log }) {
  const data = loadTdahData(log);
  const templateLines = toArray(data.lembretes?.lembrete_horario_afazeres);
  const activeTasks = toArray(tasks).filter(task => task?.status !== 'feita');
  if (!activeTasks.length) return '';

  const sorted = [...activeTasks].sort((a, b) => {
    const order = ['P0', 'P1', 'P2', 'P3', 'P4'];
    return order.indexOf(String(a.priority || 'P2').toUpperCase()) - order.indexOf(String(b.priority || 'P2').toUpperCase());
  });

  const mainTask = sorted[0];
  const microStep = guessMicroStep(mainTask.title);
  const phone = toPhone(
    process.env.WHATSAPP_TAREFAS_OWNER_PHONE ||
    process.env.WHATSAPP_AFAZERES_OWNER_PHONE ||
    process.env.WHATSAPP_LEMBRETES_OWNER_PHONE ||
    process.env.WHATSAPP_REMINDER_DEFAULT_PHONE ||
    '553598183459'
  );

  const activeTdah = hasTdahActiveState({ state, phone });
  const fallbackLines = [
    'Lembrete de foco:',
    `Tarefa principal sugerida: ${mainTask.title}`,
    `Primeiro passo: ${microStep}`,
    'Se travar, use: /tdah-travado',
    'Foco acompanhado: /tdah-foco'
  ];

  const sourceLines = templateLines.length ? templateLines : fallbackLines;
  const replaced = sourceLines.map(line => normalizeText(line)
    .replace('{task}', mainTask.title)
    .replace('{microStep}', microStep));

  if (activeTdah) {
    replaced.push('Fluxo TDAH ativo agora: responda o passo atual ou mande cancelar.');
  }

  return replaced.join('\n');
}
