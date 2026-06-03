import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { config } from './config.js'

const SCRIPT = resolve('whisper_words.py')

function runPython(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.pythonBin, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString())) // progresso/download do modelo
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`whisper_words.py saiu com código ${code}:\n${stderr.slice(-500)}`))
    })
  })
}

/**
 * Transcreve um buffer de áudio (MP3) com Whisper local e devolve as palavras
 * com timestamp real: [{ word, start, end }] (segundos).
 */
export async function transcribeWords(audioBuffer) {
  const dir = await mkdtemp(join(tmpdir(), 'wa-wh-'))
  const audioPath = join(dir, 'audio.mp3')
  await writeFile(audioPath, audioBuffer)
  try {
    const out = await runPython([SCRIPT, audioPath, config.whisperModel, config.language || 'pt'])
    const jsonStart = out.indexOf('{')
    if (jsonStart === -1) throw new Error(`Whisper não retornou JSON: ${out.slice(0, 200)}`)
    const data = JSON.parse(out.slice(jsonStart))
    return Array.isArray(data.words) ? data.words : []
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
