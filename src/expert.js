import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config } from './config.js'
import { getPrefs, getHistory } from './expert-store.js'

// O "especialista de IA": recebe o pedido em português, conversa, e decide se
// gera imagem/vídeo (via Higgsfield) ou só responde. O raciocínio é feito pelo
// OpenRouter, guiado pelo playbook (higgsfield-playbook.md) + preferências
// do chat. A saída do modelo é um JSON estruturado que o index.js executa.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const PLAYBOOK_PATH = resolve('higgsfield-playbook.md')

// job_set_types conhecidos (validação leve — evita o CLI falhar com modelo alucinado).
export const IMAGE_MODELS = new Set([
  'nano_banana_2', 'nano_banana_flash', 'nano_banana', 'nano_banana_2_ai_stylist',
  'nano_banana_2_skin_enhancer', 'nano_banana_2_shots', 'flux_2', 'flux_kontext',
  'gpt_image_2', 'imagegen_2_0', 'openai_hazel', 'grok_image', 'text2image_soul_v2',
  'soul_cinematic', 'soul_location', 'seedream_v4_5', 'seedream_v5_lite', 'z_image',
  'kling_omni_image', 'cinematic_studio_2_5', 'image_auto', 'image_background_remover',
  'ms_image', 'marketing_studio_image',
])
export const VIDEO_MODELS = new Set([
  'veo3_1', 'veo3', 'veo3_1_lite', 'kling2_6', 'kling3_0', 'seedance_2_0', 'seedance1_5',
  'minimax_hailuo', 'wan2_7', 'wan2_6', 'grok_video', 'soul_cast', 'draw_to_video',
  'cinematic_studio_3_0', 'cinematic_studio_video', 'cinematic_studio_video_v2',
  'reframe', 'sam_3_video', 'topaz_video', 'marketing_studio_video',
])

// ---- Lógica pura (testável sem rede) ------------------------------------

/** Extrai e normaliza a decisão JSON do modelo. Tolera cercas/lixo ao redor. */
export function parseDecision(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const i = s.indexOf('{')
  const j = s.lastIndexOf('}')
  if (i !== -1 && j > i) s = s.slice(i, j + 1)
  let obj
  try {
    obj = JSON.parse(s)
  } catch {
    // sem JSON válido: trata tudo como uma resposta de conversa
    return { reply: String(raw || '').trim(), action: 'none', model: null, prompt: '', params: {}, useReferenceImage: false, savePrefs: null }
  }
  const action = ['image', 'video'].includes(obj.action) ? obj.action : 'none'
  return {
    reply: typeof obj.reply === 'string' ? obj.reply.trim() : '',
    action,
    model: typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : null,
    prompt: typeof obj.prompt === 'string' ? obj.prompt.trim() : '',
    params: obj.params && typeof obj.params === 'object' ? obj.params : {},
    useReferenceImage: obj.use_reference_image === true,
    savePrefs: obj.save_prefs && typeof obj.save_prefs === 'object' ? obj.save_prefs : null,
  }
}

/** Resolve o modelo final (decisão > preferência do chat > default do config). */
export function resolveModel(action, decision, prefs = {}) {
  const valid = action === 'video' ? VIDEO_MODELS : IMAGE_MODELS
  const candidates = [
    decision.model,
    action === 'video' ? prefs.videoModel : prefs.imageModel,
    action === 'video' ? config.defaultVideoModel : config.defaultImageModel,
  ]
  for (const c of candidates) {
    if (c && valid.has(c)) return c
  }
  return action === 'video' ? config.defaultVideoModel : config.defaultImageModel
}

/** Resolve os parâmetros de geração (decisão > preferência > default). */
export function resolveParams(action, decision, prefs = {}) {
  const d = decision.params || {}
  const out = {}
  const ar = d.aspect_ratio || prefs.aspectRatio
  if (ar) out.aspect_ratio = ar
  if (action === 'image') {
    out.resolution = d.resolution || prefs.resolution || config.defaultImageResolution
  } else if (action === 'video') {
    out.duration = String(d.duration || prefs.duration || config.defaultVideoDuration)
    out.quality = d.quality || prefs.quality || config.defaultVideoQuality
  }
  return out
}

/** Resposta do usuário é um "sim" claro? (confirmação de geração de vídeo) */
export function isAffirmative(text) {
  const t = (text || '').trim()
  if (/[\u{1F44D}✅\u{1F44C}\u{1F197}]/u.test(t)) return true // 👍 ✅ 👌 🆗
  return /^(sim|pode|claro|confirmo?|confirmar|manda|gera|gerar|vai|isso|ok|okay|beleza|blz|bora|positivo|fechou)\b/i.test(t)
}

/** Resposta do usuário é um "não" claro? */
export function isNegative(text) {
  const t = (text || '').trim()
  if (/[\u{1F44E}❌\u{1F6AB}]/u.test(t)) return true // 👎 ❌ 🚫
  return /^(n[ãa]o|cancela|cancelar|deixa|esquece|para|negativo)\b/i.test(t)
}

