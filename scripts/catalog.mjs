// Catálogo leve: navega o NAS e cria uma nota por demanda no vault (código, cliente, data, nome,
// tema inferido, caminho no NAS) — SEM baixar vídeo. Dá a busca por tema antes do arquivamento.
// Roteiro/tema preciso do Notion é enriquecido depois/sob demanda. Rodar: node scripts/catalog.mjs <CLIENTE> [...]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { listDemandas } from '../src/synology-dl.js'

const VAULT = 'C:/Users/Caio/Documents/Bot Whatsapp/vault/producoes'
const clientes = process.argv.slice(2)
if (!clientes.length) { console.log('uso: node scripts/catalog.mjs <CLIENTE> [CLIENTE...]'); process.exit(0) }

function inferTema(nome) {
  const n = nome.toLowerCase()
  if (/\bpix\b/.test(n)) return 'pix'
  if (/master|credcesta|vorcaro|mantega/.test(n)) return 'banco-master'
  if (/facç|faccoes|facc|pcc|comando vermelho|\bcv\b|terror|tr[aá]fico/.test(n)) return 'faccoes'
  if (/inss|aposentad|consignad/.test(n)) return 'inss'
  if (/trump|eua|tarifa|sanç|soberania|seç[ãa]o 301|exterior/.test(n)) return 'politica-externa'
  if (/imposto|infla|econom|gasto|bondade|sal[áa]rio|\bpec\b|6x1|trabalho|emprego/.test(n)) return 'economia'
  if (/seguran|crime|viol[êe]ncia|pol[íi]cia|bandid|preso|presídio/.test(n)) return 'seguranca'
  if (/sa[úu]de|\bsus\b|dengue|yanomami|hospital/.test(n)) return 'saude'
  if (/gleisi|eleitoral|pesquisa|candidat|fl[áa]vio|bolsonaro|comp[íi]cio|ato/.test(n)) return 'eleitoral'
  if (/corrup|lava.?jato|petrol[ãa]o|escândalo|desvi/.test(n)) return 'corrupcao'
  return 'outros'
}
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 70)

// códigos que JÁ têm nota no vault (não duplicar)
const existentes = new Set()
for (const c of readdirSync(VAULT)) {
  const dir = join(VAULT, c)
  let fs = []
  try { fs = readdirSync(dir).filter((f) => f.endsWith('.md')) } catch { continue }
  for (const f of fs) {
    const m = /^codigo:\s*"?([A-Za-z0-9]+)/m.exec(readFileSync(join(dir, f), 'utf8'))
    if (m) existentes.add(m[1])
  }
}

let criadas = 0
for (const cliente of clientes) {
  const dems = await listDemandas(cliente)
  const comCodigo = dems.filter((d) => d.codigo)
  console.log(`\n${cliente}: ${dems.length} pastas, ${comCodigo.length} com código`)
  mkdirSync(join(VAULT, cliente), { recursive: true })
  for (const d of comCodigo) {
    if (existentes.has(d.codigo)) continue
    existentes.add(d.codigo)
    const tema = inferTema(d.nome)
    const file = join(VAULT, cliente, `${d.codigo}-${slug(d.nome)}.md`)
    if (existsSync(file)) continue
    const fm = [
      '---', 'tipo: producao', `codigo: ${d.codigo}`, `cliente: ${cliente}`,
      `nome_demanda: "${d.nome.replace(/"/g, "'")}"`, `ano: "${d.ano}"`, `mes: "${d.mes}"`,
      `tema: ${tema}`, 'status_criacao: concluído', 'drive_link:', `nas_path: "${d.path}"`,
      'origem: catalogo-nas', `tags: [producao, ${tema}, ${cliente.toLowerCase()}]`, '---', '',
      `# ${d.nome}`, '', `Catalogado do NAS (${cliente} · ${d.mes}/${d.ano}). Tema inferido: [[${tema}]].`,
      'Roteiro/legenda do Notion e vídeo no Drive — a enriquecer/arquivar.', '',
    ].join('\n')
    writeFileSync(file, fm)
    criadas++
  }
  console.log(`  -> ${criadas} notas no total ate agora`)
}
console.log(`\n=== CATÁLOGO: ${criadas} notas novas criadas ===`)
