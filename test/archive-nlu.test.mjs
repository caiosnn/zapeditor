import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArchiveIntent, buildArchivePrompt } from '../src/archive-nlu.js'

test('parseArchiveIntent: set com JSON limpo', () => {
  const r = parseArchiveIntent('{"intent":"set","group_index":2,"enable":true,"reply":"ok"}')
  assert.equal(r.intent, 'set')
  assert.equal(r.groupIndex, 2)
  assert.equal(r.enable, true)
  assert.equal(r.reply, 'ok')
})

test('parseArchiveIntent: tolera cercas de código', () => {
  const r = parseArchiveIntent('```json\n{"intent":"list_archived"}\n```')
  assert.equal(r.intent, 'list_archived')
  assert.equal(r.groupIndex, null)
  assert.equal(r.enable, null)
})

test('parseArchiveIntent: lixo sem JSON vira none', () => {
  assert.equal(parseArchiveIntent('não sei do que se trata').intent, 'none')
  assert.equal(parseArchiveIntent('').intent, 'none')
})

test('parseArchiveIntent: intent inválido vira none', () => {
  assert.equal(parseArchiveIntent('{"intent":"apagar"}').intent, 'none')
})

test('parseArchiveIntent: group_index inválido vira null; enable não-bool vira null', () => {
  const r = parseArchiveIntent('{"intent":"set","group_index":"abc","enable":"sim"}')
  assert.equal(r.groupIndex, null)
  assert.equal(r.enable, null)
})

test('buildArchivePrompt lista grupos, status e marca o atual', () => {
  const groups = [
    { jid: 'g1@g.us', name: 'teste', archived: true },
    { jid: 'g2@g.us', name: 'Campanha', archived: false },
  ]
  const p = buildArchivePrompt(groups, 'g2@g.us')
  assert.match(p, /1\. teste \[ARQUIVANDO\]/)
  assert.match(p, /2\. Campanha \[não\] \(ESTE grupo/)
  assert.match(p, /"intent"/)
})

test('buildArchivePrompt sem grupos não quebra', () => {
  const p = buildArchivePrompt([], null)
  assert.match(p, /não está em nenhum grupo/)
})
