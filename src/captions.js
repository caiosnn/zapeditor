import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true, ...opts })
    let stderr = ''
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new Error(`${cmd} (${code}): ${stderr}`))))
  })
}

/**
 * Agrupa as palavras (com timestamp real do Whisper) em frases curtas de
 * legenda (1-2 linhas), quebrando em pausas ou ao atingir o limite.
 */
export function phrasesFromWords(words, { maxWords = 4, maxChars = 24, gap = 0.5 } = {}) {
  const phrases = []
  let cur = []
  const flush = () => {
    if (cur.length) {
      phrases.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end })
      cur = []
    }
  }
  for (const w of words) {
    const text = String(w.word || '').trim()
    if (!text) continue
    if (cur.length) {
      const prev = cur[cur.length - 1]
      const chars = cur.reduce((a, x) => a + x.text.length + 1, 0)
      if (w.start - prev.end > gap || cur.length >= maxWords || chars + text.length > maxChars) flush()
    }
    cur.push({ text, start: Number(w.start) || 0, end: Number(w.end) || 0 })
  }
  flush()
  return phrases
}

/** Quebra os índices das palavras de uma frase em até 2 linhas equilibradas. */
function groupLines(words) {
  const text = words.map((w) => w.text).join(' ')
  if (words.length <= 3 || text.length <= 14) return [words.map((_, i) => i)]
  const lens = words.map((w) => w.text.length + 1)
  const total = lens.reduce((a, b) => a + b, 0)
  let acc = 0
  let breakAt = 1
  for (let i = 0; i < words.length; i++) {
    acc += lens[i]
    if (acc >= total / 2) {
      breakAt = i + 1
      break
    }
  }
  breakAt = Math.min(Math.max(breakAt, 1), words.length - 1)
  const idx = words.map((_, i) => i)
  return [idx.slice(0, breakAt), idx.slice(breakAt)]
}

function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  const p = (n) => String(n).padStart(2, '0')
  return `${h}:${p(m)}:${p(s)}.${p(c)}`
}

function escText(s) {
  return String(s).replace(/[{}\\]/g, '')
}

/** A palavra "herói" do quadro = a maior (mais letras) da frase, que fica grande. */
function heroIndex(words) {
  let best = 0
  let bestLen = -1
  words.forEach((w, i) => {
    const len = w.text.replace(/[^\p{L}\p{N}]/gu, '').length
    if (len > bestLen) {
      bestLen = len
      best = i
    }
  })
  return best
}

/**
 * Texto ASS de um quadro (estilo Cover): a palavra-herói da frase fica grande,
 * branca e com glow (fixa). A palavra falada no instante dá um leve "pop".
 */
function renderLine(words, layout, hero, current, S, fadeIn, fadeOut) {
  const fade = fadeIn || fadeOut ? `\\fad(${fadeIn ? 90 : 0},${fadeOut ? 90 : 0})` : ''
  const normal = `\\fs${S.NS}\\bord${S.OB}\\3c&H000000&\\blur0`
  const heroT = `\\fs${S.BIG}\\bord${S.GB}\\3c&HFFFFFF&\\blur${S.BL}`
  let out = `{${fade}}`
  layout.forEach((line, li) => {
    if (li > 0) out += '\\N'
    line.forEach((wi, k) => {
      if (k > 0) out += ' '
      const base = wi === hero ? heroT : normal
      const word = escText(words[wi].text)
      if (wi === current) {
        out += `{${base}\\fscx72\\fscy72\\t(0,150,\\fscx100\\fscy100)}${word}{\\fscx100\\fscy100}`
      } else {
        out += `{${base}}${word}`
      }
    })
  })
  return out
}

/** Gera o conteúdo .ass com a animação estilo "Cover" (palavra ativa cresce + glow). */
export function buildAss(phrases, opts = {}) {
  const W = opts.width || 1080
  const H = opts.height || 1920
  const fontName = opts.fontName || 'Arial Black'
  const NS = Math.round(H * 0.044)
  const BIG = Math.round(NS * 1.85)
  const S = {
    NS,
    BIG,
    OB: Math.max(2, Math.round(NS * 0.1)),
    GB: Math.round(NS * 0.18),
    BL: Math.round(NS * 0.3),
  }
  const align = opts.position === 'center' ? 5 : opts.position === 'bottom' ? 2 : 8
  const marginV = opts.marginV != null ? opts.marginV : Math.round(H * (opts.position === 'center' ? 0 : 0.1))

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${fontName},${NS},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${S.OB},1,${align},80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  const lines = []
  for (const ph of phrases) {
    if (!ph.words?.length) continue
    const layout = groupLines(ph.words)
    const hero = heroIndex(ph.words)
    const n = ph.words.length
    ph.words.forEach((w, a) => {
      const start = w.start
      const end = a < n - 1 ? ph.words[a + 1].start : ph.end + 0.12
      lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${renderLine(ph.words, layout, hero, a, S, a === 0, a === n - 1)}`)
    })
  }
  return header + lines.join('\n') + '\n'
}

/**
 * Pipeline: palavras com tempo -> .ass -> queima no vídeo -> caminho do vídeo legendado.
 */
export async function renderCaptions({ videoPath, words, width, height, outPath, fontPath, fontName, position = 'top', marginV, bgFilter = '' }) {
  const absVideo = resolve(videoPath)
  const absOut = resolve(outPath)
  const dir = await mkdtemp(join(tmpdir(), 'wa-cap-'))
  try {
    const phrases = phrasesFromWords(words)
    const ass = buildAss(phrases, { width, height, fontName, position, marginV })
    await writeFile(join(dir, 'captions.ass'), ass, 'utf8')
    await copyFile(fontPath, join(dir, 'font.ttf'))

    const vf = `${bgFilter}ass=captions.ass:fontsdir=.`
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', absVideo, '-vf', vf, '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', absOut], { cwd: dir })
    return absOut
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
