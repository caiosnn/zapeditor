// Cliente do Google Drive: login por refresh token, cria/acha pastas e sobe
// arquivos por STREAMING (aguenta vídeo grande sem carregar tudo na RAM).
// Escopo usado: drive.file -> o bot só enxerga/gerencia o que ELE mesmo criou.
import { google } from 'googleapis'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { config } from './config.js'

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file']
const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const TOKEN_PATH = join('auth', 'google.json')

let _drive = null
const folderCache = new Map() // `${parentId}/${name}` -> folderId

/** OAuth2 client já com o refresh token salvo (gerado por `npm run drive-auth`). */
export async function getAuthClient() {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados no .env')
  }
  let token
  try {
    token = JSON.parse(await readFile(TOKEN_PATH, 'utf8'))
  } catch {
    throw new Error('Login do Google ausente. Rode: npm run drive-auth')
  }
  if (!token.refresh_token) throw new Error('auth/google.json sem refresh_token. Rode: npm run drive-auth')
  const oauth2 = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret)
  oauth2.setCredentials({ refresh_token: token.refresh_token })
  return oauth2
}

async function getDrive() {
  if (_drive) return _drive
  const auth = await getAuthClient()
  _drive = google.drive({ version: 'v3', auth })
  return _drive
}

function escapeQuery(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Acha uma pasta pelo nome dentro de `parentId` (ou null). */
async function findFolder(drive, name, parentId) {
  const q = [
    `mimeType='${FOLDER_MIME}'`,
    'trashed=false',
    `name='${escapeQuery(name)}'`,
    `'${parentId}' in parents`,
  ].join(' and ')
  const res = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 1, spaces: 'drive' })
  return res.data.files?.[0]?.id || null
}

/** Garante uma pasta (acha ou cria) dentro de `parentId`. Cacheia o id. */
export async function ensureFolder(name, parentId = 'root') {
  const cacheKey = `${parentId}/${name}`
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)
  const drive = await getDrive()
  let id = await findFolder(drive, name, parentId)
  if (!id) {
    const res = await drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      fields: 'id',
    })
    id = res.data.id
  }
  folderCache.set(cacheKey, id)
  return id
}

/** Resolve um caminho aninhado a partir da raiz (My Drive) e devolve o id da última pasta. */
export async function ensureFolderPath(parts) {
  let parent = 'root'
  for (const part of parts) parent = await ensureFolder(part, parent)
  return parent
}

let _rootShared = false
/** Como ensureFolderPath, mas garante que a pasta RAIZ esteja compartilhada (link público). */
export async function ensureArchivePath(parts) {
  const [root, ...rest] = parts
  let parent = await ensureFolder(root, 'root')
  if (!_rootShared) {
    try {
      await shareAnyone(parent) // herda para subpastas/arquivos
    } catch {
      /* já compartilhada ou bloqueada por política */
    }
    _rootShared = true
  }
  for (const p of rest) parent = await ensureFolder(p, parent)
  return parent
}

/** Compartilha um item como "qualquer pessoa com o link pode ver". */
export async function shareAnyone(fileId) {
  const drive = await getDrive()
  await drive.permissions.create({ fileId, requestBody: { type: 'anyone', role: 'reader' } })
}

/** Link navegável de uma pasta. */
export function folderLink(id) {
  return `https://drive.google.com/drive/folders/${id}`
}

/** Sobe um arquivo (a partir de um Readable stream) e devolve { id, webViewLink, size }. */
export async function uploadStream({ name, parentId, mimeType, stream }) {
  const drive = await getDrive()
  const res = await drive.files.create({
    requestBody: { name, parents: parentId ? [parentId] : undefined },
    media: { mimeType: mimeType || 'application/octet-stream', body: stream },
    fields: 'id,webViewLink,size',
  })
  return res.data
}

/** Confere se o login está OK (usado no boot e no script de auth). */
export async function checkDrive() {
  const drive = await getDrive()
  const res = await drive.about.get({ fields: 'user(emailAddress,displayName)' })
  return res.data.user
}
