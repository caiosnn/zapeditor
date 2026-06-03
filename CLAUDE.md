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
