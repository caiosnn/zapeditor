// Baixa o vídeo final de uma demanda do NAS Synology ("CloudPL", QuickConnect = gofile.me),
// via API HTTP do DSM autenticado por CONTA.
//
// Duas formas de localizar o arquivo:
//   • downloadByCode(codigo)  -> RECOMENDADO. Busca o .mp4 final pelo CÓDIGO da demanda
//     (SYNO.FileStation.Search em /REDES/CRIAÇÃO/CLIENTES). Independe de quem compartilhou o link
//     — o link de sharing pertence ao DA/Editor que o criou e não aparece para outras contas.
//   • downloadFromShare(url)  -> baixa pelo link gofile, SE o share for da conta logada.
// Em ambos: SYNO.API.Auth login -> acha {name,path} -> SYNO.FileStation.Download (streaming).
//
// ⚠️ A conta precisa estar SEM 2FA (conta de serviço) p/ login não-interativo, e ter leitura na
// pasta das criações. Sid é cacheado em data/synology-session.json (revalida em erro 119/106).
import { createWriteStream, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from './config.js'

const BASE = () => `https://${config.synologyHost}/webapi/entry.cgi`
const SESS_PATH = join('data', 'synology-session.json')
const SEARCH_ROOT = () => config.synologyCreationsRoot || '/REDES/CRIAÇÃO/CLIENTES'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let _sid = null

/** Extrai o código do share da URL: gofile.me/<id>/<code> ou .../sharing/<code>. PURO. */
export function shareCodeFromUrl(url) {
  if (!url) return null
  const m = /(?:gofile\.me\/[^/]+|\/sharing)\/([A-Za-z0-9_-]+)/.exec(url)
  return m ? m[1] : null
}

async function call(params, { raw = false } = {}) {
  const r = await fetch(`${BASE()}?${new URLSearchParams(params)}`)
  if (raw) return r
  const buf = Buffer.from(await r.arrayBuffer())
  return JSON.parse(buf.toString('utf8')) // força UTF-8 (paths com acento)
}

function cacheSid(sid) {
  _sid = sid
  try { mkdirSync('data', { recursive: true }); writeFileSync(SESS_PATH, JSON.stringify({ sid })) } catch { /* best-effort */ }
}

/** Login por conta -> sid. Lança SYNO_2FA_REQUIRED ou SYNO_AUTH_FAILED:<code>. */
export async function login() {
  if (!config.synologyHost || !config.synologyUser || !config.synologyPass) throw new Error('SYNOLOGY_NOT_CONFIGURED')
  const r = await call({
    api: 'SYNO.API.Auth', version: '7', method: 'login',
    account: config.synologyUser, passwd: config.synologyPass, session: 'FileStation', format: 'sid',
  })
  if (!r.success) {
    const code = r.error?.code
    if (code === 403 || code === 404 || code === 406) throw new Error('SYNO_2FA_REQUIRED')
    throw new Error('SYNO_AUTH_FAILED:' + code)
  }
  cacheSid(r.data.sid)
  return _sid
}

async function ensureSid() {
  if (_sid) return _sid
  try { const c = JSON.parse(readFileSync(SESS_PATH, 'utf8')).sid; if (c) return (_sid = c) } catch { /* sem cache */ }
  return login()
}

/** Reexecuta `fn(sid)`; se a sessão expirar (119/106), reloga uma vez. */
async function withSid(fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const sid = await ensureSid()
    const j = await fn(sid)
    if (j.success) return j
    if (j.error?.code === 119 || j.error?.code === 106) { _sid = null; continue }
    return j // erro não-sessão: deixa o chamador tratar
  }
  return { success: false, error: { code: 119 } }
}

