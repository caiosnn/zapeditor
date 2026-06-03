import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tsToSec, parseSrtBlocks, parseCutRange } from '../src/cut.js'

test('tsToSec converte vários formatos', () => {
  assert.equal(tsToSec('00:01:23,280'), 83.28)
  assert.equal(tsToSec('01:23'), 83) // MM:SS
  assert.equal(tsToSec('1:00:00'), 3600)
})

const srt = `1
00:00:00,000 --> 00:00:02,000
ola

2
00:00:02,000 --> 00:00:05,000
mundo`

test('parseSrtBlocks lê os blocos com tempos', () => {
  const b = parseSrtBlocks(srt)
  assert.equal(b.length, 2)
  assert.equal(b[0].start, 0)
  assert.equal(b[1].end, 5)
})

test('parseCutRange por timestamps usa o menor e o maior', () => {
  const r = parseCutRange('corte de 00:01:23,280 ... até ... 00:03:02,400', [])
  assert.equal(r.start, 83.28)
  assert.equal(r.end, 182.4)
})

test('parseCutRange por número de bloco', () => {
  const r = parseCutRange('CORTE do bloco 1 até o 2', parseSrtBlocks(srt))
  assert.equal(r.start, 0)
  assert.equal(r.end, 5)
})

test('parseCutRange sem dados retorna null', () => {
  assert.equal(parseCutRange('faça um corte aí', []), null)
})
