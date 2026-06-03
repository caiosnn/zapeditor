import { config } from './config.js'
import { transcribeWords } from './whisper.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const LONG_VIDEO_SECONDS = 540 // acima disso usa Whisper local (aguenta qualquer duração)

/** Chamada base ao OpenRouter com áudio (MP3 em base64) + prompt de texto. */
async function postAudio(base64, prompt) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Bot Transcricao WhatsApp',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'input_audio', input_audio: { data: base64, format: 'mp3' } },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenRouter respondeu ${res.status}: ${text}`)
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(`Resposta inesperada do OpenRouter: ${JSON.stringify(data).slice(0, 300)}`)
  }
  return content
}

/**
 * Transcrição em texto (modo srt = legenda com minutagem; plain = texto corrido).
 */
export async function transcribe(audioBuffer, { durationSeconds = 0 } = {}) {
  // vídeos longos: usa Whisper local (não tem limite de tamanho/saída da API)
  if (durationSeconds > LONG_VIDEO_SECONDS) {
    return transcribeLongWhisper(audioBuffer)
  }
  const wantSrt = config.outputFormat === 'srt'
  const prompt = wantSrt ? srtPrompt(durationSeconds) : plainPrompt()
  return cleanup(await postAudio(audioBuffer.toString('base64'), prompt))
}

/** Transcreve vídeo longo com Whisper local (palavra a palavra) -> SRT/plain. */
async function transcribeLongWhisper(audioBuffer) {
  const words = await transcribeWords(audioBuffer)
  if (!words.length) return ''
  if (config.outputFormat !== 'srt') return words.map((w) => w.word).join(' ')
  return wordsToSrt(words)
}

/** Agrupa as palavras (com tempo do Whisper) em blocos SRT. */
function wordsToSrt(words) {
  const blocks = []
  let cur = []
  for (const w of words) {
    cur.push(w)
    const gap = cur.length > 1 ? w.start - cur[cur.length - 2].end : 0
    if (cur.length >= 10 || /[.!?]$/.test(w.word) || gap > 0.8) {
      blocks.push(cur)
      cur = []
    }
  }
  if (cur.length) blocks.push(cur)
  return blocks
    .map((g, i) => `${i + 1}\n${secToSrt(g[0].start)} --> ${secToSrt(g[g.length - 1].end)}\n${g.map((w) => w.word).join(' ')}`)
    .join('\n\n')
}

function secToSrt(total) {
  const t = Math.max(0, total)
  const p2 = (n) => String(n).padStart(2, '0')
  const ms = Math.round((t - Math.floor(t)) * 1000)
  return `${p2(Math.floor(t / 3600))}:${p2(Math.floor((t % 3600) / 60))}:${p2(Math.floor(t % 60))},${String(ms).padStart(3, '0')}`
}

/**
 * Transcrição em SEGMENTOS com tempo (para legenda animada no vídeo).
 * Devolve [{ start, end, text }] em segundos. Os tempos vêm do modelo
 * (ancorados na duração) — aproximados no nível de frase.
 */
export async function transcribeSegments(audioBuffer, durationSeconds = 0) {
  const durHint =
    durationSeconds > 0
      ? ` O áudio dura ${durationSeconds.toFixed(
          1
        )}s: os tempos devem ir de 0 até ~${durationSeconds.toFixed(1)}, sem ultrapassar, cobrindo todo o áudio.`
      : ''
  const prompt =
    'Transcreva o áudio e devolva SOMENTE um array JSON de segmentos curtos de legenda. ' +
    'Cada elemento no formato {"start": <segundos>, "end": <segundos>, "text": "<2 a 5 palavras>"}. ' +
    'Use segmentos curtos de 2 a 5 palavras, com tempos crescentes e contínuos ' +
    '(o end de um segmento = o start do próximo).' +
    langHint() +
    durHint +
    ' Responda APENAS com o JSON (começando com [ e terminando com ]), sem comentários e sem cercas de código.'
  const content = await postAudio(audioBuffer.toString('base64'), prompt)
  return parseSegments(content)
}

function parseSegments(raw) {
  let s = cleanup(raw)
  const a = s.indexOf('[')
  const b = s.lastIndexOf(']')
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1)
  let arr
  try {
    arr = JSON.parse(s)
  } catch {
    throw new Error(`JSON de segmentos inválido: ${s.slice(0, 200)}`)
  }
  if (!Array.isArray(arr)) throw new Error('Esperava um array de segmentos')
  return arr
    .map((x) => ({
      start: Number(x?.start) || 0,
      end: Number(x?.end) || 0,
      text: typeof x?.text === 'string' ? x.text.trim() : '',
    }))
    .filter((x) => x.text.length > 0)
}

