// Lote de arquivamento: para cada nota do vault SEM drive_link, baixa o vídeo final do NAS
// (via nas_path → pasta /final, rápido) e sobe pro Drive (Criações/<cliente>), gravando o
// drive_link na nota. Cards/carrosséis (sem .mp4) são pulados. Checkpoint a cada item (a nota
// guarda o progresso). Para sozinho se a sessão do NAS expirar. Rodar: node scripts/archive-creations.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { archiveCreation } from '../src/creations.js'

const VAULT = 'C:/Users/Caio/Documents/Bot Whatsapp/vault/producoes'
const CLIENTS = readdirSync(VAULT).filter((c) => { try { return statSync(join(VAULT, c)).isDirectory() } catch { return false } })

const notes = []
for (const c of CLIENTS) {
  for (const f of readdirSync(join(VAULT, c)).filter((x) => x.endsWith('.md'))) {
    const path = join(VAULT, c, f)
    const txt = readFileSync(path, 'utf8')
    if (/drive_link:\s*"?https?:\/\//.test(txt)) continue // já arquivado
    const nasPath = /nas_path:\s*"([^"]+)"/.exec(txt)?.[1]
    const codigo = /^codigo:\s*"?([A-Za-z0-9]+)/m.exec(txt)?.[1]
    if (!nasPath && !codigo) continue
    notes.push({ path, cliente: c, nasPath, codigo, name: f })
  }
}

const PRIO = { PLN: 0, PLJ: 1, SECOM: 2, 'PL60+': 3, RM: 4, FB: 5 } // vídeos políticos primeiro
notes.sort((a, b) => (PRIO[a.cliente] ?? 7) - (PRIO[b.cliente] ?? 7))
console.log(`=== ${notes.length} notas sem drive_link a processar ===`)
let ok = 0, novideo = 0, erros = 0
for (const n of notes) {
  try {
    const r = await archiveCreation({ nasPath: n.nasPath, codigo: n.codigo, cliente: n.cliente })
    let txt = readFileSync(n.path, 'utf8')
    if (/^drive_link:.*$/m.test(txt)) txt = txt.replace(/^drive_link:.*$/m, `drive_link: "${r.driveLink}"`)
    else if (/^nas_path:.*$/m.test(txt)) txt = txt.replace(/^(nas_path:.*)$/m, `drive_link: "${r.driveLink}"\n$1`)
    else txt = txt.replace(/^(tema:.*)$/m, `$1\ndrive_link: "${r.driveLink}"`)
    writeFileSync(n.path, txt)
    ok++
    console.log(`✓ [${ok}] ${r.filename}${r.count > 1 ? ` +${r.count - 1} imgs` : ''} (${Math.round(Number(r.size) / 1e6)}MB) → ${n.cliente}`)
  } catch (e) {
    if (e.message?.includes('NO_MEDIA') || e.message?.includes('NO_VIDEO')) { novideo++; continue } // pasta sem mídia final
    erros++
    console.log(`✗ ${n.name}: ${e.message}`)
    if (e.message === 'SYNO_2FA_REQUIRED' || e.message?.startsWith('SYNO_AUTH')) {
      console.log('>> SESSÃO DO NAS EXPIROU — parando. (criar conta de serviço sem 2FA p/ rodar tudo)')
      break
    }
  }
}
console.log(`\n=== FIM: ${ok} vídeos arquivados | ${novideo} sem vídeo (cards) | ${erros} erros ===`)
