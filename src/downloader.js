// Media downloader: baixa vídeo/imagem de YouTube, X (Twitter), Instagram e TikTok.
//
// Stack 100% gratuita, sem APIs pagas:
//   • yt-dlp     -> vídeo das 4 plataformas (precisa de ffmpeg no PATH pro merge)
//   • instaloader-> Instagram posts/reels/stories (sessão persistente: login 1x, dura meses)
//   • gallery-dl -> foto pura de IG/X que o yt-dlp não pega
// Conteúdo logado (X, IG privado): cookies.txt (yt-dlp/gallery-dl) e/ou sessão do instaloader.
// Tudo chamado SEM shell (args literais), então a URL do usuário vai LITERAL — sem injeção.

import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname, basename } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { config } from './config.js'

// ---- Detecção de URL (pura, testável) -----------------------------------

const PLATFORMS = [
  { name: 'YouTube', images: false, re: /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s<>"']+/i },
  { name: 'X', images: true, re: /https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/[^\s<>"']+/i },
  { name: 'Instagram', images: true, re: /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s<>"']+/i },
  { name: 'TikTok', images: true, re: /https?:\/\/(?:www\.|vm\.|vt\.|m\.)?tiktok\.com\/[^\s<>"']+/i },
]

/**
 * Acha o 1º link de plataforma suportada no texto. PURO.
 * Retorna { url, platform, images } e, pro Instagram, também
 * { igKind: 'story'|'reel'|'post'|'other', shortcode?, username?, storyId? }. null se nada.
 */
export function detectMediaUrl(text) {
  if (!text) return null
  let best = null
  for (const p of PLATFORMS) {
    const m = p.re.exec(text)
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, url: trimUrl(m[0]), platform: p.name, images: p.images }
    }
  }
  if (!best) return null
  const hit = { url: best.url, platform: best.platform, images: best.images }
  if (best.platform === 'Instagram') Object.assign(hit, parseInstagram(best.url))
  return hit
}

/** Tipo de conteúdo do Instagram + identificadores (pro instaloader). PURO. */
export function parseInstagram(url) {
  let m
  if ((m = /instagram\.com\/stories\/([a-zA-Z0-9_.-]+)\/(\d+)/i.exec(url))) {
    return { igKind: 'story', username: m[1], storyId: m[2] }
  }
  if ((m = /instagram\.com\/reels?\/([a-zA-Z0-9_-]+)/i.exec(url))) return { igKind: 'reel', shortcode: m[1] }
  if ((m = /instagram\.com\/(?:p|tv)\/([a-zA-Z0-9_-]+)/i.exec(url))) return { igKind: 'post', shortcode: m[1] }
  return { igKind: 'other' }
}

/** Remove zero-width e pontuação que o WhatsApp/markdown cola no fim da URL. */
function trimUrl(u) {
  return u
    .replace(/[​-‏‪-‮]/g, '')
    .replace(/[)\].,;:!?'"»>]+$/, '')
}

// ---- Resolução dos binários (uma vez) -----------------------------------

let ytdlpCached
let gallerydlCached
let instaloaderCached

/** Acha o executável: override do .env -> PATH (where) -> null. */
function resolvePath(name, override) {
  if (override && existsSync(override)) return override
  try {
    const out = execFileSync('where', [name], { encoding: 'utf8', windowsHide: true })
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (first && existsSync(first)) return first
  } catch {
    /* não está no PATH */
  }
  return null
}

/** { file, pre } pro yt-dlp (cai no nome puro do PATH se não resolver). */
function ytdlpCmd() {
  if (ytdlpCached) return ytdlpCached
  const p = resolvePath('yt-dlp', config.ytDlpPath)
  ytdlpCached = p ? { file: p, pre: [] } : { file: 'yt-dlp', pre: [] }
  return ytdlpCached
}

/** { file, pre } pro gallery-dl (cai pra `python -m gallery_dl` se não achar o exe). */
function gallerydlCmd() {
  if (gallerydlCached) return gallerydlCached
  const p = resolvePath('gallery-dl', config.galleryDlPath)
  gallerydlCached = p ? { file: p, pre: [] } : { file: config.pythonBin, pre: ['-m', 'gallery_dl'] }
  return gallerydlCached
}

/** { file, pre } pro instaloader (cai pra `python -m instaloader`). */
function instaloaderCmd() {
  if (instaloaderCached) return instaloaderCached
  const p = resolvePath('instaloader', config.instaloaderPath)
  instaloaderCached = p ? { file: p, pre: [] } : { file: config.pythonBin, pre: ['-m', 'instaloader'] }
  return instaloaderCached
}

let ffmpegCached
/**
 * Acha o ffmpeg (arquivo ou pasta) p/ passar ao yt-dlp via --ffmpeg-location. Sem isso, rodando
 * via PM2 (que nem sempre tem o ffmpeg no PATH), o yt-dlp não faz o merge e baixa em baixa resolução.
 * Ordem: override .env -> PATH -> instalação do winget. Devolve '' se não achar (deixa o yt-dlp tentar o PATH).
 */
export function resolveFfmpeg() {
  if (ffmpegCached !== undefined) return ffmpegCached
  ffmpegCached = (() => {
    const fromPath = resolvePath('ffmpeg', config.ffmpegLocation)
    if (fromPath) return fromPath
    try {
      const base = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
      const pkg = readdirSync(base).find((d) => /yt-dlp\.FFmpeg/i.test(d))
      if (pkg) {
        const inner = readdirSync(join(base, pkg)).find((d) => /^ffmpeg/i.test(d))
        if (inner) {
          const bin = join(base, pkg, inner, 'bin')
          if (existsSync(join(bin, 'ffmpeg.exe'))) return bin
        }
      }
    } catch {
      /* sem winget */
    }
    return ''
  })()
  return ffmpegCached
}

// ---- Autenticação (cookies + sessão do instaloader) ---------------------

/** Flags de cookies p/ yt-dlp e gallery-dl (mesmas flags nos dois). Arquivo tem prioridade. */
function cookieArgs() {
  if (config.downloadCookiesFile && existsSync(config.downloadCookiesFile)) return ['--cookies', config.downloadCookiesFile]
  if (config.downloadCookiesFromBrowser) return ['--cookies-from-browser', config.downloadCookiesFromBrowser]
  return []
}

/** Caminho do arquivo de sessão do instaloader (vazio se IG não configurado). */
export function instaSessionFile() {
  if (config.instaloaderSession) return config.instaloaderSession
  if (!config.instagramUser) return ''
  return join('auth', 'instaloader', `session-${config.instagramUser}`)
}

/** Tem login do Instagram pronto (sessão salva)? */
export function hasInstaSession() {
  const f = instaSessionFile()
  return !!(config.instagramUser && f && existsSync(f))
}

// ---- Execução de processo (sem shell, sem stdin) ------------------------

/** Roda um processo SEM shell. Resolve { code, stdout, stderr, ... } (não rejeita em code≠0). */
function runProc(file, args, { timeoutMs = 8 * 60_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    let proc
    try {
      // stdin 'ignore': ferramentas nunca travam esperando senha num terminal não-interativo.
      proc = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return resolve({ code: -1, stdout, stderr: String(e?.message || e), spawnError: true })
    }
    const settle = (r) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* já morreu */
      }
      settle({ code: -1, stdout, stderr: `${stderr}\n[timeout]`, timedOut: true })
    }, timeoutMs)
    proc.stdout?.on('data', (d) => (stdout += d.toString()))
    proc.stderr?.on('data', (d) => (stderr += d.toString()))
    proc.on('error', (e) => settle({ code: -1, stdout, stderr: `${stderr}\n${e?.message || e}`, spawnError: true }))
    proc.on('close', (code) => settle({ code, stdout, stderr }))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A saída indica rate limit ("aguarde alguns minutos")? */
function isRateLimited(out) {
  return /please wait|wait a few minutes|try again later|rate.?limit|too many requests|\b429\b/i.test(out || '')
}

// ---- Coleta dos arquivos baixados ---------------------------------------

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v'])
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'])

/** Lista os arquivos de mídia baixados no dir -> [{ path, kind, ext, title }] (title = nome sem extensão). */
async function collectFiles(dir) {
  const names = await readdir(dir).catch(() => [])
  const files = []
  for (const n of names.sort()) {
    const ext = extname(n).toLowerCase()
    const kind = VIDEO_EXT.has(ext) ? 'video' : IMAGE_EXT.has(ext) ? 'image' : null
    if (kind) files.push({ path: join(dir, n), kind, ext: ext.slice(1), title: basename(n, extname(n)) })
  }
  return files
}

// ---- Ferramentas individuais --------------------------------------------

async function ytdlp(url, dir) {
  const h = config.downloadMaxHeight
  const hf = h > 0 ? `[height<=${h}]` : '' // teto de altura (vazio = sem limite)
  // 'h264' → prefere H.264 + AAC (abre em qualquer editor: Premiere, CapCut...); cai pro melhor só se não houver.
  // 'best' → melhor vídeo + melhor áudio (pode vir VP9/AV1 4K, que muitos editores não reconhecem).
  const format =
    config.downloadVideoCodec === 'best'
      ? `bv*${hf}+ba/b${hf}/b`
      : `bv*[vcodec^=avc1]${hf}+ba[acodec^=mp4a]/b[vcodec^=avc1]${hf}/bv*${hf}+ba/b${hf}/b`
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--no-part',
    '-f',
    format,
    '--merge-output-format',
    'mp4',
    '--max-filesize',
    `${config.downloadMaxFilesizeMB}M`,
    '--match-filter',
    `duration <=? ${config.downloadMaxDurationSec}`,
    // Nome do arquivo = TÍTULO do vídeo (vai pro preview e pro documento). --windows-filenames
    // sanitiza só os caracteres proibidos, mantendo o título legível (com espaços/acentos).
    '-o',
    join(dir, '%(title).100s.%(ext)s'),
    '--windows-filenames',
    '--trim-filenames',
    '150',
    ...cookieArgs(),
  ]
  // --ffmpeg-location explícito: garante o merge (vídeo+áudio) em alta resolução mesmo se o
  // ffmpeg não estiver no PATH do processo (caso do PM2). Sem isso, cai numa resolução baixa.
  const ff = resolveFfmpeg()
  if (ff) args.push('--ffmpeg-location', ff)
  args.push(url)
  const yt = ytdlpCmd()
  return runProc(yt.file, [...yt.pre, ...args], { timeoutMs: 9 * 60_000 })
}

async function gallerydl(url, dir) {
  const args = ['--quiet', '-D', dir, '--range', `1-${config.downloadMaxItems}`, ...cookieArgs(), url]
  const gd = gallerydlCmd()
  return runProc(gd.file, [...gd.pre, ...args], { timeoutMs: 5 * 60_000 })
}

/** Tem cookies (arquivo ou navegador) configurados? */
function cookiesConfigured() {
  return !!((config.downloadCookiesFile && existsSync(config.downloadCookiesFile)) || config.downloadCookiesFromBrowser)
}

/**
 * Instagram post/reel por shortcode (instaloader). `login:false` = anônimo (post público; NÃO
 * dispara o "check if logged in" que o IG bloqueia); `login:true` = usa a sessão (conteúdo privado).
 */
async function instaloaderPost(shortcode, dir, { login = false } = {}) {
  const il = instaloaderCmd()
  const args = [
    ...il.pre,
    '--dirname-pattern',
    dir,
    '--filename-pattern',
    '{shortcode}',
    '--no-metadata-json',
    '--no-compress-json',
    '--no-captions',
    '--no-iphone', // menos requisições à API do IG -> menos rate limit
    '--quiet',
  ]
  if (login && hasInstaSession()) args.push('--login', config.instagramUser, '--sessionfile', instaSessionFile())
  args.push('--', `-${shortcode}`) // prefixo '-' = baixar POST por shortcode (não perfil)
  return runProc(il.file, args, { timeoutMs: 5 * 60_000 })
}

/** Stories ativas de um usuário (REQUER sessão). Devolve { noSession } se IG não configurado. */
async function instaloaderStories(username, dir) {
  if (!hasInstaSession()) return { code: -1, stdout: '', stderr: 'login required', noSession: true }
  const il = instaloaderCmd()
  const args = [
    ...il.pre,
    '--login',
    config.instagramUser,
    '--sessionfile',
    instaSessionFile(),
    '--dirname-pattern',
    dir,
    '--filename-pattern',
    '{mediaid}',
    '--no-metadata-json',
    '--no-compress-json',
    '--no-captions',
    '--no-iphone',
    '--quiet',
    '--stories-only',
    '--',
    username,
  ]
  return runProc(il.file, args, { timeoutMs: 5 * 60_000 })
}

/**
 * Roda uma ferramenta do Instagram com retry: se vier rate limit, espera e tenta de novo
 * (em vez de jogar a mensagem "aguarde" pro usuário). Re-checa os arquivos a cada tentativa.
 */
async function igWithRetry(dir, runTool) {
  const waits = [0, 20_000, 40_000] // 1ª imediata; depois espera 20s, 40s
  let out = ''
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await sleep(waits[i])
    const r = await runTool()
    out = `${r.stdout || ''}\n${r.stderr || ''}`
    if (r.noSession) return { files: [], out, noSession: true }
    const files = await collectFiles(dir)
    if (files.length) return { files, out }
    if (!isRateLimited(out)) break // erro não é rate limit → re-tentar não ajuda
  }
  return { files: [], out }
}

// ---- API de alto nível --------------------------------------------------

/**
 * Baixa a mídia do link (objeto vindo de detectMediaUrl). Roteia por plataforma e
 * encadeia fallbacks. Lança Error com mensagens-código que o chamador traduz:
 *   'AUTH' (login)  'AUTH_IG_STORY' (story sem IG configurado)  'RATE' (rate limit)
 *   'NO_MEDIA' (sem mídia)  'TOO_LONG:20' / 'TOO_BIG:200'
 * Sempre limpa o temp. Devolve { files: [{path, kind, ext, title}], platform, cleanup }.
 */
export async function downloadMedia(hit) {
  const { url, platform, images = true, igKind } = hit
  const dir = await mkdtemp(join(tmpdir(), 'wa-dl-'))
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {})
  try {
    let files = []
    let out = ''

    if (platform === 'Instagram') {
      const haveCookies = cookiesConfigured()

      // 1) yt-dlp (com cookies) — caminho "de navegador" do IG: baixa reel/post/story em vídeo
      //    autenticado, sem o bloqueio de graphql que derruba o instaloader.
      const r = await ytdlp(url, dir)
      files = await collectFiles(dir)
      out = `${r.stdout}\n${r.stderr}`

      // 2) Fallback instaloader — SÓ quando NÃO há cookies. Com cookies, o yt-dlp + gallery-dl já
      //    cobrem o IG; o instaloader bate na graphql e o IG bloqueia fácil, então não insistimos.
      if (!files.length && !haveCookies && igKind === 'story') {
        const g = await igWithRetry(dir, () => instaloaderStories(hit.username, dir))
        out += `\n${g.out}`
        files = g.files
        if (!files.length && g.noSession) throw new Error('AUTH_IG_STORY')
        if (files.length > 1 && hit.storyId) {
          const exact = files.filter((f) => f.path.includes(hit.storyId))
          if (exact.length) files = exact
        }
      } else if (!files.length && !haveCookies && hit.shortcode) {
        // Post/reel: anônimo primeiro (evita o "login check" bloqueado); logado se houver sessão.
        let g = await igWithRetry(dir, () => instaloaderPost(hit.shortcode, dir, { login: false }))
        out += `\n${g.out}`
        files = g.files
        if (!files.length && hasInstaSession() && !isRateLimited(g.out)) {
          g = await igWithRetry(dir, () => instaloaderPost(hit.shortcode, dir, { login: true }))
          out += `\n${g.out}`
          files = g.files
        }
      }

      // 3) Foto pura (carrossel, perfil) → gallery-dl (com cookies, pega foto autenticada).
      if (!files.length && images && !isRateLimited(out)) {
        const g = await gallerydl(url, dir)
        out += `\n${g.stdout}\n${g.stderr}`
        files = await collectFiles(dir)
      }

      // Story que não veio e não dá pra autenticar (sem cookies nem sessão) → orienta config.
      if (!files.length && igKind === 'story' && !haveCookies && !hasInstaSession()) {
        throw new Error('AUTH_IG_STORY')
      }
    } else {
      // YouTube / TikTok / X → yt-dlp (vídeo).
      const r = await ytdlp(url, dir)
      if (r.spawnError && /enoent/i.test(r.stderr)) {
        throw new Error('yt-dlp não encontrado no servidor. Instale o yt-dlp ou defina YTDLP_PATH no .env.')
      }
      files = await collectFiles(dir)
      out = `${r.stdout}\n${r.stderr}`
      if (!files.length && /does not pass filter/i.test(out)) {
        throw new Error(`TOO_LONG:${Math.round(config.downloadMaxDurationSec / 60)}`)
      }
      if (!files.length && /max-?filesize|larger than|file is larger/i.test(out)) {
        throw new Error(`TOO_BIG:${config.downloadMaxFilesizeMB}`)
      }
      // Foto pura (X) → gallery-dl.
      if (!files.length && images) {
        const g = await gallerydl(url, dir)
        out += `\n${g.stdout}\n${g.stderr}`
        files = await collectFiles(dir)
      }
    }

    if (!files.length) {
      if (isRateLimited(out)) throw new Error('RATE')
      if (/login|log in|sign in|private|cookies|not available|forbidden|\b401\b|\b403\b|age.?restricted|requires? (an )?account|checkpoint|not logged|please log in/i.test(out)) {
        throw new Error('AUTH')
      }
      throw new Error('NO_MEDIA')
    }

    return { files: files.slice(0, config.downloadMaxItems), platform, cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}
