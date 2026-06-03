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
import { consultExpert, isAffirmative, isNegative } from './expert.js'
import { initExpertStore, appendHistory, setPrefs } from './expert-store.js'
import { generateImage, generateVideo, estimateCost, downloadBuffer } from './higgsfield.js'
import { classifyAttachment, archivePath, buildFileName, isDriveRequest, parseDriveDate, dayFolderName } from './archive.js'
import { ensureArchivePath, uploadStream, folderLink } from './drive.js'
import { initArchiveStore, wasArchived, markArchived } from './archive-store.js'
import { initSettings, isGroupArchived, getArchiveEnabled, setGroupArchived } from './settings.js'
import { startWeb } from './web.js'
import { interpretArchiveCommand } from './archive-nlu.js'
import {
  getMedia,
  getImage,
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
// gerações de vídeo aguardando confirmação de custo (chave: `${jid}|${sender}`)
const pendingGenerations = new Map()
// Listas numeradas de grupos mostradas ao admin no privado: jid -> { jids, ts }
const adminLists = new Map()
const PENDING_TTL = 30 * 60 * 1000

// Conexão atual + estado, compartilhados com a interface web.
let currentSock = null
let webStarted = false
let connState = { connected: false, since: null, me: null }

function pendingKey(jid, sender) {
  return `${jid}|${sender}`
}

/** Esse JID (no privado) é um número autorizado a gerenciar o arquivamento? */
function isAdmin(jid) {
  return config.adminNumbers.includes(normalizeId(jid))
}

const logger = pino({ level: 'warn' })

async function start() {
  await initCutStore()
  await initExpertStore()
  await initArchiveStore()
  await initSettings()
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
  currentSock = sock

  if (config.webEnabled && !webStarted) {
    webStarted = true
    startWeb({ getSock: () => currentSock, getStatus: () => connState })
  }

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
      connState = { connected: true, since: Date.now(), me: normalizeId(sock.user?.id || '') || null }
      console.log('\n✅ Bot conectado! Modo:', config.mode)
      if (config.mode === 'mention') {
        console.log('   Em grupos: transcreve só quando MARCAREM o bot (@). No privado: direto.')
      } else if (config.mode === 'command') {
        console.log(`   Para transcrever: responda a um áudio/vídeo com "${config.commandTrigger}"`)
      } else {
        console.log('   Transcrevendo automaticamente todo áudio/vídeo recebido.')
      }
      if (config.archiveDiscover) listGroupsForDiscovery(sock)
    }

    if (connection === 'close') {
      connState.connected = false
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

  const sender = msg.key.participant || jid
  const key = pendingKey(jid, sender)
  const text = getText(msg.message)
  const ownMedia = getMedia(msg.message) // áudio/vídeo na própria mensagem
  const botIds = botIdentifiers(sock)
  const mentioned = isBotMentioned(msg.message, botIds)
  const directed = !isGroup(jid) || mentioned // privado sempre; em grupo, só com @

  if (config.archiveDiscover && !isGroup(jid)) logPrivateOnce(jid, msg.pushName)

  // 0) ARQUIVAMENTO automático no Drive (grupos ligados na interface web). Roda em
  //    paralelo ao fluxo normal: NÃO dá return, transcrição/legenda seguem funcionando.
  if (isGroup(jid)) {
    if (config.archiveDiscover) logGroupOnce(sock, jid)
    if (isGroupArchived(jid)) {
      maybeArchive(sock, msg, jid).catch((e) => console.error('Arquivamento falhou:', e?.message || e))
    }
  }

  // 0.5) ADMIN: ver/mudar o arquivamento em LINGUAGEM NATURAL — no privado, ou
  //      marcando o bot (@) num grupo. A intenção é interpretada por IA.
  if (isAdmin(sender) && directed) {
    const pend = adminLists.get(jid)
    if (pend && Date.now() - pend.ts < PENDING_TTL && /^\s*\d+\s*$/.test(text)) {
      await handleAdminToggle(sock, jid, msg, pend, parseInt(text, 10))
      return
    }
    if (/grupo|arquiv|salv/i.test(text)) {
      await handleAdminCommand(sock, jid, msg, isGroup(jid) ? jid : null)
      return
    }
  }

  // 1) Confirmação de uma geração de VÍDEO pendente (resposta sim/não).
  const pgen = pendingGenerations.get(key)
  if (pgen && !ownMedia && text) {
    if (Date.now() - pgen.ts > PENDING_TTL) {
      pendingGenerations.delete(key)
    } else if (isNegative(text)) {
      pendingGenerations.delete(key)
      await sock.sendMessage(jid, { text: '👍 Beleza, cancelei. Quer ajustar algo?' }, { quoted: msg }).catch(() => {})
      return
    } else if (isAffirmative(text)) {
      pendingGenerations.delete(key)
      await executeGeneration(sock, jid, msg, pgen)
      return
    } else {
      pendingGenerations.delete(key) // não foi sim/não: trata como novo pedido
    }
  }

  // 2) CORREÇÃO de uma legenda recém-gerada (palavra-chave, sem mídia).
  const pending = pendingCaptions.get(key)
  if (pending) {
    if (Date.now() - pending.ts > PENDING_TTL) {
      pendingCaptions.delete(key)
    } else if (!ownMedia) {
      const correction = parseCorrection(text)
      if (correction) {
        pendingCaptions.delete(key)
        await handleCorrection(sock, jid, msg, pending, correction)
        return
      }
    }
  }

  // 3) CORTE: responder à transcrição + palavra "corte".
  if (!ownMedia && /\bcorte\b|\bcortar\b/i.test(text)) {
    const quotedId = getContextInfo(msg.message)?.stanzaId
    const cut = getCut(quotedId) || getCut(senderLatestCut.get(key))
    if (cut) {
      await handleCut(sock, jid, msg, cut)
      return
    }
  }

  // 3.5) Pedido do link do Drive: "@bot me envie o drive de hoje".
  if (getArchiveEnabled() && directed && !ownMedia && isDriveRequest(text)) {
    await handleDriveLink(sock, jid, msg, text)
    return
  }

  // 4) Resolve áudio/vídeo-alvo (na própria msg ou citada) p/ TRANSCRIÇÃO/LEGENDA.
  let target
  let media
  if (config.mode === 'command') {
    if ((msg.message.extendedTextMessage?.text || '').toLowerCase().includes(config.commandTrigger)) {
      const ctx = getContextInfo(msg.message)
      media = getMedia(ctx?.quotedMessage)
      if (media) target = rebuildTarget(jid, ctx, botIds)
    }
  } else {
    // modos 'mention' e 'auto'
    if (config.mode === 'mention' && isGroup(jid) && !mentioned) return // grupo: não é pra mim
    if (ownMedia) {
      media = ownMedia
      target = msg
    } else {
      const ctx = getContextInfo(msg.message)
      media = getMedia(ctx?.quotedMessage)
      if (media) target = rebuildTarget(jid, ctx, botIds)
    }
  }

  // 4a) Tem áudio/vídeo → transcrição ou legenda (comportamento original).
  if (media && target) {
    if (media.kind === 'video' && /legend/.test(text.toLowerCase())) {
      await captionAndSend(sock, jid, msg, target)
    } else {
      await transcribeAndReply(sock, jid, msg, target, media)
    }
    return
  }

  // 4b) Sem áudio/vídeo, mas é pra mim e tem texto/imagem → ESPECIALISTA de IA.
  if (config.expertEnabled && directed && (text || getImage(msg.message))) {
    await handleExpert(sock, jid, msg, sender)
    return
  }

  // 4c) Chamaram o bot sem nada acionável → dica curta.
  if (mentioned) {
    await sock
      .sendMessage(jid, { text: '👋 Manda um *áudio/vídeo* que eu transcrevo, ou me peça uma *imagem/vídeo de IA*!' }, { quoted: msg })
      .catch(() => {})
  }
}

/** (descoberta) loga "nome do grupo -> JID" uma vez por grupo, pra você achar o JID. */
const discoveredGroups = new Set()
function logGroupOnce(sock, jid) {
  if (discoveredGroups.has(jid)) return
  discoveredGroups.add(jid)
  sock
    .groupMetadata(jid)
    .then((meta) => console.log(`📋 GRUPO: "${meta?.subject || '?'}"  ->  ARCHIVE_GROUPS=${jid}`))
    .catch(() => console.log(`📋 GRUPO  ->  ARCHIVE_GROUPS=${jid}`))
}

/** (descoberta) loga o número de quem manda no PRIVADO uma vez, pra cadastrar admin. */
const discoveredPrivate = new Set()
function logPrivateOnce(jid, name) {
  if (discoveredPrivate.has(jid)) return
  discoveredPrivate.add(jid)
  console.log(`📨 PRIVADO de "${name || '?'}"  ->  ADMIN_NUMBERS=${normalizeId(jid)}`)
}

/** (descoberta) lista TODOS os grupos e seus JIDs no log, pra você achar o de edição. */
async function listGroupsForDiscovery(sock) {
  try {
    const groups = Object.values(await sock.groupFetchAllParticipating())
    console.log(`\n📋 ${groups.length} grupos — copie o JID do grupo de edição pra ARCHIVE_GROUPS no .env:`)
    for (const g of groups) console.log(`   • "${g.subject}"  ->  ${g.id}`)
    console.log('')
  } catch (e) {
    console.error('Não consegui listar os grupos:', e?.message || e)
  }
}

/** Baixa o anexo (streaming) e sobe pro Drive em [raiz/AAAA-MM-DD/Tipo]. Reage ✅ no fim. */
async function maybeArchive(sock, msg, jid) {
  const att = classifyAttachment(msg.message)
  if (!att) return // mensagem sem anexo (texto puro)
  const id = msg.key.id
  if (wasArchived(id)) return // reentrega do WhatsApp: já subimos

  const now = new Date()
  const dlTarget = { key: msg.key, message: unwrap(msg.message) }
  const stream = await downloadMediaMessage(dlTarget, 'stream', {}, { logger, reqMediaUpload: sock.updateMediaMessage })
  const folderId = await ensureArchivePath(archivePath({ rootName: config.archiveRootFolder, date: now, kind: att.kind }))
  const sender = msg.pushName || normalizeId(msg.key.participant || jid)
  const name = buildFileName({ date: now, sender, fileName: att.fileName, ext: att.ext })
  await uploadStream({ name, parentId: folderId, mimeType: att.mimetype, stream })
  await markArchived(id)
  await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
  console.log(`📥 Arquivado: ${name}`)
}

/** (admin) Interpreta o comando por IA e executa: listar / ligar / desligar arquivamento. */
async function handleAdminCommand(sock, jid, msg, currentGroupJid) {
  const text = getText(msg.message)
  let groups
  try {
    groups = Object.values(await sock.groupFetchAllParticipating())
      .map((g) => ({ jid: g.id, name: g.subject || '(sem nome)' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  } catch {
    await sock.sendMessage(jid, { text: '❌ Não consegui acessar os grupos agora. Tenta de novo daqui a pouco.' }, { quoted: msg }).catch(() => {})
    return
  }
  const withStatus = groups.map((g) => ({ ...g, archived: isGroupArchived(g.jid) }))

  let intent
  try {
    intent = await interpretArchiveCommand({ text, groups: withStatus, currentGroupJid })
  } catch (e) {
    console.error('Interpretação de arquivamento falhou:', e?.message || e)
    await handleAdminList(sock, jid, msg) // fallback: mostra a lista numerada
    return
  }

  if (intent.intent === 'list_archived') {
    const on = withStatus.filter((g) => g.archived)
    const txt = on.length
      ? '📁 *Arquivando agora:*\n' + on.map((g) => `• ${g.name}`).join('\n')
      : '📁 Nenhum grupo está sendo arquivado no momento.'
    await sock.sendMessage(jid, { text: txt }, { quoted: msg }).catch(() => {})
    return
  }

  if (intent.intent === 'list_groups') {
    await handleAdminList(sock, jid, msg)
    return
  }

  if (intent.intent === 'set') {
    const g = withStatus[intent.groupIndex - 1]
    if (!g) {
      await sock
        .sendMessage(jid, { text: intent.reply || '❓ Não entendi qual grupo. Me pergunta "quais grupos você está?" que eu listo.' }, { quoted: msg })
        .catch(() => {})
      return
    }
    const enable = intent.enable === null ? !g.archived : intent.enable
    await setGroupArchived(g.jid, enable)
    await sock
      .sendMessage(jid, { text: (enable ? '✅ Agora *arquivando*: ' : '⬜ *Parei* de arquivar: ') + g.name }, { quoted: msg })
      .catch(() => {})
    return
  }

  // none
  await sock
    .sendMessage(
      jid,
      { text: intent.reply || '🤔 Posso *listar seus grupos*, dizer *quais estão sendo arquivados*, ou *arquivar/parar* um grupo. Ex: "arquive o grupo Tal".' },
      { quoted: msg },
    )
    .catch(() => {})
}

/** (admin) Mostra a lista numerada de grupos com o status (e guarda pra resposta por número). */
async function handleAdminList(sock, jid, msg) {
  let groups
  try {
    groups = Object.values(await sock.groupFetchAllParticipating())
      .map((g) => ({ jid: g.id, name: g.subject || '(sem nome)' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  } catch {
    await sock.sendMessage(jid, { text: '❌ Não consegui listar os grupos agora. Tenta de novo daqui a pouco.' }, { quoted: msg }).catch(() => {})
    return
  }
  adminLists.set(jid, { jids: groups.map((g) => g.jid), ts: Date.now() })
  const lines = groups.map((g, i) => `*${i + 1}.* ${isGroupArchived(g.jid) ? '✅' : '⬜'} ${g.name}`)
  await sock
    .sendMessage(jid, { text: '📁 *Arquivamento de grupos*\nResponda com o *número* pra ligar/desligar:\n\n' + lines.join('\n') }, { quoted: msg })
    .catch(() => {})
}

/** (admin, privado) Liga/desliga o arquivamento do grupo escolhido pelo número da lista. */
async function handleAdminToggle(sock, jid, msg, pend, n) {
  const target = pend.jids[n - 1]
  if (!target) {
    await sock.sendMessage(jid, { text: '❓ Número fora da lista. Mande *arquivamento* pra ver de novo.' }, { quoted: msg }).catch(() => {})
    return
  }
  const novo = !isGroupArchived(target)
  await setGroupArchived(target, novo)
  let nome = target
  try {
    nome = (await sock.groupMetadata(target)).subject || target
  } catch {
    /* sem metadata: usa o jid */
  }
  await sock
    .sendMessage(jid, { text: (novo ? '✅ Agora *arquivando*: ' : '⬜ *Parei* de arquivar: ') + nome }, { quoted: msg })
    .catch(() => {})
  await handleAdminList(sock, jid, msg)
}

/** Responde com o link da pasta do dia (sob demanda: "@bot me envie o drive de hoje"). */
async function handleDriveLink(sock, jid, msg, text) {
  const date = parseDriveDate(text, new Date())
  await sock.sendMessage(jid, { react: { text: '📁', key: msg.key } }).catch(() => {})
  try {
    const folderId = await ensureArchivePath([config.archiveRootFolder, dayFolderName(date)])
    await sock.sendMessage(
      jid,
      { text: `📁 *${dayFolderName(date)}:*\n${folderLink(folderId)}` },
      { quoted: msg },
    )
  } catch (e) {
    console.error('Falha ao montar link do Drive:', e?.message || e)
    await sock
      .sendMessage(jid, { text: '❌ Não consegui pegar o link agora. Tenta de novo daqui a pouco.' }, { quoted: msg })
      .catch(() => {})
  }
}

/** Reconstrói a mensagem citada (com mídia) para conseguir baixá-la. */
function rebuildTarget(jid, ctx, botIds) {
  return {
    key: {
      remoteJid: jid,
      id: ctx.stanzaId,
      participant: ctx.participant,
      fromMe: botIds.includes(normalizeId(ctx.participant)),
    },
    message: ctx.quotedMessage,
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
    await sendMediaDual(sock, jid, { kind: 'video', buffer: video, caption: '✅ Legendado!', baseName: 'legendado', quoted: replyTo })
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
    await sendMediaDual(sock, jid, {
      kind: 'video',
      buffer: video,
      caption: `✅ Trecho ${fmtClock(range.start)}–${fmtClock(range.end)}. Pra legendar, responda este vídeo com *legenda*.`,
      baseName: `corte_${Math.round(range.start)}-${Math.round(range.end)}s`,
      quoted: msg,
    })
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
  } catch (err) {
    console.error('Falha ao cortar:', err?.message || err)
    await sock.sendMessage(jid, { text: '❌ Não consegui cortar esse trecho.' }, { quoted: msg }).catch(() => {})
  } finally {
    if (outPath) await rm(outPath, { force: true }).catch(() => {})
  }
}

/** Especialista de IA: conversa e gera imagem/vídeo via Higgsfield. */
async function handleExpert(sock, jid, msg, sender) {
  const text = getText(msg.message)
  const image = getImage(msg.message)
  await sock.sendMessage(jid, { react: { text: '🧠', key: msg.key } }).catch(() => {})

  let decision
  try {
    decision = await consultExpert({ jid, userText: text || '(imagem enviada, sem texto)', hasImage: !!image })
  } catch (err) {
    console.error('Especialista falhou:', err?.message || err)
    await sock.sendMessage(jid, { text: '❌ Tive um problema pra pensar nisso. Tenta de novo.' }, { quoted: msg }).catch(() => {})
    return
  }

  await appendHistory(jid, 'user', text || '[imagem]')
  if (decision.savePrefs) await setPrefs(jid, decision.savePrefs)

  // Só conversa / consultoria.
  if (decision.action === 'none') {
    await sock.sendMessage(jid, { text: decision.reply || '🤔' }, { quoted: msg }).catch(() => {})
    await appendHistory(jid, 'assistant', decision.reply || '')
    return
  }

  const gen = {
    action: decision.action,
    model: decision.model,
    prompt: decision.prompt,
    params: decision.params,
    useReferenceImage: decision.useReferenceImage && !!image,
    imageMsg: image ? msg : null,
  }

  // IMAGEM: barata, gera direto.
  if (decision.action === 'image') {
    if (decision.reply) await sock.sendMessage(jid, { text: decision.reply }, { quoted: msg }).catch(() => {})
    await appendHistory(jid, 'assistant', `${decision.reply || ''} [gerando imagem: ${gen.model}]`)
    await executeGeneration(sock, jid, msg, gen)
    return
  }

  // VÍDEO: confirma o custo antes (se configurado).
  if (config.confirmVideo) {
    let credits = '?'
    try {
      credits = await estimateCost({ model: gen.model, prompt: gen.prompt, params: gen.params })
    } catch {
      /* segue sem o número */
    }
    pendingGenerations.set(pendingKey(jid, sender), { ...gen, ts: Date.now() })
    const dur = gen.params.duration ? `${gen.params.duration}s, ` : ''
    await sock
      .sendMessage(
        jid,
        { text: `${decision.reply || ''}\n\n🎬 *Vídeo* (${gen.model}, ${dur}${gen.params.quality || ''}) ≈ *${credits} créditos*.\nResponda *sim* pra gerar.` },
        { quoted: msg }
      )
      .catch(() => {})
    await appendHistory(jid, 'assistant', `${decision.reply || ''} [aguardando confirmação de vídeo ~${credits} créditos]`)
    return
  }

  if (decision.reply) await sock.sendMessage(jid, { text: decision.reply }, { quoted: msg }).catch(() => {})
  await executeGeneration(sock, jid, msg, gen)
}

/** Executa a geração (imagem/vídeo), baixa o resultado e envia no WhatsApp. */
async function executeGeneration(sock, jid, msg, gen) {
  await sock.sendMessage(jid, { react: { text: '🎨', key: msg.key } }).catch(() => {})
  await sock
    .sendMessage(
      jid,
      { text: gen.action === 'video' ? '🎬 Gerando o vídeo... pode levar alguns minutos.' : '🎨 Gerando a imagem...' },
      { quoted: msg }
    )
    .catch(() => {})

  let refPath
  try {
    if (gen.useReferenceImage && gen.imageMsg) {
      refPath = await downloadRefImage(sock, gen.imageMsg).catch(() => null)
    }
    const res =
      gen.action === 'video'
        ? await generateVideo({
            model: gen.model,
            prompt: gen.prompt,
            aspectRatio: gen.params.aspect_ratio,
            duration: gen.params.duration,
            quality: gen.params.quality,
            imagePath: refPath,
          })
        : await generateImage({
            model: gen.model,
            prompt: gen.prompt,
            aspectRatio: gen.params.aspect_ratio,
            resolution: gen.params.resolution,
            imagePath: refPath,
          })
    if (!res.ok || !res.urls.length) throw new Error('a geração não retornou resultado')

    const buffer = await downloadBuffer(res.urls[0])
    await sendMediaDual(sock, jid, {
      kind: gen.action === 'video' ? 'video' : 'image',
      buffer,
      caption: '✅ Pronto!',
      baseName: 'gerado',
      quoted: msg,
    })
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
  } catch (err) {
    console.error('Geração falhou:', err?.message || err)
    await sock.sendMessage(jid, { text: `❌ Não consegui gerar: ${err?.message || 'erro'}` }, { quoted: msg }).catch(() => {})
    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {})
  } finally {
    if (refPath) await rm(refPath, { force: true }).catch(() => {})
  }
}

/** Baixa a imagem (foto) de uma mensagem para um arquivo temporário (referência). */
async function downloadRefImage(sock, msg) {
  const m = unwrap(msg.message)
  const isDocImg = m?.documentMessage?.mimetype?.startsWith('image/')
  const node = m?.imageMessage || (isDocImg ? m.documentMessage : null)
  if (!node) return null
  const dlTarget = { key: msg.key, message: m?.imageMessage ? { imageMessage: node } : { documentMessage: node } }
  const buffer = await downloadMediaMessage(dlTarget, 'buffer', {}, { logger, reqMediaUpload: sock.updateMediaMessage })
  const path = join(tmpdir(), `hf_ref_${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg`)
  await writeFile(path, buffer)
  return path
}

/** Detecta o formato real da imagem pelos magic bytes (pra nomear o documento certo). */
function imageMeta(buffer) {
  if (buffer?.[0] === 0x89 && buffer?.[1] === 0x50) return { mime: 'image/png', ext: 'png' }
  if (buffer?.length > 11 && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return { mime: 'image/jpeg', ext: 'jpg' }
}

/** Envia a mídia como PREVIEW (inline, comprimido) e também como DOCUMENTO (qualidade original). */
async function sendMediaDual(sock, jid, { kind, buffer, caption, baseName, quoted }) {
  const ctx = quoted ? { quoted } : {}
  // 1) preview inline — visualização rápida, com a legenda
  await sock.sendMessage(jid, kind === 'video' ? { video: buffer, caption } : { image: buffer, caption }, ctx)
  // 2) documento — mesmo arquivo sem a recompressão do WhatsApp
  if (!config.sendOriginalDoc) return
  const meta = kind === 'video' ? { mime: 'video/mp4', ext: 'mp4' } : imageMeta(buffer)
  await sock
    .sendMessage(jid, { document: buffer, mimetype: meta.mime, fileName: `${baseName || 'arquivo'}.${meta.ext}`, caption: '📎 Qualidade original' })
    .catch((e) => console.error('Falha ao enviar documento original:', e?.message || e))
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
