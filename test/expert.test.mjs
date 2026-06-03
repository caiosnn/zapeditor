import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDecision,
  resolveModel,
  resolveParams,
  isAffirmative,
  isNegative,
  IMAGE_MODELS,
  VIDEO_MODELS,
} from '../src/expert.js'

test('parseDecision: JSON limpo', () => {
  const d = parseDecision(
    '{"reply":"oi","action":"image","model":"flux_2","prompt":"a cat","params":{"resolution":"4k"},"use_reference_image":true}'
  )
  assert.equal(d.action, 'image')
  assert.equal(d.model, 'flux_2')
  assert.equal(d.prompt, 'a cat')
  assert.equal(d.params.resolution, '4k')
  assert.equal(d.useReferenceImage, true)
})

test('parseDecision: tolera cercas de código ```json', () => {
  const d = parseDecision('```json\n{"reply":"x","action":"video"}\n```')
  assert.equal(d.action, 'video')
  assert.equal(d.reply, 'x')
})

test('parseDecision: texto sem JSON vira conversa (none)', () => {
  const d = parseDecision('só um texto qualquer')
  assert.equal(d.action, 'none')
  assert.equal(d.reply, 'só um texto qualquer')
})

test('parseDecision: action inválida vira none', () => {
  assert.equal(parseDecision('{"action":"banana","reply":"r"}').action, 'none')
})

test('parseDecision: save_prefs só quando é objeto', () => {
  assert.equal(parseDecision('{"action":"none","save_prefs":null}').savePrefs, null)
  assert.deepEqual(parseDecision('{"action":"none","save_prefs":{"imageModel":"gpt_image_2"}}').savePrefs, {
    imageModel: 'gpt_image_2',
  })
})

test('resolveModel: usa o modelo da decisão se válido', () => {
  assert.equal(resolveModel('image', { model: 'flux_2' }, {}), 'flux_2')
  assert.equal(resolveModel('video', { model: 'kling2_6' }, {}), 'kling2_6')
})

test('resolveModel: cai na preferência do chat', () => {
  assert.equal(resolveModel('image', { model: null }, { imageModel: 'gpt_image_2' }), 'gpt_image_2')
  assert.equal(resolveModel('video', { model: null }, { videoModel: 'seedance_2_0' }), 'seedance_2_0')
})

test('resolveModel: modelo inválido cai num default válido', () => {
  assert.ok(IMAGE_MODELS.has(resolveModel('image', { model: 'inexistente_x' }, {})))
})

test('resolveModel: modelo de imagem não vaza para vídeo', () => {
  // a decisão sugere um modelo de imagem, mas a ação é vídeo -> usa default de vídeo
  assert.ok(VIDEO_MODELS.has(resolveModel('video', { model: 'nano_banana_2' }, {})))
})

test('resolveParams: imagem tem resolution; vídeo tem duration/quality', () => {
  const img = resolveParams('image', { params: { aspect_ratio: '9:16' } }, {})
  assert.equal(img.aspect_ratio, '9:16')
  assert.ok(img.resolution)
  assert.equal(img.duration, undefined)
  const vid = resolveParams('video', { params: {} }, {})
  assert.ok(vid.duration)
  assert.ok(vid.quality)
})

test('resolveParams: preferência do chat preenche o que faltar', () => {
  const img = resolveParams('image', { params: {} }, { aspectRatio: '4:5', resolution: '4k' })
  assert.equal(img.aspect_ratio, '4:5')
  assert.equal(img.resolution, '4k')
})

test('resolveParams: decisão tem prioridade sobre a preferência', () => {
  const img = resolveParams('image', { params: { aspect_ratio: '1:1' } }, { aspectRatio: '9:16' })
  assert.equal(img.aspect_ratio, '1:1')
})

test('isAffirmative reconhece confirmações', () => {
  for (const t of ['sim', 'pode gerar', 'manda', 'bora', 'ok', '👍', 'isso']) assert.ok(isAffirmative(t), t)
})

test('isNegative reconhece recusas', () => {
  for (const t of ['não', 'nao quero', 'cancela', 'deixa', 'esquece', '👎']) assert.ok(isNegative(t), t)
})

test('"não" não é afirmativo (e vice-versa)', () => {
  assert.equal(isAffirmative('não'), false)
  assert.equal(isNegative('sim'), false)
})
