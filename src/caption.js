import { spawn } from 'node:child_process'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { extractAudio } from './audio.js'
import { transcribeWords } from './whisper.js'
import { correctWords } from './transcribe.js'

const STUDIO = resolve('caption-studio')
const PUB = resolve('caption-studio', 'public')
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx'

let queue = Promise.resolve() // serializa: uma renderização por vez

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts })
    let err = ''
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('error', rej)
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} saiu ${c}: ${err.slice(-400)}`))))
  })
}

/** Mede a resolução do vídeo com ffprobe (confiável). */
function probeDims(file) {
  return new Promise((resolve) => {
    const p = spawn(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
      { windowsHide: true }
    )
    let out = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.on('error', () => resolve(null))
    p.on('close', () => {
      const [w, h] = out.trim().split(',').map(Number)
      resolve(w && h ? { width: w, height: h } : null)
    })
  })
}

/** Vídeo -> palavras com tempo (Whisper) já corrigidas (Gemini ouvindo o áudio). */
export async function transcribeForCaption(videoBuffer) {
  const { audio, cleanup } = await extractAudio(videoBuffer, 'mp4')
  try {
    const raw = await transcribeWords(audio)
    return await correctWords(raw, audio)
  } finally {
    await cleanup()
  }
}

function wordsToCaptions(words) {
  return words.map((w) => ({
    text: ' ' + w.word,
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
    timestampMs: Math.round(((w.start + w.end) / 2) * 1000),
    confidence: 1,
  }))
}

async function renderOnce(videoBuffer, words) {
  await writeFile(join(PUB, 'input.mp4'), videoBuffer)
  await writeFile(join(PUB, 'input.json'), JSON.stringify(wordsToCaptions(words)), 'utf8')
  // mede a resolução real e passa pro Remotion (getVideoMetadata às vezes erra a altura)
  const dims = await probeDims(join(PUB, 'input.mp4'))
  await writeFile(join(PUB, 'dims.json'), JSON.stringify(dims || {}), 'utf8')

  const stamp = Date.now()
  const rawOut = join(tmpdir(), `cap-raw-${stamp}.mp4`)
  const finalOut = join(tmpdir(), `cap-${stamp}.mp4`)
  // shell:true é necessário no Windows p/ spawnar npx.cmd (Node 24); rawOut em tmpdir (sem espaços).
  await run(NPX, ['remotion', 'render', 'CaptionedVideo', rawOut, '--log=error'], { cwd: STUDIO, shell: true })
  // mantém a MESMA resolução do vídeo (só comprime via CRF)
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', rawOut,
    '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', finalOut,
  ])
  await rm(rawOut, { force: true }).catch(() => {})
  return finalOut
}

/** Renderiza o vídeo legendado a partir das palavras (já revisadas). Serializado. */
export function renderCaption(videoBuffer, words) {
  const job = queue.then(() => renderOnce(videoBuffer, words))
  queue = job.catch(() => {})
  return job
}
