import makeWASocket, {
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import QRCode from 'qrcode'
import pino from 'pino'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { config } from './config.js'
import { extractAudio } from './audio.js'
import { transcribe } from './transcribe.js'
import { transcribeForCaption, renderCaption } from './caption.js'
import { applyEdit, parseCorrection, formatTimedText } from './caption-edit.js'
import { parseSrtBlocks, parseCutRange, cutVideo } from './cut.js'
import { initCutStore, saveCut, getCut } from './cut-store.js'
import {
  getMedia,
  getContextInfo,
  getText,
  unwrap,
  normalizeId,
  botIdentifiers,
  isBotMentioned,
  isGroup,
} from './messages.js'

// Legendas aguardando confirmação/edição do usuário (preview por chat).
// chave: `${jid}|${sender}` -> { videoBuffer, words, requestKey, previewId, ts }
const pendingCaptions = new Map()
// último vídeo transcrito por remetente (fallback quando o CORTE não cita a transcrição)
const senderLatestCut = new Map()
const PENDING_TTL = 30 * 60 * 1000

function pendingKey(jid, sender) {
  return `${jid}|${sender}`
}

const logger = pino({ level: 'warn' })

async function start() {
  await initCutStore()
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    // Vamos imprimir o QR nós mesmos, com mais contexto
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    qrTimeout: 120_000,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('\n📱 Abra o WhatsApp > Aparelhos conectados > Conectar um aparelho')
      console.log('   e escaneie o QR code abaixo:\n')
      qrcode.generate(qr, { small: true })
      // Também salva como imagem (mais fácil de escanear)
      QRCode.toFile('qr.png', qr, { width: 400, margin: 2 })
        .then(() => console.log('🖼️  QR também salvo em qr.png'))
        .catch((e) => console.error('Não consegui salvar qr.png:', e.message))
    }

    if (connection === 'open') {
      console.log('\n✅ Bot conectado! Modo:', config.mode)
      if (config.mode === 'mention') {
        console.log('   Em grupos: transcreve só quando MARCAREM o bot (@). No privado: direto.')
      } else if (config.mode === 'command') {
        console.log(`   Para transcrever: responda a um áudio/vídeo com "${config.commandTrigger}"`)
      } else {
        console.log('   Transcrevendo automaticamente todo áudio/vídeo recebido.')
      }
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut
      console.log('🔌 Conexão fechada.', shouldReconnect ? 'Reconectando...' : 'Você foi deslogado.')
      if (shouldReconnect) start()
      else console.log('   Apague a pasta "auth" e rode de novo para reconectar.')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      try {
        await handleMessage(sock, msg)
      } catch (err) {
        console.error('Erro ao processar mensagem:', err?.message || err)
      }
    }
  })
}

async function handleMessage(sock, msg) {
  if (!msg.message || msg.key.fromMe) return
  const jid = msg.key.remoteJid
  if (!jid || jid === 'status@broadcast') return

  // Mensagem de "CORREÇÃO" para um vídeo já legendado? Trata antes de tudo
  // (sem precisar marcar o bot), pois a palavra-chave já deixa claro.
  const sender = msg.key.participant || jid
  const pending = pendingCaptions.get(pendingKey(jid, sender))
  if (pending) {
    if (Date.now() - pending.ts > PENDING_TTL) {
      pendingCaptions.delete(pendingKey(jid, sender))
    } else if (!getMedia(msg.message)) {
      const correction = parseCorrection(getText(msg.message))
      if (correction) {
        pendingCaptions.delete(pendingKey(jid, sender))
        await handleCorrection(sock, jid, msg, pending, correction)
        return
      }
    }
  }

  // CORTE: responder à mensagem de transcrição + palavra "corte".
  if (!getMedia(msg.message) && /\bcorte\b|\bcortar\b/i.test(getText(msg.message))) {
    const quotedId = getContextInfo(msg.message)?.stanzaId
    const cut = getCut(quotedId) || getCut(senderLatestCut.get(pendingKey(jid, sender)))
    if (cut) {
      await handleCut(sock, jid, msg, cut)
      return
    }
  }

  let target // a mensagem que realmente contém a mídia
  let media

  if (config.mode === 'mention') {
    // Em grupo: só age quando MARCAM (@) o bot. No privado: age direto.
    const botIds = botIdentifiers(sock)
    const mentioned = isBotMentioned(msg.message, botIds)
    // [DIAG temporário] ajuda a confirmar a detecção de menção com mensagens reais
    if (isGroup(jid)) {
      console.log(
        `[mention] grupo | marcado=${mentioned} | mentionedJid=${JSON.stringify(
          getContextInfo(msg.message)?.mentionedJid || []
        )} | botIds=${JSON.stringify(botIds)}`
      )
    }
    if (isGroup(jid) && !mentioned) return

    // Mídia na própria mensagem (ex.: vídeo com legenda marcando o bot)?
    media = getMedia(msg.message)
    if (media) {
      target = msg
    } else {
      // Ou é uma resposta a um áudio/vídeo (marcando o bot)?
      const ctx = getContextInfo(msg.message)
      const quoted = ctx?.quotedMessage
      media = getMedia(quoted)
      if (!media) {
        // Só ensina o uso se realmente chamaram o bot (evita ruído no grupo)
        if (mentioned) {
          await sock.sendMessage(
            jid,
            { text: '🎧 Me marque *respondendo* a um áudio ou vídeo que eu transcrevo!' },
            { quoted: msg }
          )
        }
        return
      }
      target = {
        key: {
          remoteJid: jid,
          id: ctx.stanzaId,
          participant: ctx.participant,
          fromMe: botIds.includes(normalizeId(ctx.participant)),
        },
        message: quoted,
      }
    }
  } else if (config.mode === 'command') {
    // Só age quando alguém responde a uma mídia com a palavra-chave
    const ext = msg.message.extendedTextMessage
    const text = (ext?.text || '').toLowerCase()
    if (!text.includes(config.commandTrigger)) return

    const ctx = ext?.contextInfo
    const quoted = ctx?.quotedMessage
    media = getMedia(quoted)
    if (!media) {
      await sock.sendMessage(
        jid,
        { text: `❓ Responda a um *áudio* ou *vídeo* com "${config.commandTrigger}" para eu transcrever.` },
        { quoted: msg }
      )
      return
    }
    // Reconstrói a mensagem citada para conseguir baixar a mídia
    target = {
      key: {
        remoteJid: jid,
        id: ctx.stanzaId,
        participant: ctx.participant,
        fromMe: botIdentifiers(sock).includes(normalizeId(ctx.participant)),
      },
      message: quoted,
    }
  } else {
    // Modo auto: transcreve qualquer áudio/vídeo recebido
    media = getMedia(msg.message)
    if (!media) return
    target = msg
  }

  // Pedido de LEGENDA (queimar legenda no vídeo) = vídeo + palavra "legenda".
  // Senão, transcreve em texto como sempre.
  const reqText = getText(msg.message).toLowerCase()
  if (media.kind === 'video' && /legend/.test(reqText)) {
    await captionAndSend(sock, jid, msg, target)
  } else {
    await transcribeAndReply(sock, jid, msg, target, media)
  }
}

