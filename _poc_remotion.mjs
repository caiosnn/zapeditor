import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { extractAudio } from './src/audio.js'
import { transcribeWords } from './src/whisper.js'
import { correctWords } from './src/transcribe.js'

const SRC = 'C:\\Users\\Caio\\Downloads\\ssstik.io_@paidorealtime_1780427668746.mp4'
const PUB = 'caption-studio/public'

console.log('1/3 Áudio + Whisper (palavra a palavra)...')
const buf = await readFile(SRC)
const { audio, cleanup } = await extractAudio(buf, 'mp4')
const rawWords = await transcribeWords(audio)
console.log('   palavras:', rawWords.length)

console.log('2/3 Corrigindo (Gemini transcreve + alinha por LCS)...')
const words = await correctWords(rawWords, audio)
await cleanup()
console.log('   palavras:', words.length, '| amostra:', words.slice(0, 12).map((w) => w.word).join(' '))

// Converte para o formato Caption[] do @remotion/captions (texto com espaço à esquerda)
const captions = words.map((w) => ({
  text: ' ' + w.word,
  startMs: Math.round(w.start * 1000),
  endMs: Math.round(w.end * 1000),
  timestampMs: Math.round(((w.start + w.end) / 2) * 1000),
  confidence: 1,
}))

await copyFile(SRC, `${PUB}/input.mp4`)
await writeFile(`${PUB}/input.json`, JSON.stringify(captions, null, 2), 'utf8')
console.log('3/3 Gravado', `${PUB}/input.mp4`, '+ input.json (', captions.length, 'palavras )')
