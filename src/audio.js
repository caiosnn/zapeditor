import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr)
      else reject(new Error(`${cmd} saiu com código ${code}:\n${stderr}`))
    })
  })
}

/**
 * Recebe o buffer de uma mídia (vídeo ou áudio), extrai/converte o áudio
 * para um MP3 mono 16kHz (formato leve e ideal para o Whisper) e devolve
 * o caminho do arquivo gerado + a duração em segundos.
 *
 * Lembre-se de chamar cleanup() depois para apagar os temporários.
 */
export async function extractAudio(buffer, ext = 'bin') {
  const dir = await mkdtemp(join(tmpdir(), 'wa-transcribe-'))
  const inputPath = join(dir, `input.${ext}`)
  const outputPath = join(dir, 'audio.mp3')

  await writeFile(inputPath, buffer)

  // -vn = descarta vídeo; -ac 1 mono; -ar 16000 = 16kHz; bitrate baixo
  const stderr = await run('ffmpeg', [
    '-hide_banner',
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '64k',
    outputPath,
  ])

  const duration = parseDuration(stderr)
  const audio = await readFile(outputPath)

  return {
    audio,
    duration,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  }
}

/**
 * Divide um MP3 em pedaços de ~chunkSeconds (para transcrever vídeos longos sem
 * estourar a API). Devolve [{ buffer, startSeconds }].
 */
export async function splitToChunks(mp3Buffer, chunkSeconds) {
  const dir = await mkdtemp(join(tmpdir(), 'wa-split-'))
  try {
    const input = join(dir, 'in.mp3')
    await writeFile(input, mp3Buffer)
    await run('ffmpeg', [
      '-hide_banner', '-y', '-i', input,
      '-f', 'segment', '-segment_time', String(chunkSeconds), '-c', 'copy',
      join(dir, 'c%03d.mp3'),
    ])
    const names = (await readdir(dir)).filter((f) => /^c\d+\.mp3$/.test(f)).sort()
    const chunks = []
    for (let i = 0; i < names.length; i++) {
      chunks.push({ buffer: await readFile(join(dir, names[i])), startSeconds: i * chunkSeconds })
    }
    return chunks
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Extrai a duração ("Duration: 00:01:23.45") da saída do ffmpeg. */
function parseDuration(stderr) {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
  if (!m) return 0
  const [, h, min, s] = m
  return Number(h) * 3600 + Number(min) * 60 + Number(s)
}