/** Legenda o vídeo: transcreve, RENDERIZA e manda o vídeo + o texto (pra correção). */
async function captionAndSend(sock, jid, requestMsg, target) {
  await sock.sendMessage(jid, { react: { text: '✍️', key: requestMsg.key } }).catch(() => {})
  let buffer
  let words
  try {
    const dlTarget = { key: target.key, message: unwrap(target.message) }
    buffer = await downloadMediaMessage(dlTarget, 'buffer', {}, { logger, reqMediaUpload: sock.updateMediaMessage })
    words = await transcribeForCaption(buffer)
  } catch (err) {
    console.error('Falha ao ler vídeo:', err?.message || err)
    await sock.sendMessage(jid, { text: '❌ Não consegui ler esse vídeo. Tenta outro?' }, { quoted: requestMsg }).catch(() => {})
    return
  }
  if (!words.length) {
    await sock.sendMessage(jid, { text: '🤔 Não identifiquei fala nesse vídeo.' }, { quoted: requestMsg }).catch(() => {})
    return
  }
  await deliverCaption(sock, jid, requestMsg, buffer, words)
}

/** Correção: aplica o texto certo e re-renderiza. */
async function handleCorrection(sock, jid, msg, pending, correctedText) {
  const words = applyEdit(pending.words, correctedText)
  await deliverCaption(sock, jid, msg, pending.videoBuffer, words)
}

/** Renderiza, envia o vídeo legendado + o texto, e guarda o estado p/ correção. */
async function deliverCaption(sock, jid, replyTo, videoBuffer, words) {
  await sock.sendMessage(jid, { react: { text: '🎬', key: replyTo.key } }).catch(() => {})
  await sock.sendMessage(jid, { text: '🎬 Gerando a legenda... leva ~1 min.' }, { quoted: replyTo }).catch(() => {})
  let outPath
  try {
    outPath = await renderCaption(videoBuffer, words)
    const video = await readFile(outPath)
    await sock.sendMessage(jid, { video, caption: '✅ Legendado!' }, { quoted: replyTo })
    await sock.sendMessage(jid, {
      text:
        `📝 *Transcrição:*\n${formatTimedText(words)}\n\n` +
        'Pra corrigir, mande *CORREÇÃO* + a parte certa:\n' +
        '• "errada → certa" (só o que mudou), ou\n' +
        '• o texto completo corrigido',
    })
    await sock.sendMessage(jid, { react: { text: '✅', key: replyTo.key } }).catch(() => {})
    // guarda p/ permitir correção depois
    const sender = replyTo.key.participant || jid
    pendingCaptions.set(pendingKey(jid, sender), { videoBuffer, words, ts: Date.now() })
  } catch (err) {
    console.error('Falha ao renderizar legenda:', err?.message || err)
    await sock.sendMessage(jid, { text: '❌ Não consegui gerar a legenda. Tenta um vídeo mais curto?' }, { quoted: replyTo }).catch(() => {})
    await sock.sendMessage(jid, { react: { text: '❌', key: replyTo.key } }).catch(() => {})
  } finally {
    if (outPath) await rm(outPath, { force: true }).catch(() => {})
  }
}

