import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectMediaUrl, parseInstagram } from '../src/downloader.js'

test('detectMediaUrl: YouTube (watch, youtu.be, shorts, music)', () => {
  assert.equal(detectMediaUrl('https://www.youtube.com/watch?v=abc123')?.platform, 'YouTube')
  assert.equal(detectMediaUrl('olha isso https://youtu.be/abc123 top')?.platform, 'YouTube')
  assert.equal(detectMediaUrl('https://youtube.com/shorts/xY_z-1')?.platform, 'YouTube')
  assert.equal(detectMediaUrl('https://music.youtube.com/watch?v=abc')?.platform, 'YouTube')
  // YouTube é só vídeo: não tenta fallback de imagem.
  assert.equal(detectMediaUrl('https://youtu.be/abc')?.images, false)
})

test('detectMediaUrl: X / Twitter', () => {
  assert.equal(detectMediaUrl('https://x.com/user/status/123')?.platform, 'X')
  assert.equal(detectMediaUrl('https://twitter.com/user/status/123')?.platform, 'X')
  assert.equal(detectMediaUrl('https://mobile.twitter.com/u/status/1')?.platform, 'X')
  assert.equal(detectMediaUrl('https://x.com/u/status/1')?.images, true)
})

test('detectMediaUrl: Instagram', () => {
  assert.equal(detectMediaUrl('https://www.instagram.com/reel/Cabc/')?.platform, 'Instagram')
  assert.equal(detectMediaUrl('https://instagram.com/p/Cabc/')?.platform, 'Instagram')
  assert.equal(detectMediaUrl('https://instagr.am/p/Cabc')?.platform, 'Instagram')
})

test('detectMediaUrl: Instagram traz o igKind/identificadores', () => {
  const reel = detectMediaUrl('https://www.instagram.com/reel/CabcDEF/')
  assert.equal(reel.igKind, 'reel')
  assert.equal(reel.shortcode, 'CabcDEF')

  const story = detectMediaUrl('https://instagram.com/stories/fulano/123456789')
  assert.equal(story.igKind, 'story')
  assert.equal(story.username, 'fulano')
  assert.equal(story.storyId, '123456789')
})

test('parseInstagram: story, reel, post, tv e outro', () => {
  assert.deepEqual(parseInstagram('https://instagram.com/stories/joao.silva/987'), {
    igKind: 'story',
    username: 'joao.silva',
    storyId: '987',
  })
  assert.deepEqual(parseInstagram('https://www.instagram.com/reels/AbC-1/'), { igKind: 'reel', shortcode: 'AbC-1' })
  assert.deepEqual(parseInstagram('https://www.instagram.com/reel/AbC_2/'), { igKind: 'reel', shortcode: 'AbC_2' })
  assert.deepEqual(parseInstagram('https://instagram.com/p/XyZ9/'), { igKind: 'post', shortcode: 'XyZ9' })
  assert.deepEqual(parseInstagram('https://instagram.com/tv/Tv123/'), { igKind: 'post', shortcode: 'Tv123' })
  assert.deepEqual(parseInstagram('https://instagram.com/algumperfil/'), { igKind: 'other' })
})

test('detectMediaUrl: TikTok (full, vm, vt)', () => {
  assert.equal(detectMediaUrl('https://www.tiktok.com/@user/video/123')?.platform, 'TikTok')
  assert.equal(detectMediaUrl('https://vm.tiktok.com/ZMabc/')?.platform, 'TikTok')
  assert.equal(detectMediaUrl('https://vt.tiktok.com/ZMabc/')?.platform, 'TikTok')
})

test('detectMediaUrl: devolve a URL limpa (sem pontuação/markdown no fim)', () => {
  assert.equal(detectMediaUrl('veja (https://youtu.be/abc123).')?.url, 'https://youtu.be/abc123')
  assert.equal(detectMediaUrl('link: https://x.com/u/status/1!')?.url, 'https://x.com/u/status/1')
})

test('detectMediaUrl: acha a URL no meio de uma frase', () => {
  const hit = detectMediaUrl('@bot baixa isso aqui https://www.tiktok.com/@u/video/9 por favor')
  assert.equal(hit?.platform, 'TikTok')
  assert.equal(hit?.url, 'https://www.tiktok.com/@u/video/9')
})

test('detectMediaUrl: pega a 1ª plataforma quando há mais de uma', () => {
  const hit = detectMediaUrl('primeiro https://youtu.be/aaa depois https://x.com/u/status/1')
  assert.equal(hit?.platform, 'YouTube')
})

test('detectMediaUrl: é case-insensitive e aceita http', () => {
  assert.equal(detectMediaUrl('HTTP://YOUTUBE.COM/watch?v=Z')?.platform, 'YouTube')
})

test('detectMediaUrl: ignora texto sem link e plataformas não suportadas', () => {
  assert.equal(detectMediaUrl('nenhum link aqui'), null)
  assert.equal(detectMediaUrl(''), null)
  assert.equal(detectMediaUrl(undefined), null)
  assert.equal(detectMediaUrl('https://facebook.com/watch/123'), null)
  assert.equal(detectMediaUrl('https://www.google.com/'), null)
})
