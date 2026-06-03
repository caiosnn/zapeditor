import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alignWords } from '../src/transcribe.js'

// alignWords: alinha o texto correto (Gemini) aos tempos do Whisper via LCS.
test('substituição 1:1 herda os tempos do Whisper', () => {
  const whisper = [
    { word: 'se', start: 1.0, end: 1.2 },
    { word: 'baixa', start: 1.2, end: 1.6 },
  ]
  const r = alignWords(whisper, ['você', 'baixa'])
  assert.equal(r.map((w) => w.word).join(' '), 'você baixa')
  assert.equal(r[1].start, 1.2) // "baixa" casou -> herda o tempo
})

test('palavra inserida tem o tempo interpolado (crescente)', () => {
  const whisper = [{ word: 'baixa', start: 1, end: 2 }]
  const r = alignWords(whisper, ['baixa', 'o', 'app'])
  assert.equal(r.length, 3)
  assert.equal(r[0].word, 'baixa')
  assert.ok(r[2].start >= r[1].start && r[1].start >= r[0].start)
})

test('texto idêntico mantém tudo', () => {
  const whisper = [
    { word: 'oi', start: 0, end: 0.5 },
    { word: 'mundo', start: 0.5, end: 1 },
  ]
  const r = alignWords(whisper, ['oi', 'mundo'])
  assert.deepEqual(
    r.map((w) => w.word),
    ['oi', 'mundo'],
  )
})