/**
 * Corrige a transcrição: o Gemini transcreve o áudio LIMPO e correto (normaliza
 * "cê" -> "você" etc.) e alinhamos esse texto aos tempos do Whisper por LCS —
 * assim a correção não "desliza" (cada palavra fica no tempo certo).
 */
export async function correctWords(words, audioBuffer) {
  if (!words || words.length === 0 || !audioBuffer) return words
  const prompt =
    'Transcreva este áudio em português CORRETO, exatamente como é falado, ' +
    'normalizando a fala informal para a forma escrita padrão (ex.: "cê" -> "você", "vô" -> "vou"). ' +
    'Não traduza, não resuma, não invente. Responda APENAS com a transcrição corrida, sem comentários.'
  let geminiText
  try {
    geminiText = cleanup(await postAudio(audioBuffer.toString('base64'), prompt))
  } catch {
    return words // em erro, segue sem correção
  }
  const gWords = geminiText.split(/\s+/).filter(Boolean)
  if (gWords.length < 2) return words
  return alignWords(words, gWords)
}

const normWord = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * Alinha as palavras do Gemini (texto correto) aos tempos do Whisper via LCS.
 * Palavras casadas herdam o tempo do Whisper; inseridas têm o tempo interpolado.
 */
function alignWords(whisper, gemini) {
  const a = whisper.map((w) => normWord(w.word))
  const b = gemini.map(normWord)
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (j < n) {
    if (i < m && a[i] === b[j]) {
      out.push({ word: gemini[j], start: whisper[i].start, end: whisper[i].end })
      i++
      j++
    } else if (i < m && (j >= n || dp[i + 1][j] >= dp[i][j + 1])) {
      i++ // palavra do Whisper sem par -> descarta
    } else {
      out.push({ word: gemini[j], start: null, end: null }) // inserida -> interpola
      j++
    }
  }
  for (let k = 0; k < out.length; k++) {
    if (out[k].start != null) continue
    let runStart = k
    while (runStart > 0 && out[runStart - 1].start == null) runStart--
    let runEnd = k
    while (runEnd < out.length - 1 && out[runEnd + 1].start == null) runEnd++
    const prevEnd = runStart > 0 ? out[runStart - 1].end : whisper[0]?.start ?? 0
    const nextStart =
      runEnd < out.length - 1 ? out[runEnd + 1].start : whisper[whisper.length - 1]?.end ?? prevEnd + 0.3
    const count = runEnd - runStart + 1
    const span = Math.max(0.12, nextStart - prevEnd)
    for (let p = runStart; p <= runEnd; p++) {
      out[p].start = prevEnd + (span * (p - runStart)) / count
      out[p].end = prevEnd + (span * (p - runStart + 1)) / count
    }
  }
  return out
}

function plainPrompt() {
  return (
    'Transcreva o áudio a seguir exatamente como foi falado, no idioma original.' +
    langHint() +
    ' Inclua pontuação natural. Responda APENAS com a transcrição, sem comentários, ' +
    'sem aspas e sem tradução. Se não houver fala, responda com uma string vazia.'
  )
}

function srtPrompt(durationSeconds) {
  const durHint =
    durationSeconds > 0
      ? ` O áudio tem duração total de ${clock(durationSeconds)} (${durationSeconds.toFixed(
          1
        )} segundos): distribua os timestamps ao longo de TODA essa duração, fazendo o último bloco terminar bem próximo do final.`
      : ''
  return (
    'Transcreva o áudio a seguir no formato de legenda SRT.' +
    langHint() +
    ' Numere os blocos sequencialmente começando em 1. Use timestamps no formato ' +
    'HH:MM:SS,mmm --> HH:MM:SS,mmm. Quebre em segmentos curtos (uma frase ou parte ' +
    'de frase por bloco), com tempos contínuos (o início de um bloco = fim do anterior).' +
    durHint +
    ' Inclua pontuação natural. Responda APENAS com o conteúdo SRT, sem comentários ' +
    'e sem cercas de código (```).'
  )
}

function langHint() {
  return config.language ? ` O áudio provavelmente está em ${languageName(config.language)}.` : ''
}

/** Remove cercas de código que alguns modelos colocam por engano. */
function cleanup(text) {
  return text
    .replace(/^```(?:srt|text|json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

/** Segundos -> HH:MM:SS */
function clock(seconds) {
  const s = Math.round(seconds)
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${sec}`
}

function languageName(code) {
  const names = {
    pt: 'português',
    en: 'inglês',
    es: 'espanhol',
    fr: 'francês',
    it: 'italiano',
    de: 'alemão',
  }
  return names[code.toLowerCase()] || code
}
