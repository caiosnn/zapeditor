// Interpretação por IA (OpenRouter) dos comandos da biblioteca de edições:
//   "esse é o compilado da campanha"  -> save
//   "manda o corte do debate"         -> fetch
//   "o que tem em compilados?"        -> list
// Devolve uma intenção estruturada { intent, category, name, reply } que o index.js executa.
import { config } from './config.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// ---- Lógica pura (testável sem rede) ------------------------------------

/** Parse tolerante do JSON da intenção (aceita cercas/lixo ao redor). */
export function parseEditIntent(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const i = s.indexOf('{')
  const j = s.lastIndexOf('}')
  if (i !== -1 && j > i) s = s.slice(i, j + 1)
  let o
  try {
    o = JSON.parse(s)
  } catch {
    return { intent: 'none', category: '', name: '', reply: '' }
  }
  const intent = ['save', 'fetch', 'list'].includes(o.intent) ? o.intent : 'none'
  return {
    intent,
    category: typeof o.category === 'string' ? o.category.trim() : '',
    name: typeof o.name === 'string' ? o.name.trim() : '',
    reply: typeof o.reply === 'string' ? o.reply.trim() : '',
  }
}

/** System prompt: explica a tarefa, o contexto (tem vídeo?) e as categorias existentes. */
export function buildEditPrompt({ hasVideo, categories = [] }) {
  return [
    'Você organiza uma biblioteca de vídeos de uma equipe de edição, num bot de WhatsApp.',
    'Os vídeos ficam em pastas por CATEGORIA. Categorias comuns: Brutos (vídeo bruto/cru),',
    'Cortes (um corte/clipe) e Compilados (vários trechos juntos). A equipe pode criar QUALQUER',
    'outra categoria (ex.: Bastidores, Lives).',
    '',
    hasVideo
      ? 'CONTEXTO: a mensagem veio COM UM VÍDEO anexado (provável intenção de GUARDAR).'
      : 'CONTEXTO: a mensagem veio SEM vídeo (provável intenção de PEDIR/RECUPERAR ou listar).',
    categories.length ? `Categorias que já existem: ${categories.join(', ')}.` : '',
    '',
    'Dada a mensagem (português, informal), responda APENAS um JSON válido, sem nada fora dele:',
    '{',
    '  "intent": "save" | "fetch" | "list" | "none",',
    '  "category": "<categoria: Compilados | Cortes | Brutos | livre, ou vazio>",',
    '  "name": "<nome/assunto do vídeo, sem a categoria, ou vazio>",',
    '  "reply": "<frase curta em pt-BR, opcional>"',
    '}',
    '',
    'Regras:',
    '- "esse é o compilado da campanha", "salva como corte do debate", "guarda esse bruto" -> save.',
    '- "manda o compilado X", "me envia o corte do debate", "pega o bruto Y" -> fetch.',
    '- "o que tem em cortes?", "quais compilados você tem?", "lista os brutos" -> list.',
    '- category: a pasta (compilado->Compilados, corte->Cortes, bruto->Brutos, ou o nome livre).',
    '- name: só o assunto do vídeo (ex.: "campanha da saúde", "debate"). NUNCA inclua a categoria no name.',
    '- Casamento TOLERANTE: ignore acentos e maiúsculas.',
    '- Se a mensagem NÃO for sobre guardar/recuperar/listar vídeo, intent="none".',
  ]
    .filter(Boolean)
    .join('\n')
}

// ---- I/O (chamada ao OpenRouter) ----------------------------------------

async function chat(messages) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Bot Edições WhatsApp',
    },
    body: JSON.stringify({ model: config.expertModel, messages, temperature: 0.1 }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('resposta inesperada do OpenRouter')
  return content
}

/** Interpreta o comando -> { intent, category, name, reply }. */
export async function interpretEditCommand({ text, hasVideo, categories = [] }) {
  const messages = [
    { role: 'system', content: buildEditPrompt({ hasVideo, categories }) },
    { role: 'user', content: text },
  ]
  return parseEditIntent(await chat(messages))
}
