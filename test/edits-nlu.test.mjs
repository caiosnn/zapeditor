import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEditIntent, buildEditPrompt } from '../src/edits-nlu.js'

test('parseEditIntent: JSON limpo (save/fetch/list)', () => {
  assert.deepEqual(parseEditIntent('{"intent":"save","category":"Compilados","name":"campanha","reply":"ok"}'), {
    intent: 'save',
    category: 'Compilados',
    name: 'campanha',
    reply: 'ok',
  })
  assert.equal(parseEditIntent('{"intent":"fetch","category":"Cortes","name":"debate"}').intent, 'fetch')
  assert.equal(parseEditIntent('{"intent":"list","category":"Brutos"}').intent, 'list')
})

test('parseEditIntent: tolera cercas de código e lixo ao redor', () => {
  assert.equal(parseEditIntent('```json\n{"intent":"save","category":"x"}\n```').intent, 'save')
  assert.equal(parseEditIntent('blá {"intent":"fetch"} blá').intent, 'fetch')
})

test('parseEditIntent: intent inválida ou sem JSON vira none', () => {
  assert.equal(parseEditIntent('{"intent":"banana"}').intent, 'none')
  assert.equal(parseEditIntent('sem json aqui').intent, 'none')
  assert.deepEqual(parseEditIntent(''), { intent: 'none', category: '', name: '', reply: '' })
})

test('buildEditPrompt: reflete o contexto (com/sem vídeo) e as categorias', () => {
  const comVideo = buildEditPrompt({ hasVideo: true, categories: ['Cortes', 'Brutos'] })
  assert.match(comVideo, /COM UM VÍDEO/)
  assert.match(comVideo, /Cortes, Brutos/)
  const semVideo = buildEditPrompt({ hasVideo: false })
  assert.match(semVideo, /SEM vídeo/)
})