async function transcribeAndReply(sock, jid, replyTo, target, media) {
  // Reage com ampulheta para mostrar que está processando
  await sock.sendMessage(jid, { react: { text: '⏳', key: replyTo.key } }).catch(() => {})

  let cleanup = () => {}
  try {
    const dlTarget = { key: target.key, message: unwrap(target.message) }
    const buffer = await downloadMediaMessage(
      dlTarget,
      'buffer',
      {},
      { logger, reqMediaUpload: sock.updateMediaMessage }
    )

    const extracted = await extractAudio(buffer, media.ext)
    cleanup = extracted.cleanup

    if (config.maxDuration > 0 && extracted.duration > config.maxDuration) {
      await sock.sendMessage(
        jid,
        {
          text:
            `⚠️ Esse ${media.kind} tem ${formatDuration(extracted.duration)} e passa do limite ` +
            `de ${formatDuration(config.maxDuration)}. Não vou transcrever para evitar custo/erro.`,
        },
        { quoted: replyTo }
      )
      await sock.sendMessage(jid, { react: { text: '⚠️', key: replyTo.key } }).catch(() => {})
      return
    }

    const text = await transcribe(extracted.audio, { durationSeconds: extracted.duration })

    if (!text) {
      await sock.sendMessage(jid, { text: '🤔 Não consegui identificar fala nesse áudio.' }, { quoted: replyTo })
      await sock.sendMessage(jid, { react: { text: '❌', key: replyTo.key } }).catch(() => {})
      return
    }

    const header = `📝 *Transcrição* (${formatDuration(extracted.duration)})\n\n`
    const sent = await sock.sendMessage(jid, { text: header + text }, { quoted: replyTo })
    await sock.sendMessage(jid, { react: { text: '✅', key: replyTo.key } }).catch(() => {})
    if (media.kind === 'video') {
      await offerCut(sock, jid, replyTo, buffer, text, sent?.key?.id)
    }
  } catch (err) {
    console.error('Falha na transcrição:', err?.message || err)
    await sock.sendMessage(jid, { text: '❌ Deu erro ao transcrever. Tenta de novo daqui a pouco.' }, { quoted: replyTo }).catch(() => {})
    await sock.sendMessage(jid, { react: { text: '❌', key: replyTo.key } }).catch(() => {})
  } finally {
    await cleanup()
  }
}

/** Após transcrever um vídeo, guarda-o (por ID da transcrição) e oferece o CORTE. */
async function offerCut(sock, jid, replyTo, videoBuffer, srtText, transcriptionId) {
  const blocks = parseSrtBlocks(srtText)
  if (!blocks.length || !transcriptionId) return
  try {
    await saveCut(transcriptionId, videoBuffer, blocks)
  } catch (err) {
    console.error('Falha ao guardar vídeo p/ corte:', err?.message || err)
    return
  }
  senderLatestCut.set(pendingKey(jid, replyTo.key.participant || jid), transcriptionId)
  await sock
    .sendMessage(jid, {
      text:
        '✂️ Quer *cortar* um trecho? *Responda a transcrição* acima com *CORTE* + início e fim — ' +
        'cole os blocos (ou os tempos), ex:\n*CORTE* do bloco 19 até o 42',
    })
    .catch(() => {})
}

/** Corta o trecho pedido e envia o vídeo (permite mais cortes do mesmo vídeo). */
async function handleCut(sock, jid, msg, pending) {
  const range = parseCutRange(getText(msg.message), pending.blocks)
  if (!range || range.end - range.start < 0.5) {
    await sock
      .sendMessage(jid, { text: '❓ Não entendi o trecho. Mande *CORTE* com os tempos (ou números de bloco) de início e fim.' }, { quoted: msg })
      .catch(() => {})
    return
  }
  await sock.sendMessage(jid, { react: { text: '✂️', key: msg.key } }).catch(() => {})
  await sock
    .sendMessage(jid, { text: `✂️ Cortando ${fmtClock(range.start)}–${fmtClock(range.end)}...` }, { quoted: msg })
    .catch(() => {})
  let outPath
  try {
    outPath = await cutVideo(pending.videoPath, range.start, range.end)
    const video = await readFile(outPath)
    await sock.sendMessage(
      jid,
      { video, caption: `✅ Trecho ${fmtClock(range.start)}–${fmtClock(range.end)}. Pra legendar, responda este vídeo com *legenda*.` },
      { quoted: msg }
    )
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
  } catch (err) {
    console.error('Falha ao cortar:', err?.message || err)
    await sock.sendMessage(jid, { text: '❌ Não consegui cortar esse trecho.' }, { quoted: msg }).catch(() => {})
  } finally {
    if (outPath) await rm(outPath, { force: true }).catch(() => {})
  }
}

function fmtClock(sec) {
  const t = Math.max(0, Math.round(sec))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function formatDuration(seconds) {
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}m${String(r).padStart(2, '0')}s` : `${r}s`
}

start()
