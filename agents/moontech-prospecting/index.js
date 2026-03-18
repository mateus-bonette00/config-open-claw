import { createLogger, StateManager, schedule } from '../../core/index.js';
import { config } from '../../core/secrets.js';

const log = createLogger('moontech-prospecting');
const state = new StateManager('moontech-prospecting');

/**
 * Agente de Prospecção — Moontech
 *
 * Funcionalidades:
 * - Geração de leads (LinkedIn, Google, bases de dados)
 * - Outreach automatizado via email e WhatsApp
 * - Integração HubSpot CRM (criar contatos, deals, pipeline)
 * - Gestão de pipeline de vendas
 * - Controles de compliance (opt-out, frequência, horários)
 *
 * Requer: HUBSPOT_API_KEY, WHATSAPP_API_*, email SMTP
 */

// Estrutura de lead
function createLead({ name, email, phone, company, source, notes = '' }) {
  return {
    id: `lead-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    name,
    email,
    phone,
    company,
    source, // linkedin, google, referral, website, manual
    notes,
    stage: 'new', // new, contacted, qualified, proposal, negotiation, won, lost
    score: 0,
    optedOut: false,
    contactAttempts: 0,
    lastContact: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// CRUD Leads
export function addLead(data) {
  const lead = createLead(data);
  const leads = state.get('leads', []);
  leads.push(lead);
  state.set('leads', leads);
  log.info(`Lead adicionado: ${lead.name} (${lead.company}) via ${lead.source}`);
  return lead;
}

export function listLeads(filter = {}) {
  let leads = state.get('leads', []);
  if (filter.stage) leads = leads.filter(l => l.stage === filter.stage);
  if (filter.source) leads = leads.filter(l => l.source === filter.source);
  if (filter.notOptedOut) leads = leads.filter(l => !l.optedOut);
  return leads;
}

export function updateLead(id, updates) {
  const leads = state.get('leads', []);
  const idx = leads.findIndex(l => l.id === id);
  if (idx === -1) throw new Error(`Lead não encontrado: ${id}`);
  leads[idx] = { ...leads[idx], ...updates, updatedAt: new Date().toISOString() };
  state.set('leads', leads);
  return leads[idx];
}

// Compliance
const COMPLIANCE_RULES = {
  maxContactsPerDay: 50,
  minDaysBetweenContacts: 3,
  allowedHoursStart: 9,  // 9h
  allowedHoursEnd: 18,    // 18h
  respectOptOut: true
};

function canContact(lead) {
  if (COMPLIANCE_RULES.respectOptOut && lead.optedOut) {
    return { allowed: false, reason: 'Lead optou por não receber contato' };
  }

  if (lead.lastContact) {
    const daysSince = (Date.now() - new Date(lead.lastContact).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < COMPLIANCE_RULES.minDaysBetweenContacts) {
      return { allowed: false, reason: `Último contato há ${daysSince.toFixed(1)} dias (mínimo: ${COMPLIANCE_RULES.minDaysBetweenContacts})` };
    }
  }

  const hour = new Date().getHours();
  if (hour < COMPLIANCE_RULES.allowedHoursStart || hour >= COMPLIANCE_RULES.allowedHoursEnd) {
    return { allowed: false, reason: `Fora do horário permitido (${COMPLIANCE_RULES.allowedHoursStart}h-${COMPLIANCE_RULES.allowedHoursEnd}h)` };
  }

  const todayContacts = state.get('dailyContactCount', 0);
  if (todayContacts >= COMPLIANCE_RULES.maxContactsPerDay) {
    return { allowed: false, reason: `Limite diário atingido (${COMPLIANCE_RULES.maxContactsPerDay})` };
  }

  return { allowed: true };
}

/**
 * HubSpot: cria ou atualiza contato.
 */
async function syncToHubSpot(lead) {
  const apiKey = config.hubspot.apiKey;
  if (!apiKey) {
    log.warn('HubSpot API key não configurada. Pulando sync.');
    return null;
  }

  const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      properties: {
        firstname: lead.name.split(' ')[0],
        lastname: lead.name.split(' ').slice(1).join(' '),
        email: lead.email,
        phone: lead.phone,
        company: lead.company,
        lifecyclestage: lead.stage === 'new' ? 'lead' : 'marketingqualifiedlead',
        hs_lead_status: lead.stage.toUpperCase()
      }
    })
  });

  if (response.status === 409) {
    log.info(`Contato já existe no HubSpot: ${lead.email}`);
    return null;
  }

  if (!response.ok) {
    const err = await response.json();
    log.error(`HubSpot erro: ${JSON.stringify(err)}`);
    return null;
  }

  const result = await response.json();
  log.info(`Contato sincronizado com HubSpot: ${result.id}`);
  return result;
}

/**
 * Cria deal/negócio no HubSpot para lead qualificado.
 */
async function createHubSpotDeal(lead, dealName, amount) {
  const apiKey = config.hubspot.apiKey;
  if (!apiKey) return null;

  const response = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      properties: {
        dealname: dealName,
        amount: amount.toString(),
        dealstage: 'qualifiedtobuy',
        pipeline: 'default'
      }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    log.error(`HubSpot deal erro: ${JSON.stringify(err)}`);
    return null;
  }

  const result = await response.json();
  log.info(`Deal criado no HubSpot: ${result.id} — ${dealName}`);
  return result;
}

// Pipeline report
export function getPipelineReport() {
  const leads = state.get('leads', []);
  const stages = {};
  for (const lead of leads) {
    stages[lead.stage] = (stages[lead.stage] || 0) + 1;
  }
  return {
    total: leads.length,
    byStage: stages,
    optedOut: leads.filter(l => l.optedOut).length,
    todayContacts: state.get('dailyContactCount', 0)
  };
}

// Scheduler
export function startScheduler() {
  // Reset contagem diária à meia-noite
  schedule('moontech-daily-reset', '0 0 * * *', () => {
    state.set('dailyContactCount', 0);
    log.info('Contagem diária de contatos resetada.');
  });

  // Relatório semanal segunda 9h
  schedule('moontech-weekly-report', '0 9 * * 1', () => {
    const report = getPipelineReport();
    log.info(`Relatório semanal: ${JSON.stringify(report)}`);
    // TODO: enviar via WhatsApp/email
  });

  log.info('Scheduler Moontech iniciado.');
}

if (process.argv[1]?.endsWith('moontech-prospecting/index.js')) {
  log.info('Agente Moontech Prospecting iniciado.');
  startScheduler();
}
