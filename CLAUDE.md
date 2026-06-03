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
`npm test` (runner nativo `node:test`, sem dependência). Cobre a lógica pura: `caption-edit` (correções), `cut` (parse de trecho), `messages` (mídia/menção/documento), `alignWords` (LCS do corretor), `archive` (classificação de anexo, nome de pasta/arquivo, parse do comando "drive") e `archive-nlu` (parse da intenção do comando admin). Arquivos em `test/*.test.mjs` — rode após mexer nessas funções.

## Arquivamento automático no Google Drive
Sobe **todo anexo** (vídeo/imagem/áudio/doc) dos grupos configurados pro Google Drive da conta `redespartidoliberal@gmail.com` (projeto Cloud `pl-comunicacao-software`), organizado em **`Agendas FB / FB MM-DD-AAAA / <Tipo>`** (Tipo = Vídeos/Imagens/Áudios/Documentos). Só reage **✅** no arquivo — não manda mensagem, pra não poluir o grupo. Upload por **streaming** (aguenta vídeo grande). Anti-duplicado em `data/archive-index.json` (o WhatsApp reentrega mensagens ao reconectar).

**Sob demanda:** marque o bot com *"drive de hoje"* (também entende *"ontem"* e *"DD/MM[/AAAA]"*) → responde o link da pasta do dia. A pasta raiz é compartilhada como *"qualquer um com o link vê"* (herdado pelas subpastas), então o link abre pra equipe.

**Gerenciar quais grupos arquivam (2 jeitos, sincronizados via `data/settings.json`):**
- **Interface web:** `http://localhost:3333` (senha em `WEB_PASSWORD`). Lista os grupos com um interruptor cada; aplica na hora. Servida pelo próprio bot (`src/web.js`, Express, login HTTP Basic).
- **Pelo WhatsApp (admin):** quem está em `ADMIN_NUMBERS` manda no **privado** do bot (ou marcando **@bot** num grupo) em **linguagem natural** — "quais grupos você está?", "quais estão sendo arquivados?", "arquive o grupo X", "para de salvar o Y". A intenção é interpretada por IA (`src/archive-nlu.js`, via OpenRouter); também aceita responder pelo número da lista.
- Fonte da verdade do estado: `src/settings.js` (lê/grava `data/settings.json` em runtime, sem reiniciar; default inicial vem do `.env`).

Config no `.env`: `ARCHIVE_ENABLED`, `ARCHIVE_GROUPS`, `ARCHIVE_ROOT_FOLDER`, `ARCHIVE_DISCOVER`, `GOOGLE_CLIENT_ID/SECRET`, `WEB_ENABLED`/`WEB_PORT`/`WEB_PASSWORD`, `ADMIN_NUMBERS`.
- **Login no Drive (uma vez):** `npm run drive-auth` → abre o navegador, você autoriza, salva o refresh token em `auth/google.json`. Scope `drive.file` (o bot só vê o que ele cria).
- **Descobrir JID de grupo / identificador de admin:** `ARCHIVE_DISCOVER=true` + restart → loga os grupos no boot e o identificador de quem manda no privado (`📨 PRIVADO ... -> ADMIN_NUMBERS=`). Copie pro `.env` e volte pra `false`.
- Código: `src/drive.js` (Drive API), `src/archive.js` (classificação/nomes — puro), `src/archive-store.js` (dedupe), `src/settings.js` (estado runtime), `src/web.js` (interface), `src/archive-nlu.js` (intenção do admin por IA). Gancho em `handleMessage` roda sem `return`.

**Pegadinhas (já resolvidas):**
- **LID:** no WhatsApp atual, tanto em grupo quanto no privado, a pessoa é identificada por um **LID** (ex `2501...`), NÃO pelo número (`5561...`). Por isso `ADMIN_NUMBERS` guarda o **LID** capturado na descoberta, não o telefone. `isAdmin` compara o `normalizeId` do remetente.
- OAuth tipo **"app para computador"** aceita redirect `http://localhost:PORT` sem cadastrar; tipo "web" exige cadastrar a URI (senão `redirect_uri_mismatch`).
- **Publique o app** (saia do modo "Teste" na tela de consentimento), senão o refresh token expira em 7 dias. Com `drive.file` (não sensível), publicar não exige verificação do Google.
- `pm2 restart` relê o `.env` porque o bot usa `dotenv` (lê o arquivo no boot) — o aviso "--update-env" do PM2 não se aplica aqui.

## Envio de mídia: preview + documento
Toda mídia que o bot produz (legenda, corte, geração de imagem/vídeo) é enviada **2x**: **preview** inline (o WhatsApp comprime) e **documento** (mesmo arquivo, qualidade original sem recompressão). Função `sendMediaDual` em `src/index.js` (detecta PNG/JPG/WebP pra nomear o documento). Liga/desliga com `SEND_ORIGINAL_DOC` no `.env`.