/** Acha o share pelo código do link -> { id, name, path, isFolder } | null (só shares da conta logada). */
export async function findShare(code) {
  const j = await withSid((sid) => call({ api: 'SYNO.FileStation.Sharing', version: '3', method: 'list', _sid: sid, offset: '0', limit: '1000' }))
  if (!j.success) throw new Error('SYNO_LIST_FAILED:' + j.error?.code)
  return j.data?.links?.find((l) => l.id === code) || null
}

/** Busca o vídeo FINAL de uma demanda pelo código -> { name, path } | null. */
export async function findByCode(codigo) {
  const start = await withSid((sid) =>
    call({ api: 'SYNO.FileStation.Search', version: '2', method: 'start', folder_path: `"${SEARCH_ROOT()}"`, pattern: `"${codigo}"`, _sid: sid })
  )
  if (!start.success) throw new Error('SYNO_SEARCH_FAILED:' + start.error?.code)
  const taskid = start.data.taskid
  const sid = await ensureSid()
  let files = []
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    const r = await call({ api: 'SYNO.FileStation.Search', version: '2', method: 'list', taskid, offset: '0', limit: '200', _sid: sid })
    if (r.success) files = r.data?.files || [] // sem `additional` (quebrava a list e zerava os resultados)
    if (r.data?.finished) break
  }
  await call({ api: 'SYNO.FileStation.Search', version: '2', method: 'stop', taskid, _sid: sid }).catch(() => {})

  const vids = files.filter((f) => !f.isdir && /\.(mp4|mov|m4v)$/i.test(f.name))
  if (!vids.length) return null
  // preferência: pasta final/OUT > maior versão (v3>v2). Evita pastas de projeto (aberto/, auto-save, preview).
  const score = (f) => {
    let s = 0
    if (/\/(final|out)\//i.test(f.path)) s += 1000
    if (/\/(aberto|auto-save|preview)\//i.test(f.path)) s -= 1000
    const v = /_v(\d+)\b/i.exec(f.name)
    if (v) s += parseInt(v[1], 10) * 10
    return s
  }
  vids.sort((a, b) => score(b) - score(a) || b.name.localeCompare(a.name))
  return { name: vids[0].name, path: vids[0].path }
}

/** Baixa um arquivo do NAS por path (streaming) -> { path, filename, nasPath }. */
async function downloadPath({ name, nasPath, destDir }) {
  const dir = destDir || mkdtempSync(join(tmpdir(), 'syno-'))
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, name)
  const sid = await ensureSid()
  const r = await call(
    { api: 'SYNO.FileStation.Download', version: '2', method: 'download', path: nasPath, mode: 'download', _sid: sid },
    { raw: true }
  )
  if (!r.ok || !r.body) throw new Error('SYNO_DOWNLOAD_FAILED:' + r.status)
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest))
  return { path: dest, filename: name, nasPath }
}

/** Baixa o vídeo final de uma demanda pelo CÓDIGO (recomendado). */
export async function downloadByCode({ codigo, destDir }) {
  const file = await findByCode(codigo)
  if (!file) throw new Error('SYNO_NO_VIDEO_FOR_CODE')
  return downloadPath({ name: file.name, nasPath: file.path, destDir })
}

/** Baixa o vídeo final dado o PATH da pasta da demanda (rápido: List direto, sem search recursivo). */
export async function downloadFromFolder({ nasPath, destDir }) {
  for (const sub of ['/final', '/OUT', '/Final', '/out', '/FINAL', '']) {
    const files = await listDir(nasPath + sub)
    const vids = files.filter((f) => !f.isdir && /\.(mp4|mov|m4v)$/i.test(f.name))
    if (vids.length) {
      vids.sort((a, b) => b.name.localeCompare(a.name)) // maior versão / mais recente no nome
      return downloadPath({ name: vids[0].name, nasPath: vids[0].path, destDir })
    }
  }
  throw new Error('SYNO_NO_VIDEO_IN_FOLDER')
}

/** Baixa TODOS os arquivos de mídia finais da pasta da demanda: vídeo (maior versão) OU,
 *  se não houver vídeo, as imagens (card/carrossel). Retorna [{path, filename, nasPath}]. */
