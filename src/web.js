// Interface web (local) pra gerenciar o arquivamento por grupo, sem terminal.
// Embutida no processo do bot: usa a conexão atual do WhatsApp via getSock().
import express from 'express'

import { config } from './config.js'
import { isGroupArchived, setGroupArchived } from './settings.js'

export function startWeb({ getSock, getStatus }) {
  if (!config.webPassword) {
    console.warn('⚠️  WEB_PASSWORD vazio no .env — interface web NÃO foi iniciada (defina uma senha).')
    return
  }

  const app = express()
  app.use(express.json())

  // Autenticação simples por senha (HTTP Basic). Em localhost/túnel HTTPS é suficiente.
  app.use((req, res, next) => {
    const [, b64] = (req.headers.authorization || '').split(' ')
    const [, pass] = Buffer.from(b64 || '', 'base64').toString().split(':')
    if (pass === config.webPassword) return next()
    res.set('WWW-Authenticate', 'Basic realm="ZapEditor"').status(401).send('Senha necessária.')
  })

  app.get('/', (req, res) => res.type('html').send(PAGE))

  app.get('/api/state', async (req, res) => {
    const sock = getSock()
    let groups = []
    try {
      if (sock) {
        groups = Object.values(await sock.groupFetchAllParticipating())
          .map((g) => ({ jid: g.id, name: g.subject || '(sem nome)', archived: isGroupArchived(g.id) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      }
    } catch {
      /* sock ainda reconectando: devolve lista vazia */
    }
    res.json({ status: getStatus(), groups })
  })

  app.post('/api/group', async (req, res) => {
    const { jid, archived } = req.body || {}
    if (!jid) return res.status(400).json({ ok: false, error: 'jid faltando' })
    try {
      await setGroupArchived(jid, !!archived)
      console.log(`🌐 Arquivamento ${archived ? 'LIGADO' : 'desligado'} no grupo ${jid}`)
      res.json({ ok: true, archived: isGroupArchived(jid) })
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || 'erro' })
    }
  })

  app.listen(config.webPort, () => {
    console.log(`🌐 Interface web em http://localhost:${config.webPort}`)
  })
}

const PAGE = `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZapEditor — Arquivamento</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px 18px 60px; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  .sub { opacity: .6; font-size: .85rem; margin-bottom: 20px; }
  .status { padding: 12px 16px; border-radius: 10px; margin-bottom: 22px; font-weight: 600; }
  .status.on { background: #16a34a22; color: #16a34a; }
  .status.off { background: #dc262622; color: #dc2626; }
  .group { display: flex; align-items: center; justify-content: space-between; gap: 14px;
           padding: 12px 16px; border: 1px solid #8884; border-radius: 12px; margin-bottom: 10px; }
  .group .name { font-weight: 600; word-break: break-word; }
  .group .jid { font-size: .72rem; opacity: .5; word-break: break-all; }
  .empty { opacity: .6; }
  .switch { position: relative; display: inline-block; width: 52px; height: 30px; flex: none; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider { position: absolute; cursor: pointer; inset: 0; background: #8886; border-radius: 30px; transition: .2s; }
  .slider:before { content: ""; position: absolute; height: 24px; width: 24px; left: 3px; bottom: 3px;
                   background: #fff; border-radius: 50%; transition: .2s; }
  input:checked + .slider { background: #16a34a; }
  input:checked + .slider:before { transform: translateX(22px); }
  input:disabled + .slider { opacity: .5; }
</style>
</head>
<body>
<h1>📁 Arquivamento por grupo</h1>
<div class="sub">Ligue o arquivamento nos grupos que quiser. Aplica na hora, sem reiniciar.</div>
<div id="status" class="status">carregando…</div>
<div id="groups"></div>
<script>
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  async function load() {
    let d
    try { d = await (await fetch('/api/state')).json() } catch { return }
    const s = document.getElementById('status')
    if (d.status && d.status.connected) {
      s.className = 'status on'
      s.textContent = '🟢 Bot conectado' + (d.status.me ? ' — ' + d.status.me : '')
    } else {
      s.className = 'status off'
      s.textContent = '🔴 Bot desconectado (reconectando…)'
    }
    const c = document.getElementById('groups')
    if (!d.groups || !d.groups.length) { c.innerHTML = '<p class="empty">Nenhum grupo encontrado ainda.</p>'; return }
    c.innerHTML = ''
    for (const g of d.groups) {
      const row = document.createElement('div'); row.className = 'group'
      row.innerHTML = '<div><div class="name">' + esc(g.name) + '</div><div class="jid">' + esc(g.jid) + '</div></div>'
      const lbl = document.createElement('label'); lbl.className = 'switch'
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = g.archived
      cb.onchange = async () => {
        cb.disabled = true
        try {
          await fetch('/api/group', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jid: g.jid, archived: cb.checked }) })
        } catch { cb.checked = !cb.checked }
        cb.disabled = false
      }
      const sl = document.createElement('span'); sl.className = 'slider'
      lbl.append(cb, sl); row.append(lbl); c.append(row)
    }
  }
  load(); setInterval(load, 10000)
</script>
</body>
</html>`