/** Monta o system prompt: comportamento + playbook + preferências + contexto. */
export function buildSystemPrompt(playbook, prefs = {}, { hasImage = false } = {}) {
  const prefsStr = Object.keys(prefs).length ? JSON.stringify(prefs) : '(nenhuma ainda)'
  return [
    'Você é um ASSISTENTE ESPECIALISTA em geração de imagem e vídeo por IA, integrado a um bot de WhatsApp,',
    'usando a plataforma Higgsfield. Fala português (Brasil), de forma direta e amigável.',
    '',
    'Seu trabalho a cada mensagem: entender o pedido, conversar quando preciso, e decidir se gera mídia.',
    'Você NÃO gera nada você mesmo — apenas devolve uma DECISÃO; o sistema executa a geração.',
    '',
    '## Base de conhecimento (playbook)',
    playbook || '(playbook vazio)',
    '',
    '## Preferências já definidas para ESTE chat',
    prefsStr,
    'Respeite-as como padrão quando o usuário não especificar o contrário.',
    '',
    `## Contexto desta mensagem`,
    hasImage ? 'O usuário ANEXOU uma imagem nesta mensagem (pode servir de referência/edição/primeiro-frame).' : 'Nenhuma imagem anexada nesta mensagem.',
    '',
    '## Formato da resposta (OBRIGATÓRIO)',
    'Responda APENAS com UM objeto JSON válido (sem cercas de código, sem texto fora dele):',
    '{',
    '  "reply": "<mensagem em português para o usuário; SEMPRE preenchida>",',
    '  "action": "image" | "video" | "none",',
    '  "model": "<job_set_type do Higgsfield, ou null para usar o padrão>",',
    '  "prompt": "<prompt de geração em INGLÊS, detalhado; \\"\\" se action=none>",',
    '  "params": { "aspect_ratio": "...", "resolution": "1k|2k|4k", "duration": "4|6|8", "quality": "basic|high|ultra" },',
    '  "use_reference_image": true | false,',
    '  "save_prefs": { "imageModel": "...", "videoModel": "...", "aspectRatio": "...", "resolution": "...", "quality": "...", "duration": "..." } ',
    '}',
    '',
    '## Regras',
    '- action="image" se o usuário quer criar/editar uma imagem; "video" se quer um vídeo; "none" para conversa, dúvidas, sugestões ou quando faltam informações.',
    '- O campo "prompt" é SEMPRE em inglês, detalhado, aplicando as técnicas do playbook. Enriqueça pedidos vagos sem contrariar a intenção.',
    '- "params": para imagem use aspect_ratio e resolution; para vídeo use aspect_ratio, duration e quality. Inclua só o que fizer sentido.',
    '- "model": escolha pelo playbook conforme o objetivo, ou null para usar o padrão do chat. Use os job_set_type EXATOS do playbook.',
    '- "use_reference_image": true só quando há imagem anexada e ela deve ser usada.',
    '- "save_prefs": preencha SOMENTE quando o usuário definir um padrão explícito (ex.: "nesse projeto use sempre GPT Image 2", "vídeos sempre 9:16"). Caso contrário, null.',
    '- "reply": ao gerar imagem, diga o que vai gerar e com qual modelo. Para VÍDEO, NÃO diga que já gerou — o sistema vai confirmar o custo antes; apenas descreva o que será gerado.',
    '- Seja um bom consultor: se o pedido for ambíguo ou puder ficar muito melhor, sugira no "reply" (e pode deixar action="none" para alinhar antes de gastar).',
  ].join('\n')
}

// ---- I/O (chamada ao OpenRouter) ----------------------------------------

async function readPlaybook() {
  try {
    return await readFile(PLAYBOOK_PATH, 'utf8')
  } catch {
    return ''
  }
}

async function chat(messages) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Bot Especialista IA WhatsApp',
    },
    body: JSON.stringify({ model: config.expertModel, messages, temperature: 0.7 }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('Resposta inesperada do OpenRouter')
  return content
}

/**
 * Consulta o especialista. Devolve a decisão já resolvida:
 *   { reply, action, model, prompt, params, useReferenceImage, savePrefs }
 * Em erro, devolve action="none" com um reply amigável.
 */
export async function consultExpert({ jid, userText, hasImage = false }) {
  const [playbook, prefs, history] = await Promise.all([readPlaybook(), getPrefs(jid), getHistory(jid)])
  const messages = [{ role: 'system', content: buildSystemPrompt(playbook, prefs, { hasImage }) }]
  for (const h of history) {
    messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })
  }
  messages.push({ role: 'user', content: userText })

  let decision
  try {
    decision = parseDecision(await chat(messages))
  } catch (err) {
    console.error('Especialista falhou:', err?.message || err)
    return { reply: '❌ Tive um problema pra pensar nisso agora. Tenta de novo daqui a pouco.', action: 'none', model: null, prompt: '', params: {}, useReferenceImage: false, savePrefs: null }
  }

  if (decision.action === 'none') return decision

  return {
    ...decision,
    model: resolveModel(decision.action, decision, prefs),
    params: resolveParams(decision.action, decision, prefs),
  }
}
