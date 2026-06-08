// Pipeline das "criações": baixa o vídeo final do NAS (link gofile do servidor) e sobe pro
// Google Drive em Criações/<cliente>/, devolvendo um link público vinculável à demanda.
// Depois, a recuperação por tema usa o vault pra achar e reenviar os vídeos de um assunto.
import { createReadStream } from 'node:fs'
import { basename, extname } from 'node:path'
import { config } from './config.js'
import { ensureFolderPath, uploadStream, shareAnyone, listFiles, findFolderPath } from './drive.js'
import { downloadFromShare, downloadByCode, downloadFromFolder, downloadFolderMedia } from './synology-dl.js'

const VIDEO_MIME = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.m4v': 'video/x-m4v',
}

/** Sobe um arquivo local pro Drive em Criações/<cliente>/ e compartilha (link público). */
export async function uploadCreation({ filePath, cliente, filename }) {
  const name = filename || basename(filePath)
  const parentId = await ensureFolderPath([config.creationsRootFolder, cliente || 'Geral'])
  const ext = extname(name).toLowerCase()
  const res = await uploadStream({
    name, parentId, mimeType: VIDEO_MIME[ext] || 'application/octet-stream', stream: createReadStream(filePath),
  })
  await shareAnyone(res.id).catch(() => {}) // link "qualquer um com o link"
  return { fileId: res.id, driveLink: res.webViewLink, filename: name, size: res.size }
}

/**
 * Baixa a criação do NAS (link gofile) e sobe pro Drive. Se `localPath` vier, pula o download.
 * @returns {Promise<{driveLink, fileId, filename, nasPath, size}>}
 */
export async function archiveCreation({ codigo, shareUrl, cliente, localPath, nasPath: folderPath }) {
  // Caminho do catálogo: baixa o(s) arquivo(s) final(is) da pasta — vídeo OU card/carrossel.
  if (folderPath && !localPath) {
    const files = await downloadFolderMedia({ nasPath: folderPath })
    const ups = []
    for (const f of files) ups.push(await uploadCreation({ filePath: f.path, cliente, filename: f.filename }))
    return { driveLink: ups[0].driveLink, filename: ups[0].filename, size: ups[0].size, count: ups.length, all: ups }
  }
  // Fallback (1 arquivo): por código (search) ou pelo link do servidor.
  let filePath = localPath
  let filename
  let nasPath
  if (!filePath) {
    const dl = codigo ? await downloadByCode({ codigo }) : await downloadFromShare({ url: shareUrl })
    filePath = dl.path
    filename = dl.filename
    nasPath = dl.nasPath
  }
  const up = await uploadCreation({ filePath, cliente, filename })
  return { ...up, nasPath, count: 1 }
}

/** Lista as criações já no Drive de um cliente -> [{id,name,...}]. */
export async function listCreations(cliente, { nameContains = '' } = {}) {
  const parentId = await findFolderPath([config.creationsRootFolder, cliente])
  if (!parentId) return []
  return listFiles(parentId, { nameContains })
}

// CLI: node src/creations.js upload <filePath> <cliente>
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/creations.js')) {
  const [, , cmd, a, b] = process.argv
  if (cmd === 'upload') {
    uploadCreation({ filePath: a, cliente: b })
      .then((r) => console.log('OK:', JSON.stringify(r)))
      .catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
  } else {
    console.log('uso: node src/creations.js upload <filePath> <cliente>')
  }
}
