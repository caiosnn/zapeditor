// Login ÚNICO no Instagram via instaloader. Salva uma sessão persistente (dura meses;
// o bot reusa e renova sozinho), então não precisa repetir nem guardar a senha em lugar nenhum.
//
// Uso:
//   npm run ig-login                 (usa INSTAGRAM_USER do .env)
//   npm run ig-login -- seu_usuario  (informa o usuário direto)
import { spawn, execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import 'dotenv/config'

const user = (process.argv[2] || process.env.INSTAGRAM_USER || '').trim()
if (!user) {
  console.error('\n❌ Informe o usuário do Instagram: defina INSTAGRAM_USER no .env, ou rode `npm run ig-login -- seu_usuario`.\n')
  process.exit(1)
}

const sessionDir = join('auth', 'instaloader')
const sessionFile = process.env.INSTALOADER_SESSION?.trim() || join(sessionDir, `session-${user}`)
await mkdir(sessionDir, { recursive: true })

/** Acha o instaloader: override do .env -> PATH -> `python -m instaloader`. */
function resolveInstaloader() {
  const override = process.env.INSTALOADER_PATH?.trim()
  if (override && existsSync(override)) return { file: override, pre: [] }
  try {
    const out = execFileSync('where', ['instaloader'], { encoding: 'utf8', windowsHide: true })
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (first && existsSync(first)) return { file: first, pre: [] }
  } catch {
    /* não está no PATH */
  }
  return { file: process.env.PYTHON_BIN?.trim() || 'python', pre: ['-m', 'instaloader'] }
}

const il = resolveInstaloader()
console.log(`\n🔐 Login no Instagram como "${user}".`)
console.log('   Digite a senha quando pedir (e o código 2FA, se a conta tiver).')
console.log(`   A sessão fica em ${sessionFile} — dura meses, o bot renova sozinho.\n`)

// stdio 'inherit': o instaloader pede a senha/2FA direto no seu terminal.
const child = spawn(il.file, [...il.pre, '--login', user, '--sessionfile', sessionFile], {
  stdio: 'inherit',
  windowsHide: true,
})

child.on('error', (e) => {
  console.error(`\n❌ Não consegui rodar o instaloader: ${e?.message || e}`)
  console.error('   Instale com: pip install instaloader\n')
  process.exit(1)
})

child.on('close', (code) => {
  if (existsSync(sessionFile)) {
    console.log(`\n✅ Sessão salva em ${sessionFile}.`)
    console.log(`   Agora confirme no .env:  INSTAGRAM_USER=${user}`)
    console.log('   e reinicie o bot:        pm2 restart zapeditor')
    console.log('\n   Pronto! Marque o bot num link do Instagram (reel/post/story).\n')
    process.exit(0)
  }
  console.error(`\n❌ A sessão não foi salva (código ${code}). Confira usuário/senha/2FA e tente de novo.\n`)
  process.exit(1)
})
