// Anti-duplicado: guarda os IDs de mensagem já arquivados, pra não subir 2x
// quando o WhatsApp reentrega mensagens (acontece ao reconectar).
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const DIR = 'data'
const FILE = join(DIR, 'archive-index.json')
const seen = new Set()

export async function initArchiveStore() {
  try {
    const raw = JSON.parse(await readFile(FILE, 'utf8'))
    for (const id of raw.ids || []) seen.add(id)
  } catch {
    /* primeiro uso: índice ainda não existe */
  }
}

export function wasArchived(id) {
  return !!id && seen.has(id)
}

export async function markArchived(id) {
  if (!id) return
  seen.add(id)
  try {
    await mkdir(DIR, { recursive: true })
    await writeFile(FILE, JSON.stringify({ ids: [...seen] }))
  } catch (err) {
    console.error('Não consegui salvar o índice de arquivamento:', err?.message || err)
  }
}
