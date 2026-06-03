// Interpretação por IA (OpenRouter) de comandos de arquivamento em linguagem
// natural: "quais grupos você arquiva?", "arquive o grupo X", "para de salvar o Y",
// "em quais grupos você está?". Devolve uma intenção estruturada que o index.js executa.
import { config } from './config.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// ---- Lógica pura (testável sem rede) ------------------------------------

/** Parse tolerante do JSON da intenção (aceita cercas/lixo ao redor). */
export function parseArchiveIntent(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const i = s.indexOf('{')
  const j = s.lastIndexOf('}')
  if (i !== -1 && j > i) s = s.slice(i, j + 1)
  let o
  try {
    o = JSON.parse(s)
  } catch {
    return { intent: 'none', groupIndex: null, enable: null, reply: '' }
  }
  const intent = ['list_archived', 'list_groups', 'set'].includes(o.intent) ? o.intent : 'none'
  const gi = Number(o.group_index)
  return {
    intent,
    groupIndex: Number.isInteger(gi) && gi > 0 ? gi : null,
    enable: typeof o.enable === 'boolean' ? o.enable : null,
    reply: typeof o.reply === 'string' ? o.reply.trim() : '',
  }
}

/** System prompt: explica a tarefa + lista os grupos disponíveis (com status). */
export function buildArchivePrompt(groups, currentGroupJid) {
  const lines = groups.map((g, i) => {
    const cur = g.jid === currentGroupJid ? ' (ESTE grupo / aqui)' : ''
    return `${i + 1}. ${g.name} [${g.archived ? 'ARQUIVANDO' : 'não'}]${cur}`
  })
  return [
    'Você interpreta comandos sobre o ARQUIVAMENTO de grupos de WhatsApp num bot.',
    'O bot salva os arquivos enviados em certos grupos para o Google Drive ("arquivar"/"salvar").',
    'Dada a mensagem do usuário (português, informal), identifique a intenção.',
    '',
    'Grupos disponíveis (índice. nome [status atual]):',
    lines.length ? lines.join('\n') : '(o bot não está em nenhum grupo)',
    '',
    'Responda APENAS um JSON válido, sem nada fora dele:',
    '{',
    '  "intent": "list_archived" | "list_groups" | "set" | "none",',
    '  "group_index": <número do grupo da lista acima, ou null>,',
    '  "enable": true | false | null,',
    '  "reply": "<frase curta em pt-BR, opcional>"',
    '}',
    '',
    'Regras:',
    '- "quais grupos estão sendo arquivados?", "o que você está salvando?" -> list_archived.',
    '- "quais grupos você está?", "em quais grupos você tá?", "lista seus grupos" -> list_groups.',
    '- "arquive o grupo X", "começa a salvar o X", "ativa o arquivamento do X" -> set, group_index do X, enable=true.',
    '- "para de arquivar o Y", "desativa o Y", "para de salvar o Y" -> set, group_index do Y, enable=false.',
    '- "este grupo", "aqui", "esse grupo" -> use o índice do grupo marcado como (ESTE grupo / aqui).',
    '- Casamento do nome TOLERANTE: ignore acentos, maiúsculas e emojis; aceite nome parcial.',
    '- Se for um "set" mas você não souber qual grupo, use group_index=null e explique no reply.',
    '- Se a mensagem NÃO for sobre arquivamento de grupos, intent="none".',
  ].join('\n')
}

// ---- I/O (chamada ao OpenRouter) ----------------------------------------

async function chat(messages) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Bot Arquivamento WhatsApp',
    },
    body: JSON.stringify({ model: config.expertModel, messages, temperature: 0.1 }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('resposta inesperada do OpenRouter')
  return content
}

/** Interpreta o comando -> { intent, groupIndex, enable, reply }. */
export async function interpretArchiveCommand({ text, groups, currentGroupJid = null }) {
  const messages = [
    { role: 'system', content: buildArchivePrompt(groups, currentGroupJid) },
    { role: 'user', content: text },
  ]
  return parseArchiveIntent(await chat(messages))
}
