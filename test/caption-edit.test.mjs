import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyEdit, parseCorrection, formatTimedText } from '../src/caption-edit.js'

const words = () => [
  { word: 'primeiro', start: 0, end: 0.3 },
  { word: 'de', start: 0.3, end: 0.5 },
  { word: 'tudo', start: 0.5, end: 0.8 },
  { word: 'se', start: 1.0, end: 1.2 },
  { word: 'baixa', start: 1.2, end: 1.6 },
]
const txt = (ws) => ws.map((w) => w.word).join(' ')

test('parseCorrection extrai o texto após CORREÇÃO', () => {
  assert.equal(parseCorrection('CORREÇÃO se → você'), 'se → você')
  assert.equal(parseCorrection('correção: oi'), 'oi')
  assert.equal(parseCorrection('Corrigir\nfoo'), 'foo')
  assert.equal(parseCorrection('ok'), null)
  assert.equal(parseCorrection('correção'), null) // sem texto
})

test('applyEdit: troca de uma palavra', () => {
  assert.equal(txt(applyEdit(words(), 'se → você')), 'primeiro de tudo você baixa')
})

test('applyEdit: troca de frase (multi-palavra) re-alinha o tempo', () => {
  const r = applyEdit(words(), 'se baixa → você baixa o app')
  assert.equal(txt(r), 'primeiro de tudo você baixa o app')
  assert.equal(r[3].start, 1.0) // o trecho substituído começa onde começava "se"
})

test('applyEdit: texto completo (mesma contagem) mantém os tempos', () => {
  const r = applyEdit(words(), 'primeiro de tudo você baixa')
  assert.equal(txt(r), 'primeiro de tudo você baixa')
  assert.equal(r[3].start, 1.0)
})

test('applyEdit: ignora timestamps copiados da transcrição', () => {
  const r = applyEdit(words(), '[0:00] primeiro de tudo você baixa')
  assert.equal(txt(r), 'primeiro de tudo você baixa')
})

test('formatTimedText agrupa com timestamp por trecho', () => {
  const out = formatTimedText(words(), 3)
  assert.match(out, /^\[0:00\] primeiro de tudo$/m)
  assert.match(out, /^\[0:01\] se baixa$/m)
})
