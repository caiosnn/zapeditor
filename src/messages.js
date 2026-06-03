// Helpers puros de inspeção de mensagens do WhatsApp (fáceis de testar).

/** Desembrulha mensagens efêmeras / "ver uma vez" / documento-com-legenda. */
export function unwrap(message) {
  return (
    message?.ephemeralMessage?.message ||
    message?.viewOnceMessage?.message ||
    message?.viewOnceMessageV2?.message ||
    message?.documentWithCaptionMessage?.message ||
    message ||
    null
  )
}

/** Detecta áudio ou vídeo — inclusive vídeo/áudio enviado como DOCUMENTO. */
export function getMedia(message) {
  const m = unwrap(message)
  if (m?.videoMessage) return { kind: 'video', ext: 'mp4', node: m.videoMessage }
  if (m?.audioMessage) return { kind: 'audio', ext: 'ogg', node: m.audioMessage }
  const mime = m?.documentMessage?.mimetype || ''
  if (mime.startsWith('video/')) return { kind: 'video', ext: 'mp4', node: m.documentMessage, isDoc: true }
  if (mime.startsWith('audio/')) return { kind: 'audio', ext: 'ogg', node: m.documentMessage, isDoc: true }
  return null
}

/** Pega o contextInfo de qualquer tipo de mensagem (texto ou mídia). */
export function getContextInfo(message) {
  const m = unwrap(message)
  const inner =
    m?.extendedTextMessage ||
    m?.videoMessage ||
    m?.imageMessage ||
    m?.audioMessage ||
    m?.documentMessage
  return inner?.contextInfo
}

/** Só o número/identificador, sem sufixo de device (:2) nem domínio (@...). */
export function normalizeId(jid) {
  return (jid || '').split('@')[0].split(':')[0]
}

/** Identificadores do próprio bot (número e LID), para detectar menções. */
export function botIdentifiers(sock) {
  const ids = []
  if (sock?.user?.id) ids.push(normalizeId(sock.user.id))
  if (sock?.user?.lid) ids.push(normalizeId(sock.user.lid))
  return ids
}

/** A mensagem marca (@) algum dos identificadores do bot? */
export function isBotMentioned(message, botIds) {
  const mentioned = getContextInfo(message)?.mentionedJid || []
  return mentioned.some((j) => botIds.includes(normalizeId(j)))
}

export function isGroup(jid) {
  return (jid || '').endsWith('@g.us')
}

/** Texto de uma mensagem (conversa, legenda de mídia/documento ou texto citado). */
export function getText(message) {
  const m = unwrap(message)
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.videoMessage?.caption ||
    m?.imageMessage?.caption ||
    m?.documentMessage?.caption ||
    ''
  ).trim()
}
