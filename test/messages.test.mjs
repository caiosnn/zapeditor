import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getMedia,
  getText,
  normalizeId,
  botIdentifiers,
  isBotMentioned,
  isGroup,
} from '../src/messages.js'

test('getMedia detecta vídeo, áudio e documento de vídeo', () => {
  assert.equal(getMedia({ videoMessage: {} })?.kind, 'video')
  assert.equal(getMedia({ audioMessage: {} })?.kind, 'audio')
  assert.equal(getMedia({ documentMessage: { mimetype: 'video/mp4' } })?.kind, 'video')
  assert.equal(getMedia({ documentMessage: { mimetype: 'application/pdf' } }), null)
  assert.equal(getMedia({ conversation: 'oi' }), null)
})

test('getMedia desembrulha mensagem efêmera / documento-com-legenda', () => {
  assert.equal(getMedia({ ephemeralMessage: { message: { videoMessage: {} } } })?.kind, 'video')
  assert.equal(
    getMedia({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'video/mp4' } } } })?.kind,
    'video',
  )
})

test('getText pega conversa, texto e legenda', () => {
  assert.equal(getText({ conversation: 'oi' }), 'oi')
  assert.equal(getText({ extendedTextMessage: { text: ' legenda ' } }), 'legenda')
  assert.equal(getText({ videoMessage: { caption: 'cap' } }), 'cap')
  assert.equal(getText({ documentMessage: { caption: 'doc' } }), 'doc')
})

test('normalizeId remove device e domínio', () => {
  assert.equal(normalizeId('556198618424:2@s.whatsapp.net'), '556198618424')
  assert.equal(normalizeId('998877@lid'), '998877')
})

test('isBotMentioned funciona por número e por LID', () => {
  const ids = botIdentifiers({ user: { id: '5561:2@s.whatsapp.net', lid: '999:2@lid' } })
  const byNumber = { extendedTextMessage: { contextInfo: { mentionedJid: ['5561@s.whatsapp.net'] } } }
  const byLid = { extendedTextMessage: { contextInfo: { mentionedJid: ['999@lid'] } } }
  const other = { extendedTextMessage: { contextInfo: { mentionedJid: ['000@s.whatsapp.net'] } } }
  assert.equal(isBotMentioned(byNumber, ids), true)
  assert.equal(isBotMentioned(byLid, ids), true)
  assert.equal(isBotMentioned(other, ids), false)
})

test('isGroup', () => {
  assert.equal(isGroup('123@g.us'), true)
  assert.equal(isGroup('123@s.whatsapp.net'), false)
})
