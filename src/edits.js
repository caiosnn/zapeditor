// Lógica pura da biblioteca de edições: normaliza a categoria (pasta), sanitiza o nome
// do arquivo e casa buscas. Sem I/O -> fácil de testar (test/edits.test.mjs).

/** Remove acentos pra comparação tolerante. */
function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Sinônimos -> categoria canônica (chave já SEM acento e minúscula).
const CATEGORY_ALIASES = {
  compilado: 'Compilados',
  compilados: 'Compilados',
  compilacao: 'Compilados',
  compilation: 'Compilados',
  corte: 'Cortes',
  cortes: 'Cortes',
  clipe: 'Cortes',
  clipes: 'Cortes',
  clip: 'Cortes',
  cut: 'Cortes',
  bruto: 'Brutos',
  brutos: 'Brutos',
  raw: 'Brutos',
}

/** Capitaliza cada palavra (preserva acentos do original). */
function titleCase(s) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Remove caracteres proibidos em nome (Drive/Windows), colapsa espaços, limita tamanho. */
export function sanitizeName(s, max = 80) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * Normaliza a categoria pedida -> nome canônico da pasta. Mapeia sinônimos
 * (compilado->Compilados, corte->Cortes, bruto->Brutos) e, pra categorias livres,
 * capitaliza ("bastidores" -> "Bastidores"). Devolve '' se vazio.
 */
export function normalizeCategory(raw) {
  const clean = sanitizeName(raw, 40)
  if (!clean) return ''
  const key = stripAccents(clean).toLowerCase()
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key]
  return titleCase(clean)
}

/** Filtra os nomes de arquivo que casam o termo (tolerante a acento/maiúscula). */
export function matchFiles(names, term) {
  const t = stripAccents(sanitizeName(term)).toLowerCase()
  if (!t) return [...names]
  return names.filter((n) => stripAccents(n).toLowerCase().includes(t))
}