## Media downloader (yt-dlp + instaloader + gallery-dl)
Marque o bot (ou mande no **privado**) num link de **YouTube, X (Twitter), Instagram ou TikTok** → ele baixa o vídeo/foto e reenvia no chat (via `sendMediaDual`). O link pode estar na própria mensagem **ou na citada** (responder a um link + @bot).
- **Stack 100% gratuita** (sem API paga), chamada **sem shell** (args literais — a URL do usuário vai literal, sem injeção):
  - `yt-dlp` — vídeo das 4 plataformas + Instagram autenticado (precisa de `ffmpeg` no PATH pro merge)
  - `gallery-dl` — foto pura de IG/X (`pip install gallery-dl`)
  - `instaloader` — fallback do IG público quando NÃO há cookies (`pip install instaloader`)
- **Roteamento por plataforma** (em `downloadMedia`): YouTube/TikTok → yt-dlp; X → yt-dlp+cookies → gallery-dl; **IG → yt-dlp+cookies primeiro** (reel/post/story/foto autenticados) → gallery-dl (foto). O instaloader **só entra se NÃO houver cookies** (`cookiesConfigured()`).
- **IG: por que yt-dlp+cookies e NÃO instaloader.** O instaloader bate na **API graphql interna do IG**, que o Instagram **bloqueia rápido** (401 "please wait" logado / 403 anônimo) — flagou a conta `monitorapl` nos testes. O **yt-dlp usa o caminho de navegador** e **não é bloqueado**; com cookies de uma conta logada baixa reel/post/story/foto (validado 2026-06-03: story de vídeo do @instagram baixada). Por isso, com cookies, o código **pula o instaloader**.
- **Cookies do IG (a config que faz o IG funcionar):** `cookies.txt` exportado de um navegador logado no IG (extensão "Cookie-Editor"/"Get cookies.txt") salvo em **`auth/ig-cookies.txt`**, apontado por `DOWNLOAD_COOKIES_FILE` no `.env`. Cobre IG **e** X. `cookies-from-browser` NÃO serve aqui: o Edge fica aberto e o Windows trava o DB de cookies. Os cookies do IG duram semanas/meses enquanto a conta seguir logada no navegador; quando expira, reexportar.
  - Helper de conversão: se o usuário mandar o export base64 da extensão Cookie-Editor, decodificar (`Buffer.from(b64,'base64')`), são objetos JSON separados por `;` → converter pro formato Netscape (`domain TAB flag TAB path TAB secure TAB exp TAB name TAB value`) e salvar em `auth/ig-cookies.txt`.
- **`npm run ig-login` (instaloader) existe mas é frágil** (o IG bloqueia) — não é o caminho recomendado; preferir cookies.txt.
- **Anti-rate-limit:** chamadas do instaloader passam por `igWithRetry` (re-tenta após 20s/40s) e usam `--no-iphone`. Mas com cookies o instaloader nem roda.
- **Nome do arquivo = título do vídeo:** o yt-dlp salva como `%(title)` (com `--windows-filenames`), e esse título vai pra **legenda do preview E pro nome do documento** (`f.title` em `collectFiles` → `handleDownload`).
- **Codec / qualidade (compatível com editores):** `DOWNLOAD_VIDEO_CODEC` = `h264` (default) prefere **H.264 + AAC** (`bv*[vcodec^=avc1]+ba[acodec^=mp4a]/...`) — abre em qualquer editor (Premiere/CapCut). No YouTube isso dá até **1080p** (o 4K só existe em **VP9/AV1**, que o Premiere NÃO lê — foi a queixa "codec diferente"). `best` → `bv*+ba/b` (máxima resolução, pode vir AV1 4K incompatível). `DOWNLOAD_MAX_HEIGHT=0` = sem teto de altura; teto de tamanho `DOWNLOAD_MAX_FILESIZE_MB=500`.
- **⚠️ ffmpeg via PM2 (pegadinha resolvida):** o yt-dlp PRECISA do ffmpeg pra juntar vídeo+áudio; **sem ele cai numa resolução baixa (~360p)**. O PM2 nem sempre tem o ffmpeg no PATH (foi a causa de "baixíssima resolução" reportada). Solução: `resolveFfmpeg()` acha o ffmpeg (PATH → instalação do **winget** via glob) e o bot passa **`--ffmpeg-location`** explícito pro yt-dlp. Override: `FFMPEG_LOCATION` no `.env`.
- **O que funciona SEM configurar nada:** YouTube e TikTok. **Instagram e X exigem o `cookies.txt`** (IG/X hoje pedem login pra quase tudo).
- **Perfil padrão:** até 1080p, ~200MB, ~20min, máx 10 itens/link (`.env`: `DOWNLOAD_MAX_*`).
- **Código:** `src/downloader.js` — `detectMediaUrl(text)` + `parseInstagram(url)` (puros, testados em `test/downloader.test.mjs`) + `downloadMedia(hit)` (recebe o objeto do detector). Gancho em `handleMessage` (item **3.6**, **antes** do especialista de IA, senão um link viraria pedido de geração) → `handleDownload` no `src/index.js`. Liga/desliga com `DOWNLOADER_ENABLED`.
- **`runProc` usa `stdio:['ignore','pipe','pipe']`** → nenhuma ferramenta trava esperando senha num terminal não-interativo (importante rodando via PM2).
- **Erros tratados** (mensagem amigável, sem stacktrace): `TOO_LONG` / `TOO_BIG` / `AUTH` / `AUTH_IG_STORY` (story sem login configurado) / `RATE` (rate limit, após esgotar o retry) / `NO_MEDIA`.

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
