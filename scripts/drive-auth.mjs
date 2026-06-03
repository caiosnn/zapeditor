// Login ÚNICO no Google Drive (OAuth "app para computador", redirect via localhost).
// Pré-requisitos no .env: GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.
// Uso: npm run drive-auth  -> abre o navegador, você autoriza, salvamos o refresh token.
import { google } from 'googleapis'
import http from 'node:http'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import 'dotenv/config'

const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const PORT = 53682
const REDIRECT = `http://localhost:${PORT}`
const TOKEN_PATH = join('auth', 'google.json')

const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()

if (!clientId || !clientSecret) {
  console.error('\n❌ Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env antes de rodar.\n')
  process.exit(1)
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT)
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline', // queremos refresh_token
  prompt: 'consent', // força devolver refresh_token mesmo se já autorizou antes
  scope: SCOPES,
})

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, REDIRECT)
    if (!url.searchParams.get('code')) {
      res.writeHead(400).end('Faltou o code.')
      return
    }
    const { tokens } = await oauth2.getToken(url.searchParams.get('code'))
    if (!tokens.refresh_token) {
      throw new Error('o Google não devolveu refresh_token (tente revogar o acesso e rodar de novo)')
    }
    await mkdir('auth', { recursive: true })
    await writeFile(TOKEN_PATH, JSON.stringify({ refresh_token: tokens.refresh_token }, null, 2))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<h2>✅ Login feito!</h2><p>Pode fechar esta aba e voltar ao terminal.</p>')
    console.log('\n✅ Refresh token salvo em', TOKEN_PATH)
    server.close()
    setTimeout(() => process.exit(0), 200)
  } catch (err) {
    res.writeHead(500).end('Erro: ' + (err?.message || err))
    console.error('\n❌ Falhou:', err?.message || err)
    setTimeout(() => process.exit(1), 200)
  }
})

server.listen(PORT, () => {
  console.log('\n🌐 Abrindo o navegador para você autorizar...')
  console.log('   Se não abrir sozinho, cole esta URL no navegador:\n')
  console.log('  ', authUrl, '\n')
  exec(`start "" "${authUrl}"`) // Windows (cmd)
})
