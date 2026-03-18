import fs from 'fs';
import path from 'path';
import { createLogger, StateManager } from '../../core/index.js';
import { config } from '../../core/secrets.js';

const log = createLogger('prosaude-social');
const state = new StateManager('prosaude-social');

/**
 * Agente de Social Media — Pró-saúde
 *
 * Pipeline:
 * 1. Recebe imagem + nome do produto via WhatsApp ("Pró-saúde Zap")
 * 2. Remove fundo da imagem (rembg ou remove.bg API)
 * 3. Compõe imagem no template da marca
 * 4. Adiciona texto do nome do produto
 * 5. (Opcional) Envia para aprovação manual
 * 6. Publica no Instagram e Facebook via Meta Graph API
 *
 * Requer: META_ACCESS_TOKEN, META_PAGE_ID, INSTAGRAM_ACCOUNT_ID
 */

const TEMPLATE_DIR = path.resolve('config/prosaude-templates');
const OUTPUT_DIR = path.resolve('storage/prosaude-output');

/**
 * Remove fundo de uma imagem usando rembg (Python) ou remove.bg API.
 * Requer: pip install rembg ou REMOVEBG_API_KEY no .env
 */
export async function removeBackground(inputPath, outputPath) {
  log.info(`Removendo fundo: ${inputPath}`);

  // Opção 1: rembg local (Python)
  const { execSync } = await import('child_process');
  try {
    execSync(`rembg i "${inputPath}" "${outputPath}"`, { timeout: 60000 });
    log.info(`Fundo removido: ${outputPath}`);
    return outputPath;
  } catch (err) {
    log.warn('rembg não disponível, tentando remove.bg API...');
  }

  // Opção 2: remove.bg API
  const apiKey = process.env.REMOVEBG_API_KEY;
  if (!apiKey) {
    throw new Error('Nem rembg nem REMOVEBG_API_KEY disponíveis para remoção de fundo.');
  }

  const formData = new FormData();
  formData.append('image_file', new Blob([fs.readFileSync(inputPath)]));
  formData.append('size', 'auto');

  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: formData
  });

  if (!response.ok) throw new Error(`remove.bg erro: ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  log.info(`Fundo removido via API: ${outputPath}`);
  return outputPath;
}

/**
 * Compõe a imagem do produto no template da marca.
 * Usa sharp para composição (ou canvas).
 *
 * TODO: Implementar composição real com sharp quando template estiver definido.
 * Por ora, salva a imagem sem fundo como output.
 */
export async function composeOnTemplate(productImagePath, productName, templateName = 'default') {
  const outputPath = path.join(OUTPUT_DIR, `${Date.now()}-${productName.replace(/\s+/g, '_')}.png`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // TODO: quando template estiver pronto, usar sharp para:
  // 1. Carregar template PNG
  // 2. Sobrepor imagem do produto (centralizada ou posição definida)
  // 3. Adicionar texto do nome do produto (fonte, cor, posição)
  // 4. Exportar PNG final

  // Placeholder: copiar imagem sem fundo
  fs.copyFileSync(productImagePath, outputPath);
  log.info(`Imagem composta (placeholder): ${outputPath}`);
  return outputPath;
}

/**
 * Publica imagem no Instagram via Meta Graph API (Container + Publish).
 */
export async function publishToInstagram(imagePath, caption) {
  const accessToken = config.meta.accessToken;
  const igAccountId = config.meta.instagramAccountId;

  if (!accessToken || !igAccountId) {
    throw new Error('META_ACCESS_TOKEN e INSTAGRAM_ACCOUNT_ID necessários para publicar no Instagram.');
  }

  log.info(`Publicando no Instagram: ${caption.substring(0, 50)}...`);

  // Passo 1: Criar container (imagem precisa ser URL pública)
  // TODO: Upload para CDN/hosting primeiro, ou usar imagem URL
  // Por ora, assume que a imagem já está em URL pública
  const imageUrl = imagePath; // Substituir por URL pública real

  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${igAccountId}/media?` +
    `image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${accessToken}`,
    { method: 'POST' }
  );

  if (!containerRes.ok) {
    const err = await containerRes.json();
    throw new Error(`Instagram container erro: ${JSON.stringify(err)}`);
  }

  const { id: containerId } = await containerRes.json();

  // Passo 2: Publicar
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${igAccountId}/media_publish?` +
    `creation_id=${containerId}&access_token=${accessToken}`,
    { method: 'POST' }
  );

  if (!publishRes.ok) {
    const err = await publishRes.json();
    throw new Error(`Instagram publish erro: ${JSON.stringify(err)}`);
  }

  const result = await publishRes.json();
  log.info(`Publicado no Instagram: ${result.id}`);
  return result;
}

/**
 * Publica no Facebook Page via Graph API.
 */
export async function publishToFacebook(imagePath, message) {
  const accessToken = config.meta.accessToken;
  const pageId = config.meta.pageId;

  if (!accessToken || !pageId) {
    throw new Error('META_ACCESS_TOKEN e META_PAGE_ID necessários para publicar no Facebook.');
  }

  log.info(`Publicando no Facebook: ${message.substring(0, 50)}...`);

  // Upload de foto diretamente
  const imageBuffer = fs.readFileSync(imagePath);
  const formData = new FormData();
  formData.append('source', new Blob([imageBuffer]), 'produto.png');
  formData.append('message', message);
  formData.append('access_token', accessToken);

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Facebook publish erro: ${JSON.stringify(err)}`);
  }

  const result = await res.json();
  log.info(`Publicado no Facebook: ${result.id}`);
  return result;
}

/**
 * Pipeline completo: imagem → remover fundo → template → publicar
 */
export async function processAndPublish({ imagePath, productName, caption, approve = true }) {
  log.info(`Processando produto: ${productName}`);

  // 1. Remover fundo
  const noBgPath = imagePath.replace(/\.\w+$/, '-nobg.png');
  await removeBackground(imagePath, noBgPath);

  // 2. Compor no template
  const composedPath = await composeOnTemplate(noBgPath, productName);

  // 3. Aprovação manual (se ativado)
  if (approve) {
    const pendingPosts = state.get('pendingApproval', []);
    pendingPosts.push({
      id: `post-${Date.now()}`,
      productName,
      imagePath: composedPath,
      caption,
      status: 'pending_approval',
      createdAt: new Date().toISOString()
    });
    state.set('pendingApproval', pendingPosts);
    log.info(`Post aguardando aprovação manual. Imagem: ${composedPath}`);
    return { status: 'pending_approval', imagePath: composedPath };
  }

  // 4. Publicar
  const igResult = await publishToInstagram(composedPath, caption);
  const fbResult = await publishToFacebook(composedPath, caption);

  return { status: 'published', instagram: igResult, facebook: fbResult };
}

if (process.argv[1]?.endsWith('prosaude-social/index.js')) {
  log.info('Agente Pró-saúde Social Media iniciado.');
  log.info('Aguardando mensagens do WhatsApp com imagem + nome do produto...');
  // TODO: integrar com webhook do WhatsApp para receber mensagens
}