export async function downloadFolderMedia({ nasPath, destDir }) {
  let media = []
  for (const sub of ['/final', '/OUT', '/Final', '/out', '/FINAL', '']) {
    const files = await listDir(nasPath + sub)
    const m = files.filter((f) => !f.isdir && /\.(mp4|mov|m4v|png|jpe?g|webp|pdf)$/i.test(f.name))
    if (m.length) {
      const vids = m.filter((f) => /\.(mp4|mov|m4v)$/i.test(f.name))
      if (vids.length) { vids.sort((a, b) => b.name.localeCompare(a.name)); media = [vids[0]] } // vídeo: maior versão
      else media = m.slice(0, 15) // card/carrossel: até 15 imagens
      break
    }
  }
  if (!media.length) throw new Error('SYNO_NO_MEDIA_IN_FOLDER')
  const dir = destDir || mkdtempSync(join(tmpdir(), 'syno-'))
  mkdirSync(dir, { recursive: true })
  const out = []
  for (const f of media) out.push(await downloadPath({ name: f.name, nasPath: f.path, destDir: dir }))
  return out
}

/** Baixa pelo link de compartilhamento (só funciona se o share for da conta logada). */
export async function downloadFromShare({ url, destDir }) {
  const code = shareCodeFromUrl(url)
  if (!code) throw new Error('SYNO_BAD_URL')
  const share = await findShare(code)
  if (!share) throw new Error('SYNO_SHARE_NOT_FOUND')
  if (share.isFolder) throw new Error('SYNO_IS_FOLDER')
  return downloadPath({ name: share.name, nasPath: share.path, destDir })
}

/** Lista 1 nível de um diretório do NAS -> [{name, path, isdir}]. */
export async function listDir(folderPath) {
  const j = await withSid((sid) => call({ api: 'SYNO.FileStation.List', version: '2', method: 'list', folder_path: `"${folderPath}"`, _sid: sid, limit: '5000' }))
  if (!j.success) return []
  return (j.data?.files || []).map((f) => ({ name: f.name, path: f.path, isdir: !!f.isdir }))
}

/** Navega CLIENTES/<cliente>/CRIAÇÃO/<ano>/<mês>/<demanda> -> [{codigo, nome, path, ano, mes, cliente}]. */
export async function listDemandas(cliente) {
  const out = []
  const subs = await listDir(`${SEARCH_ROOT()}/${cliente}`)
  const criacao = subs.find((d) => d.isdir && /cria[çc][ãâa]o/i.test(d.name)) // "CRIAÇÃO" | "CRIAÇÂO" (typo) | etc
  if (!criacao) return out
  for (const ano of (await listDir(criacao.path)).filter((d) => d.isdir)) {
    for (const mes of (await listDir(ano.path)).filter((d) => d.isdir)) {
      for (const dem of (await listDir(mes.path)).filter((d) => d.isdir)) {
        const codigo = /([A-Za-z]{2,}\d{6,})/.exec(dem.name)?.[1] || null
        out.push({ codigo, nome: dem.name, path: dem.path, ano: ano.name, mes: mes.name, cliente })
      }
    }
  }
  return out
}

// CLI de teste: node src/synology-dl.js code <CODIGO> [destDir]  |  node src/synology-dl.js <url> [destDir]
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/synology-dl.js')) {
  const [, , a, b, c] = process.argv
  const run = a === 'code'
    ? downloadByCode({ codigo: b, destDir: c || 'C:/Users/Caio/Downloads/refs/_syno-download' })
    : downloadFromShare({ url: a || 'https://gofile.me/7nBfQ/m7f4jFU3M', destDir: b || 'C:/Users/Caio/Downloads/refs/_syno-download' })
  run.then((r) => console.log('OK:', JSON.stringify(r))).catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
}
