# 🤖 Bot de WhatsApp — Transcrição, Legenda (estilo Cover) e Cortes

Bot assistente para grupos de WhatsApp com 3 funções, todas acionadas **marcando o bot (@)** em grupos (ou direto no privado):

1. **Transcrever** áudio/vídeo → texto (SRT com timestamps)
2. **Legendar vídeo** no estilo **"Cover" do Captions** (legenda animada queimada no vídeo)
3. **Cortar** um trecho de um vídeo transcrito

> Conecta via Baileys (QR code, como "aparelho vinculado"). Use um número secundário pro bot.

---

## 🗣️ Como usar (comandos no WhatsApp)

| Ação | Como |
|---|---|
| **Transcrever** | Responda a um áudio/vídeo + marque o bot → recebe o texto (SRT). Vídeos longos (>9min) usam Whisper local. |
| **Legendar** | Responda a um **vídeo** + marque o bot + escreva **"legenda"** → recebe o vídeo legendado + a transcrição. |
| **Corrigir legenda** | Responda com **CORREÇÃO** + a parte certa (`CORREÇÃO se → você`, ou o texto completo) → re-renderiza. |
| **Cortar** | Depois de transcrever um vídeo, **responda a transcrição** com **CORTE** + início/fim (cole os blocos, números de bloco, ou tempos) → recebe o trecho. Depois pode legendar. |
| **Baixar mídia** | Marque o bot num **link de YouTube, X, Instagram ou TikTok** (ou responda a um link + @bot) → recebe o vídeo/foto baixado. |

No **privado** os gatilhos por palavra-chave (CORREÇÃO, CORTE) e os links funcionam sem precisar marcar.

---

## ⚙️ Pré-requisitos

- **Node.js 18+** (testado no v24)
- **ffmpeg** + **ffprobe** no PATH
- **Python 3** + **faster-whisper** (`pip install faster-whisper`) — para timestamps por palavra (legenda) e vídeos longos (transcrição)
- **yt-dlp** no PATH — para o media downloader (vídeo de YouTube/X/Instagram/TikTok). Instagram (reel/post/foto/story): **instaloader** (`pip install instaloader`). Foto pura de IG/X: **gallery-dl** (`pip install gallery-dl`)
- **Remotion** (instalado em `caption-studio/`) + Chromium headless (baixado no 1º uso)
- Chave do **OpenRouter** (em `.env`)

## ▶️ Como rodar

```powershell
npm install
npm install --prefix caption-studio   # projeto Remotion
# preencha OPENROUTER_API_KEY no .env
npm start                              # escaneie o QR na 1ª vez (auth/ guarda a sessão)
```

## 🔧 Configuração (`.env`)

```
OPENROUTER_API_KEY=...        # https://openrouter.ai/keys
OPENROUTER_MODEL=google/gemini-2.5-flash   # transcrição (curtos) e correção
TRANSCRIBE_LANGUAGE=pt
OUTPUT_FORMAT=srt             # srt (com timestamps) ou plain
TRANSCRIBE_MODE=mention       # auto | mention | command
MAX_DURATION_SECONDS=0        # 0 = sem limite (longos vão pro Whisper)
WHISPER_MODEL=small           # tiny|base|small|medium (faster-whisper)
```

---

## 🏗️ Arquitetura

**Bot (Node, `src/`):**
- `index.js` — conexão WhatsApp + roteamento das mensagens + estados (legenda/corte)
- `messages.js` — inspeção de mensagens (mídia, menção, documento, texto)
- `audio.js` — extrai áudio com ffmpeg
- `transcribe.js` — transcrição via Gemini (curtos) ou Whisper (longos) + **corretor** (Gemini transcreve limpo + alinhamento LCS aos tempos do Whisper)
- `whisper.js` → `whisper_words.py` — faster-whisper (timestamp por palavra)
- `caption.js` — pipeline da legenda (transcreve → Remotion render → comprime)
- `caption-edit.js` — parsing de correções (CORREÇÃO), formatação com timestamps
- `cut.js` + `cut-store.js` — cortes (parse de trecho, ffmpeg, store em disco por ID da transcrição)
- `downloader.js` — media downloader: `detectMediaUrl`/`parseInstagram` (acha link e tipo) + `downloadMedia` (yt-dlp p/ vídeo, instaloader p/ Instagram, gallery-dl p/ foto). IG público sai sem login; stories/privado via `npm run ig-login` (sessão persistente)

**Render da legenda (Remotion, `caption-studio/`):** clonado de `remotion-dev/template-tiktok`.
- `src/CaptionedVideo/index.tsx` — composição (mantém resolução via `dims.json`), agrupa páginas, quebra por frase, máx 2 linhas
- `src/CaptionedVideo/Page.tsx` — **estilo Cover**: Instrument Sans (normal) + Instrument Serif Itálico (palavra de destaque = a mais longa da linha), contorno cinza + sombra preta, espaçamento apertado, revelação palavra a palavra, posição embaixo-centro
- `src/load-font.ts` — carrega `public/sans.ttf` (Instrument Sans) + `public/serif.ttf` (Instrument Serif Italic)

---

## 🎨 Estilo "Cover" (referência do usuário)

- Fonte: **Instrument** (Sans + Serif Itálico), espaçamento ~-6, **contorno cinza + sombra preta**
- Palavra de destaque em **serif itálico**; resto em sans
- Tamanho moderado, máx 2 linhas, palavra-a-palavra sincronizada (Whisper)
- Vídeo de referência do usuário: `C:\Users\Caio\Downloads\ssstik.io_@paidorealtime_*.mp4`

## 📌 Pendências / ideias

- Afinar **quais** palavras viram serif itálico (hoje: a mais longa de cada linha; o Captions usa IA própria)
- Testar o fluxo de **corte** com re-transcrição (o store por ID já está pronto)
- (Opcional) editor web Remotion para edição visual completa
