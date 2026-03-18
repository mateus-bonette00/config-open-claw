const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Carrega as variaveis de ambiente
dotenv.config({ path: '/home/bonette/openclaw-agents/.env' });

async function run() {
  function formatHubSpotError(status, statusText, data) {
    if (!data || typeof data !== 'object') {
      return `HTTP ${status} ${statusText}`;
    }

    const baseMsg = data.message || `${statusText || 'Erro desconhecido'}`;
    const scopes = data?.errors?.[0]?.context?.requiredGranularScopes;
    if (Array.isArray(scopes) && scopes.length > 0) {
      return `HTTP ${status} ${statusText} - ${baseMsg}. Scopes exigidos: ${scopes.join(', ')}`;
    }

    return `HTTP ${status} ${statusText} - ${baseMsg}`;
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Uso: node hubspot-upsert.js <company_name> [website] [industry] [phone] [location] [description_and_links]");
    process.exit(1);
  }

  const companyName = args[0];
  const website = args[1] || '';
  const industry = args[2] || '';
  const phone = args[3] || '';
  const location = args[4] || '';
  const notes = args.slice(5).join(' ') || '';

  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) {
    console.error("ERRO: HUBSPOT_API_KEY não encontrada no .env do servidor.");
    process.exit(1);
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  try {
    // Para versao Node muito antiga que nao tenha fetch, tentamos importar dinamicamente
    let fetchFn;
    if (typeof fetch !== 'undefined') {
        fetchFn = fetch;
    } else {
        const fetchMod = await import('node-fetch');
        fetchFn = fetchMod.default;
    }

    // 1. Procurar empresa p/ evitar duplicidade
    const searchUrl = 'https://api.hubapi.com/crm/v3/objects/companies/search';
    const searchQuery = {
      "filterGroups": [{ "filters": [{ "propertyName": "name", "operator": "EQ", "value": companyName }] }],
      "properties": ["name", "domain"]
    };

    const searchRes = await fetchFn(searchUrl, { method: 'POST', headers, body: JSON.stringify(searchQuery) });

    if (!searchRes.ok) {
      let errBody = null;
      try { errBody = await searchRes.json(); } catch (_) {}
      throw new Error(`Falha na busca CRM: ${formatHubSpotError(searchRes.status, searchRes.statusText, errBody)}`);
    }
    const searchData = await searchRes.json();
    
    let objectId = null;
    if (searchData.total > 0) {
      objectId = searchData.results[0].id;
      console.log(`[OK] Empresa '${companyName}' ja existe no CRM (ID: ${objectId}). Procedendo para atualizacao se necessario.`);
    }

    const properties = { name: companyName, domain: website, industry: industry, phone: phone, city: location, description: notes };
    const cleanProps = Object.keys(properties).reduce((acc, k) => {
      if (properties[k] && properties[k].trim() !== '') acc[k] = properties[k];
      return acc;
    }, {});

    if (objectId) {
      // 2. Atualizar empresa
      const updateUrl = `https://api.hubapi.com/crm/v3/objects/companies/${objectId}`;
      const updateRes = await fetchFn(updateUrl, { method: 'PATCH', headers, body: JSON.stringify({ properties: cleanProps }) });
      if (!updateRes.ok) {
        let errBody = null;
        try { errBody = await updateRes.json(); } catch (_) {}
        throw new Error(`Falha no update: ${formatHubSpotError(updateRes.status, updateRes.statusText, errBody)}`);
      }
      console.log(`[SUCESSO] Empresa '${companyName}' (ID: ${objectId}) ATUALIZADA no HubSpot.`);
    } else {
      // 3. Criar empresa
      const createUrl = `https://api.hubapi.com/crm/v3/objects/companies`;
      const createRes = await fetchFn(createUrl, { method: 'POST', headers, body: JSON.stringify({ properties: cleanProps }) });
      if (!createRes.ok) {
        let errBody = null;
        try { errBody = await createRes.json(); } catch (_) {}
        throw new Error(`Falha na criacao: ${formatHubSpotError(createRes.status, createRes.statusText, errBody)}`);
      }
      const createData = await createRes.json();
      console.log(`[SUCESSO] Empresa '${companyName}' CRIADA no HubSpot. ID: ${createData.id}`);
    }
  } catch (err) {
    console.error(`[ERRO FATAL] ${err.message}`);
    process.exit(1);
  }
}
run();
