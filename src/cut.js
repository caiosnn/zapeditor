import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} saiu ${c}: ${err.slice(-300)}`))))
  })
}

/** "HH:MM:SS,mmm" | "HH:MM:SS" | "MM:SS" -> segundos. */
export function tsToSec(str) {
  const m = String(str).match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?/)
  if (!m) return null
  const h = m[1] ? +m[1] : 0
  const ms = m[4] ? +m[4].padEnd(3, '0') : 0
  return h * 3600 + +m[2] * 60 + +m[3] + ms / 1000
}

/** Parseia um SRT em blocos [{ num, start, end, text }]. */
export function parseSrtBlocks(srt) {
  const blocks = []
  for (const block of String(srt).split(/\n\s*\n/)) {
    const tsLine = block.split('\n').find((l) => l.includes('-->'))
    if (!tsLine) continue
    const [a, b] = tsLine.split('-->')
    const start = tsToSec(a)
    const end = tsToSec(b)
    if (start == null || end == null) continue
    blocks.push({ num: blocks.length + 1, start, end })
  }
  return blocks
}

/**
 * Determina o intervalo de corte a partir do texto do usuário.
 * Prioriza timestamps (usa o menor e o maior); senão usa números de bloco.
 */
export function parseCutRange(text, blocks) {
  const tss = [...String(text).matchAll(/(\d{1,2}:\d{2}:\d{2}(?:[,.]\d{1,3})?)/g)]
    .map((m) => tsToSec(m[1]))
    .filter((v) => v != null)
  if (tss.length >= 2) {
    return { start: Math.min(...tss), end: Math.max(...tss) }
  }
  if (blocks?.length) {
    const nums = [...String(text).matchAll(/\b(\d{1,4})\b/g)]
      .map((m) => +m[1])
      .filter((n) => n >= 1 && n <= blocks.length)
    if (nums.length >= 1) {
      const lo = Math.min(...nums)
      const hi = Math.max(...nums)
      return { start: blocks[lo - 1].start, end: blocks[hi - 1].end }
    }
  }
  if (tss.length === 1) return { start: tss[0], end: tss[0] + 30 } // 1 tempo: 30s a partir dele
  return null
}

/** Corta o vídeo entre start e end (segundos) re-encodando p/ corte preciso. */
export async function cutVideo(videoPath, start, end) {
  const dur = Math.max(0.5, end - start)
  const out = join(tmpdir(), `cut-${Date.now()}.mp4`)
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(start), '-i', videoPath, '-t', String(dur),
    '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', out,
  ])
  return out
}
