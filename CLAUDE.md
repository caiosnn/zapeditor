# CLAUDE.md — Bot de WhatsApp (transcrição / legenda Cover / cortes)

Bot Baileys que **transcreve**, **legenda vídeos no estilo "Cover" do Captions** e **corta** trechos.
Arquitetura e features completas: ver **[README.md](README.md)**. Este arquivo é o guia operacional.

> O usuário é brasileiro — **responda em português**.

## Ambiente
- Windows + PowerShell. ffmpeg/ffprobe e Python 3 (faster-whisper) no PATH.
- APIs externas: usar sempre **OpenRouter** (chave no `.env`, `OPENROUTER_API_KEY`).

## Rodar / reiniciar o bot (gerenciado por PM2)
O bot roda **24/7 via PM2** (nome `zapeditor`), independente desta sessão, com auto-restart em crash e auto-boot no logon do Windows.
```powershell
pm2 restart zapeditor              # aplicar mudanças em src/*.js
pm2 logs zapeditor --lines 40 --nostream   # ver logs (use --nostream p/ não travar)
pm2 status                         # estado
pm2 stop zapeditor / pm2 start zapeditor
```
⚠️ **NÃO** use `npm start` nem mate o node manualmente enquanto o PM2 estiver rodando — daria DUAS instâncias e o WhatsApp dá conflito (`conflict: replaced` em loop). Sempre via PM2. Reconecta sem QR (sessão em `auth/`).

Mudanças em `caption-studio/` (Remotion) **não** precisam reiniciar — pegam no próximo render.

## Testes
`npm test` (runner nativo `node:test`, sem dependência). Cobre a lógica pura: `caption-edit` (correções), `cut` (parse de trecho), `messages` (mídia/menção/documento), `alignWords` (LCS do corretor) e `archive` (classificação de anexo, nome de pasta/arquivo, parse do comando "drive"). Arquivos em `test/*.test.mjs` — rode após mexer nessas funções.

## Arquivamento automático no Google Drive
Sobe **todo anexo** (vídeo/imagem/áudio/doc) dos grupos configurados pro Google Drive da conta `redespartidoliberal@gmail.com` (projeto Cloud `pl-comunicacao-software`), organizado em **`Agendas FB / FB MM-DD-AAAA / <Tipo>`** (Tipo = Vídeos/Imagens/Áudios/Documentos). Só reage **✅** no arquivo — não manda mensagem, pra não poluir o grupo. Upload por **streaming** (aguenta vídeo grande). Anti-duplicado em `data/archive-index.json` (o WhatsApp reentrega mensagens ao reconectar).

**Sob demanda:** marque o bot com *"drive de hoje"* (também entende *"ontem"* e *"DD/MM[/AAAA]"*) → responde o link da pasta do dia. A pasta raiz é compartilhada como *"qualquer um com o link vê"* (herdado pelas subpastas), então o link abre pra equipe.

Config no `.env`: `ARCHIVE_ENABLED`, `ARCHIVE_GROUPS` (JIDs separados por vírgula), `ARCHIVE_ROOT_FOLDER`, `ARCHIVE_DISCOVER`, `GOOGLE_CLIENT_ID/SECRET`.
- **Login (uma vez):** `npm run drive-auth` → abre o navegador, você autoriza, salva o refresh token em `auth/google.json`. Scope `drive.file` (o bot só vê o que ele cria).
- **Descobrir o JID de um grupo:** `ARCHIVE_DISCOVER=true` + restart → lista os grupos no log do boot (`pm2 logs`). Copie o JID pra `ARCHIVE_GROUPS` e volte `ARCHIVE_DISCOVER=false`.
- Código: `src/drive.js` (Drive API: auth, pastas, upload, compartilhar), `src/archive.js` (classificação/nomes — puro, testado), `src/archive-store.js` (dedupe). Gancho em `handleMessage` (`src/index.js`), roda sem `return` pra não atrapalhar transcrição/legenda.

**Pegadinhas (já resolvidas):**
- OAuth tipo **"app para computador"** aceita redirect `http://localhost:PORT` sem cadastrar; tipo "web" exige cadastrar a URI (senão `redirect_uri_mismatch`).
- **Publique o app** (saia do modo "Teste" na tela de consentimento), senão o refresh token expira em 7 dias. Com `drive.file` (não sensível), publicar não exige verificação do Google.
- `pm2 restart` relê o `.env` porque o bot usa `dotenv` (lê o arquivo no boot) — o aviso "--update-env" do PM2 não se aplica aqui.

## Git
Repositório: `https://github.com/caiosnn/zapeditor.git` (branch `main`). `gh` autenticado como `caiosnn`. Commit normalmente quando o usuário pedir.

## Testar a legenda sem o WhatsApp
`_poc_remotion.mjs` roda o pipeline no vídeo de referência e gera `poc_remotion.mp4`. Depois:
```powershell
Set-Location caption-studio; npx remotion render CaptionedVideo "<caminho absoluto>.mp4"; Set-Location ..
```
Inspecione extraindo frames com ffmpeg e lendo o .jpg (a legenda é visual).
Vídeo de referência: `C:\Users\Caio\Downloads\ssstik.io_@paidorealtime_*.mp4`.

## Pegadinhas (já resolvidas — não repita o erro)
- **npx no Node 24**: spawnar `npx.cmd` exige `shell:true` (senão `EINVAL`). Ver `caption.js`.
- **Resolução do vídeo**: `getVideoMetadata` do Remotion retorna **altura errada** → o bot mede com ffprobe e passa via `public/dims.json` (lido no `calculateMetadata`). Não confie no getVideoMetadata p/ dimensão.
- **Corretor**: NÃO peça índices de volta ao Gemini (deriva e troca palavra certa por errada → "fora de tempo"). O certo: Gemini transcreve limpo + `alignWords` (LCS) aos tempos do Whisper. Ver `transcribe.js`.
- **Estado em memória** (`pendingCaptions`, `senderLatestCut`) some ao reiniciar; o **corte persiste em disco** (`cut-store.js`, `data/cuts/`, indexado pelo ID da transcrição).
- **Python stdout**: `whisper_words.py` faz `sys.stdout.reconfigure(encoding="utf-8")` (Windows quebra acentos).
- Vídeos longos (>9min): transcrição usa **Whisper local** (Gemini bagunça timestamp ao juntar pedaços).

## Estilo Cover (o que o usuário valida com rigor)
Fonte **Instrument** (Sans normal + **Serif Itálico** na palavra de destaque), contorno cinza + sombra preta, máx **2 linhas**, palavra-a-palavra, embaixo-centro. `caption-studio/src/CaptionedVideo/Page.tsx`.
Ao mexer no visual: renderize e **confira os frames** antes de dizer que está pronto.
