import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyAttachment,
  folderForKind,
  extFor,
  dayFolder,
  clockPrefix,
  safeName,
  buildFileName,
  archivePath,
  dayFolderName,
  isDriveRequest,
  parseDriveDate,
} from '../src/archive.js'

test('classifyAttachment detecta mídia nativa', () => {
  assert.equal(classifyAttachment({ videoMessage: {} })?.kind, 'video')
  assert.equal(classifyAttachment({ imageMessage: {} })?.kind, 'image')
  assert.equal(classifyAttachment({ audioMessage: {} })?.kind, 'audio')
  assert.equal(classifyAttachment({ conversation: 'oi' }), null)
})

test('classifyAttachment classifica documentos por mimetype', () => {
  assert.equal(classifyAttachment({ documentMessage: { mimetype: 'video/mp4' } })?.kind, 'video')
  assert.equal(classifyAttachment({ documentMessage: { mimetype: 'image/png' } })?.kind, 'image')
  assert.equal(classifyAttachment({ documentMessage: { mimetype: 'audio/mpeg' } })?.kind, 'audio')
  assert.equal(classifyAttachment({ documentMessage: { mimetype: 'application/pdf' } })?.kind, 'document')
})

test('classifyAttachment desembrulha mensagem efêmera/legenda', () => {
  assert.equal(classifyAttachment({ ephemeralMessage: { message: { videoMessage: {} } } })?.kind, 'video')
  assert.equal(
    classifyAttachment({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/zip' } } } })?.kind,
    'document',
  )
})

test('classifyAttachment traz nome e extensão do documento', () => {
  const att = classifyAttachment({ documentMessage: { mimetype: 'application/pdf', fileName: 'roteiro.pdf' } })
  assert.equal(att.fileName, 'roteiro.pdf')
  assert.equal(att.ext, 'pdf')
})

test('folderForKind mapeia tipo -> pasta', () => {
  assert.equal(folderForKind('video'), 'Vídeos')
  assert.equal(folderForKind('image'), 'Imagens')
  assert.equal(folderForKind('audio'), 'Áudios')
  assert.equal(folderForKind('document'), 'Documentos')
  assert.equal(folderForKind('qualquer'), 'Documentos')
})

test('extFor prefere o nome, cai no mimetype', () => {
  assert.equal(extFor('arquivo.MOV', 'video/quicktime'), 'mov')
  assert.equal(extFor('', 'application/pdf'), 'pdf')
  assert.equal(extFor('sem-extensao', 'image/jpeg'), 'jpeg')
  assert.equal(extFor('', ''), 'bin')
})

test('dayFolder e clockPrefix usam horário local', () => {
  const d = new Date(2026, 5, 3, 14, 32) // 03/06/2026 14:32
  assert.equal(dayFolder(d), '2026-06-03')
  assert.equal(clockPrefix(d), '14-32')
})

test('dayFolderName monta "FB MM-DD-AAAA"', () => {
  assert.equal(dayFolderName(new Date(2026, 5, 3, 0, 0)), 'FB 06-03-2026')
  assert.equal(dayFolderName(new Date(2025, 11, 25, 0, 0)), 'FB 12-25-2025')
})

test('safeName remove caracteres proibidos', () => {
  assert.equal(safeName('a/b:c*?'), 'a b c')
  assert.equal(safeName('  João   Silva  '), 'João Silva')
})

test('buildFileName monta HH-MM_quem_nome.ext', () => {
  const date = new Date(2026, 5, 3, 9, 5)
  assert.equal(
    buildFileName({ date, sender: 'Maria', fileName: 'Corte Final.mp4', ext: 'mp4' }),
    '09-05_Maria_Corte Final.mp4',
  )
  // sem nome original -> usa fallback
  assert.equal(buildFileName({ date, sender: 'Maria', fileName: '', ext: 'mp4' }), '09-05_Maria_arquivo.mp4')
})

test('archivePath devolve [raiz, "FB MM-DD-AAAA", tipo]', () => {
  const date = new Date(2026, 5, 3, 0, 0)
  assert.deepEqual(archivePath({ rootName: 'Agendas FB', date, kind: 'video' }), [
    'Agendas FB',
    'FB 06-03-2026',
    'Vídeos',
  ])
})

test('isDriveRequest detecta pedido do link', () => {
  assert.equal(isDriveRequest('me envie o drive de hoje'), true)
  assert.equal(isDriveRequest('DRIVE'), true)
  assert.equal(isDriveRequest('manda o link do drive'), true)
  assert.equal(isDriveRequest('transcreve esse áudio'), false)
  assert.equal(isDriveRequest(''), false)
})

test('parseDriveDate entende hoje, ontem e data específica', () => {
  const base = new Date(2026, 5, 3, 10, 0) // 03/06/2026
  assert.equal(dayFolder(parseDriveDate('drive de hoje', base)), '2026-06-03')
  assert.equal(dayFolder(parseDriveDate('drive', base)), '2026-06-03')
  assert.equal(dayFolder(parseDriveDate('drive de ontem', base)), '2026-06-02')
  assert.equal(dayFolder(parseDriveDate('me manda o drive do dia 01/05', base)), '2026-05-01')
  assert.equal(dayFolder(parseDriveDate('drive de 25/12/2025', base)), '2025-12-25')
})
