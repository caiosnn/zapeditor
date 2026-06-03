// Configurações que mudam em RUNTIME (pela interface web), sem reiniciar o bot.
// O default inicial vem do .env (config); depois o data/settings.json manda.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { config } from './config.js'

const FILE = join('data', 'settings.json')
let state = { archiveEnabled: true, archiveGroups: [] }

export async function initSettings() {
  let saved = {}
  try {
    saved = JSON.parse(await readFile(FILE, 'utf8'))
  } catch {
    /* primeiro uso: cai nos defaults do .env */
  }
  state = {
    archiveEnabled: typeof saved.archiveEnabled === 'boolean' ? saved.archiveEnabled : config.archiveEnabled,
    archiveGroups: Array.isArray(saved.archiveGroups) ? saved.archiveGroups : config.archiveGroups,
  }
}

export function getArchiveEnabled() {
  return state.archiveEnabled
}

export function getArchiveGroups() {
  return [...state.archiveGroups]
}

/** Esse grupo está sendo arquivado agora? (master ligado + grupo na lista) */
export function isGroupArchived(jid) {
  return state.archiveEnabled && state.archiveGroups.includes(jid)
}

/** Liga/desliga o arquivamento de um grupo — persiste e aplica na hora. */
export async function setGroupArchived(jid, on) {
  const set = new Set(state.archiveGroups)
  if (on) set.add(jid)
  else set.delete(jid)
  state.archiveGroups = [...set]
  await persist()
  return state.archiveGroups
}

async function persist() {
  await mkdir('data', { recursive: true })
  await writeFile(FILE, JSON.stringify(state, null, 2))
}
