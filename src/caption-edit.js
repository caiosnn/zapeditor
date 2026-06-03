// Interpreta correções do usuário e formata a transcrição para edição.

const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Detecta "CORREÇÃO ..." (ou "corrigir ...") e devolve o texto da correção. */
export function parseCorrection(text) {
  const m = (text || '').match(/^\s*(?:corre[çc][ãa]o|corrig\w+)\b[:\-—\s]*([\s\S]*)$/i)
  if (!m || !m[1].trim()) return null
  return m[1].trim()
}

/** Remove timestamps tipo [0:12] que o usuário possa ter copiado da transcrição. */
const stripStamps = (s) => s.replace(/\[\d{1,2}:\d{2}\]/g, ' ').replace(/\s+/g, ' ').trim()

const mmss = (sec) => {
  const t = Math.max(0, Math.round(sec))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** Transcrição com timestamp por trecho (agrupa por frase ou ~6 palavras). */
export function formatTimedText(words, maxPerLine = 6) {
  const groups = []
  let cur = []
  for (const w of words) {
    cur.push(w)
    if (cur.length >= maxPerLine || /[.!?]$/.test(w.word)) {
      groups.push(cur)
      cur = []
    }
  }
  if (cur.length) groups.push(cur)
  return groups.map((g) => `[${mmss(g[0].start)}] ${g.map((w) => w.word).join(' ')}`).join('\n')
}

// "errada -> certa" | "errada → certa" | "troca errada por certa" (aceita frases)
function parseReplacements(text) {
  const reps = []
  for (const line of text.split(/[\n;]+/)) {
    let m = line.match(/^\s*["']?(.+?)["']?\s*(?:->|→|=>|»)\s*["']?(.+?)["']?\s*$/)
    if (!m) m = line.match(/troc[ae]r?\s+["']?(.+?)["']?\s+por\s+["']?(.+?)["']?\s*$/i)
    if (m && m[1].trim() && m[2].trim()) reps.push([m[1].trim(), m[2].trim()])
  }
  return reps
}

function distribute(tokens, start, end) {
  const span = Math.max(0.12, end - start)
  const weights = tokens.map((t) => Math.max(1, norm(t).length))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let t = start
  return tokens.map((word, i) => {
    const d = (span * weights[i]) / total
    const w = { word, start: t, end: t + d }
    t += d
    return w
  })
}

/** Troca TODAS as ocorrências da frase `from` por `to`, re-alinhando o tempo. */
function replacePhrase(words, from, to) {
  const fromW = from.split(/\s+/).filter(Boolean).map(norm)
  const toW = to.split(/\s+/).filter(Boolean)
  if (!fromW.length || !toW.length) return words
  const out = []
  let i = 0
  while (i < words.length) {
    let match = i + fromW.length <= words.length
    for (let k = 0; match && k < fromW.length; k++) {
      if (norm(words[i + k].word) !== fromW[k]) match = false
    }
    if (match) {
      const span = words.slice(i, i + fromW.length)
      out.push(...distribute(toW, span[0].start, span[span.length - 1].end))
      i += fromW.length
    } else {
      out.push(words[i])
      i++
    }
  }
  return out
}

// Substitui o texto inteiro re-alinhando aos tempos.
function applyFullText(words, text) {
  const next = text.split(/\s+/).filter(Boolean)
  if (!next.length) return words
  if (next.length === words.length) {
    return words.map((w, i) => ({ ...w, word: next[i] }))
  }
  return distribute(next, words[0].start, words[words.length - 1].end)
}

/**
 * Aplica a edição do usuário (parcial via "errada → certa", ou texto completo).
 * Limpa timestamps que o usuário possa ter copiado. Devolve as novas palavras.
 */
export function applyEdit(words, text) {
  const clean = stripStamps(text)
  const reps = parseReplacements(clean)
  if (reps.length) {
    let out = words.map((w) => ({ ...w }))
    for (const [from, to] of reps) out = replacePhrase(out, from, to)
    return out
  }
  return applyFullText(words, clean)
}
