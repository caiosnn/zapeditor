import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Guarda os vídeos transcritos em disco, indexados pelo ID da mensagem de
// transcrição — assim o CORTE funciona mesmo depois de reiniciar o bot.
const DIR = resolve('data', 'cuts')
const INDEX = join(DIR, 'index.json')
const TTL = 6 * 60 * 60 * 1000 // 6h

let index = {}

async function persist() {
  try {
    await writeFile(INDEX, JSON.stringify(index))
  } catch {
    // ignora
  }
}

export async function initCutStore() {
  await mkdir(DIR, { recursive: true })
  try {
    index = JSON.parse(await readFile(INDEX, 'utf8'))
  } catch {
    index = {}
  }
  const now = Date.now()
  for (const id of Object.keys(index)) {
    if (now - (index[id]?.ts || 0) > TTL) {
      await rm(join(DIR, `${id}.mp4`), { force: true }).catch(() => {})
      delete index[id]
    }
  }
  await persist()
}

/** Salva o vídeo (indexado pelo ID da mensagem de transcrição) + seus blocos. */
export async function saveCut(messageId, videoBuffer, blocks) {
  if (!messageId) return
  await mkdir(DIR, { recursive: true })
  await writeFile(join(DIR, `${messageId}.mp4`), videoBuffer)
  index[messageId] = { blocks, ts: Date.now() }
  await persist()
}

/** Recupera { videoPath, blocks } pelo ID da mensagem de transcrição. */
export function getCut(messageId) {
  if (!messageId) return null
  const e = index[messageId]
  if (!e || Date.now() - e.ts > TTL) return null
  const videoPath = join(DIR, `${messageId}.mp4`)
  if (!existsSync(videoPath)) return null
  return { videoPath, blocks: e.blocks }
}
