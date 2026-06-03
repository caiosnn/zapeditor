import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

// Memória do agente especialista, por chat (um JSON por conversa em data/expert/):
//   - prefs:   padrões definidos conversando ("nesse projeto use sempre GPT Image 2")
//   - history: últimas mensagens (contexto da conversa) — cortado em MAX_HISTORY
// Cache em memória + write-through em disco (sobrevive a reinício do bot).

const DIR = resolve('data', 'expert')
const MAX_HISTORY = 20 // mensagens (user+assistant) mantidas por chat

const cache = new Map() // jid -> { prefs, history }

export async function initExpertStore() {
  await mkdir(DIR, { recursive: true })
}

function fileFor(jid) {
  const safe = String(jid).replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(DIR, `${safe}.json`)
}

async function load(jid) {
  if (cache.has(jid)) return cache.get(jid)
  let state = { prefs: {}, history: [] }
  try {
    const parsed = JSON.parse(await readFile(fileFor(jid), 'utf8'))
    state = { prefs: parsed?.prefs || {}, history: Array.isArray(parsed?.history) ? parsed.history : [] }
  } catch {
    // ainda não existe arquivo para este chat
  }
  cache.set(jid, state)
  return state
}

async function persist(jid) {
  const state = cache.get(jid)
  if (!state) return
  try {
    await mkdir(DIR, { recursive: true })
    await writeFile(fileFor(jid), JSON.stringify(state))
  } catch {
    // persistência é best-effort; o estado em memória segue válido
  }
}

/** Estado completo do chat: { prefs, history }. */
export async function getChatState(jid) {
  return load(jid)
}

/** Só as preferências do chat. */
export async function getPrefs(jid) {
  return (await load(jid)).prefs
}

/** Merge das preferências. null/''/undefined = não mexe (limpeza via clearPrefs). */
export async function setPrefs(jid, partial) {
  const state = await load(jid)
  if (partial && typeof partial === 'object') {
    for (const [k, v] of Object.entries(partial)) {
      if (v === null || v === undefined || v === '') continue
      state.prefs[k] = v
    }
    await persist(jid)
  }
  return state.prefs
}

/** Limpa todas as preferências do chat. */
export async function clearPrefs(jid) {
  const state = await load(jid)
  state.prefs = {}
  await persist(jid)
}

/** Adiciona uma mensagem ao histórico (mantém só as últimas MAX_HISTORY). */
export async function appendHistory(jid, role, content) {
  const state = await load(jid)
  state.history.push({ role, content: String(content ?? '').slice(0, 4000), ts: Date.now() })
  if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY)
  await persist(jid)
}

/** Histórico do chat (array de {role, content, ts}). */
export async function getHistory(jid) {
  return (await load(jid)).history
}

/** Apaga o histórico do chat (mantém as prefs). */
export async function resetHistory(jid) {
  const state = await load(jid)
  state.history = []
  await persist(jid)
}
