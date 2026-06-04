import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCategory, sanitizeName, matchFiles } from '../src/edits.js'

test('normalizeCategory: sinônimos viram a pasta canônica', () => {
  assert.equal(normalizeCategory('compilado'), 'Compilados')
  assert.equal(normalizeCategory('Compilados'), 'Compilados')
  assert.equal(normalizeCategory('compilação'), 'Compilados')
  assert.equal(normalizeCategory('corte'), 'Cortes')
  assert.equal(normalizeCategory('CLIPE'), 'Cortes')
  assert.equal(normalizeCategory('bruto'), 'Brutos')
  assert.equal(normalizeCategory('raw'), 'Brutos')
})

test('normalizeCategory: categoria livre é capitalizada (preserva acento)', () => {
  assert.equal(normalizeCategory('bastidores'), 'Bastidores')
  assert.equal(normalizeCategory('lives da semana'), 'Lives Da Semana')
  assert.equal(normalizeCategory('edição especial'), 'Edição Especial')
  assert.equal(normalizeCategory(''), '')
  assert.equal(normalizeCategory('   '), '')
})

test('sanitizeName: remove caracteres proibidos, colapsa espaços e limita', () => {
  assert.equal(sanitizeName('campanha: saúde/2024'), 'campanha saúde 2024')
  assert.equal(sanitizeName('  a   b  '), 'a b')
  assert.equal(sanitizeName('x'.repeat(100)).length, 80)
})

test('matchFiles: casa por nome, tolerante a acento e maiúscula', () => {
  const names = ['Campanha Saúde.mp4', 'Debate.mp4', 'campanha educação.mp4']
  assert.deepEqual(matchFiles(names, 'saude'), ['Campanha Saúde.mp4'])
  assert.deepEqual(matchFiles(names, 'CAMPANHA'), ['Campanha Saúde.mp4', 'campanha educação.mp4'])
  assert.deepEqual(matchFiles(names, ''), names)
  assert.deepEqual(matchFiles(names, 'inexistente'), [])
})
