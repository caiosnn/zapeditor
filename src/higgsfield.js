// Wrapper do CLI `@higgsfield/cli` (geração de imagem/vídeo por IA).
//
// Rodamos o CLI via `node <entry.js> ...` em vez do shim `higgsfield.cmd`.
// Motivo: o prompt do usuário é texto livre (aspas, ";", quebras). Com shell:true
// o shell re-interpreta os argumentos (risco de injeção/quebra). Chamando o .js
// direto com process.execPath, os args vão LITERAIS, sem shell — seguro.
// (Também evita a pegadinha do EINVAL ao spawnar .cmd no Node 24.)

import { execFile, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'

const execFileAsync = promisify(execFile)

// ---- Resolução do entry-point do CLI (uma vez) --------------------------

let cachedEntry
function resolveEntry() {
  if (cachedEntry !== undefined) return cachedEntry
  cachedEntry = (() => {
    // 1) Override explícito no .env
    if (config.higgsfieldEntry && existsSync(config.higgsfieldEntry)) return config.higgsfieldEntry
    // 2) Caminho padrão do npm global no Windows (sem subprocesso)
    if (process.env.APPDATA) {
      const p = join(process.env.APPDATA, 'npm', 'node_modules', '@higgsfield', 'cli', 'bin', 'higgsfield.js')
      if (existsSync(p)) return p
    }
    // 3) Diretório global do npm (outros SOs / prefixos custom)
    try {
      const root = execSync('npm root -g', { encoding: 'utf8' }).trim()
      const p = join(root, '@higgsfield', 'cli', 'bin', 'higgsfield.js')
      if (existsSync(p)) return p
    } catch {
      /* segue para o fallback */
    }
    return null // último recurso: confiar no PATH (via shell)
  })()
  return cachedEntry
}

// ---- Execução base ------------------------------------------------------

/** Roda o CLI com `--json` e devolve o JSON parseado. Lança com a msg de erro do CLI. */
async function runHf(args, { timeoutMs = 120_000 } = {}) {
  const entry = resolveEntry()
  const file = entry ? process.execPath : 'higgsfield'
  const fullArgs = entry ? [entry, ...args, '--json'] : [...args, '--json']
  const opts = { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }
  if (!entry) opts.shell = true // sem entry resolvido, cai no shim (PATH)

  let stdout
  try {
    ;({ stdout } = await execFileAsync(file, fullArgs, opts))
  } catch (err) {
    const msg = (err?.stderr || err?.stdout || err?.message || '').toString().trim()
    if (/not authenticated/i.test(msg)) {
      throw new Error('Higgsfield não autenticado. Rode `higgsfield auth login` no servidor do bot.')
    }
    throw new Error(msg || `higgsfield falhou (código ${err?.code ?? '?'})`)
  }
  return parseJson(stdout)
}

/** O CLI com --json imprime só o JSON; ainda assim toleramos lixo ao redor. */
function parseJson(stdout) {
  const s = (stdout || '').trim()
  try {
    return JSON.parse(s)
  } catch {
    const i = s.search(/[[{]/)
    const j = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'))
    if (i !== -1 && j > i) {
      try {
        return JSON.parse(s.slice(i, j + 1))
      } catch {
        /* cai no erro abaixo */
      }
    }
    throw new Error(`Saída inesperada do higgsfield: ${s.slice(0, 300)}`)
  }
}

/** {aspect_ratio, resolution, ...} -> ['--aspect_ratio','1:1','--resolution','2k'] */
function paramsToArgs(params = {}) {
  const out = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    out.push(`--${k}`, String(v))
  }
  return out
}

/** Normaliza o array de jobs do `generate create --wait` num formato simples. */
function normalizeResult(out) {
  const arr = Array.isArray(out) ? out : [out]
  const jobs = arr.map((j) => ({
    id: j?.id ?? null,
    status: j?.status ?? null,
    url: j?.result_url ?? null,
    model: j?.job_set_type ?? null,
  }))
  const urls = jobs.map((j) => j.url).filter(Boolean)
  return { jobs, urls, ok: urls.length > 0 }
}

// ---- API de alto nível --------------------------------------------------

/** Gera imagem. Devolve { jobs, urls, ok }. imagePath (opcional) = referência (img2img). */
export async function generateImage({ model, prompt, aspectRatio, resolution, imagePath, waitTimeout = '6m' } = {}) {
  const args = ['generate', 'create', model, '--prompt', prompt, ...paramsToArgs({ aspect_ratio: aspectRatio, resolution })]
  if (imagePath) args.push('--image', imagePath)
  args.push('--wait', '--wait-timeout', waitTimeout)
  return normalizeResult(await runHf(args, { timeoutMs: 7 * 60_000 }))
}

/** Gera vídeo. imagePath (opcional) = primeiro frame (image-to-video). */
export async function generateVideo({ model, prompt, aspectRatio, duration, quality, imagePath, waitTimeout = '20m' } = {}) {
  const args = [
    'generate',
    'create',
    model,
    '--prompt',
    prompt,
    ...paramsToArgs({ aspect_ratio: aspectRatio, duration, quality }),
  ]
  if (imagePath) args.push('--image', imagePath)
  args.push('--wait', '--wait-timeout', waitTimeout)
  return normalizeResult(await runHf(args, { timeoutMs: 22 * 60_000 }))
}

/** Estima o custo em créditos (não cria job). */
export async function estimateCost({ model, prompt, params = {} } = {}) {
  const out = await runHf(['generate', 'cost', model, '--prompt', prompt, ...paramsToArgs(params)], { timeoutMs: 60_000 })
  return Number(out?.credits ?? out?.credits_exact ?? 0)
}

/** Saldo/plano da conta. */
export async function accountStatus() {
  const out = await runHf(['account', 'status'], { timeoutMs: 60_000 })
  return { email: out?.email ?? '', credits: Number(out?.credits ?? 0), plan: out?.subscription_plan_type ?? '' }
}

/** Lista de modelos: kind = 'image' | 'video' | undefined (todos). */
export async function listModels(kind) {
  const flag = kind === 'image' ? ['--image'] : kind === 'video' ? ['--video'] : []
  const out = await runHf(['model', 'list', ...flag], { timeoutMs: 60_000 })
  return Array.isArray(out) ? out : []
}

/** Baixa a URL de resultado e devolve o Buffer (pra enviar no WhatsApp). */
export async function downloadBuffer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download do resultado falhou (HTTP ${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}
