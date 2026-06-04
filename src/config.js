import 'dotenv/config'

export const config = {
  openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || '',
  // Modelo multimodal (precisa aceitar áudio). Padrão: Gemini 2.5 Flash.
  model: process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash',
  language: process.env.TRANSCRIBE_LANGUAGE?.trim() || '',
  // Formato da resposta: 'srt' (estilo legenda com minutagem) ou 'plain' (texto corrido)
  outputFormat: (process.env.OUTPUT_FORMAT?.trim() || 'srt').toLowerCase(),
  // Modelo do Whisper local (faster-whisper) para legenda animada: tiny|base|small|medium
  whisperModel: process.env.WHISPER_MODEL?.trim() || 'small',
  pythonBin: process.env.PYTHON_BIN?.trim() || 'python',
  mode: (process.env.TRANSCRIBE_MODE?.trim() || 'auto').toLowerCase(),
  maxDuration: Number(process.env.MAX_DURATION_SECONDS ?? 600) || 0,
  // Palavra-chave usada no modo "command"
  commandTrigger: '!transcrever',

  // --- Especialista de IA / Higgsfield (geração de imagem e vídeo) ---
  // Liga/desliga o agente especialista (texto direcionado ao bot vira pedido de geração/consultoria).
  expertEnabled: (process.env.EXPERT_ENABLED?.trim() || 'true').toLowerCase() !== 'false',
  // Modelo (OpenRouter) que raciocina como especialista. Cai no de transcrição se não setado.
  expertModel: process.env.EXPERT_MODEL?.trim() || process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash',
  // Caminho do entry-point do CLI higgsfield (auto-detectado se vazio).
  higgsfieldEntry: process.env.HIGGSFIELD_ENTRY?.trim() || '',
  // Modelos padrão de geração (job_set_type do Higgsfield).
  defaultImageModel: process.env.HF_IMAGE_MODEL?.trim() || 'nano_banana_2',
  defaultVideoModel: process.env.HF_VIDEO_MODEL?.trim() || 'veo3_1',
  // Parâmetros padrão.
  defaultImageResolution: process.env.HF_IMAGE_RESOLUTION?.trim() || '2k',
  defaultVideoDuration: process.env.HF_VIDEO_DURATION?.trim() || '8',
  defaultVideoQuality: process.env.HF_VIDEO_QUALITY?.trim() || 'basic',
  // Vídeo custa créditos: confirmar antes de gerar? (imagem é barata e vai direto)
  confirmVideo: (process.env.HF_CONFIRM_VIDEO?.trim() || 'true').toLowerCase() !== 'false',

  // Enviar toda mídia produzida TAMBÉM como documento (qualidade original, sem recompressão).
  sendOriginalDoc: (process.env.SEND_ORIGINAL_DOC?.trim() || 'true').toLowerCase() !== 'false',

  // --- Media downloader (yt-dlp + gallery-dl) ---
  // Marcar o bot (ou mandar no privado) num link de YouTube/X/Instagram/TikTok baixa a mídia.
  downloaderEnabled: (process.env.DOWNLOADER_ENABLED?.trim() || 'true').toLowerCase() !== 'false',
  // Caminhos dos binários (auto-detectados no PATH se vazios). yt-dlp baixa vídeo; gallery-dl, foto.
  ytDlpPath: process.env.YTDLP_PATH?.trim() || '',
  galleryDlPath: process.env.GALLERYDL_PATH?.trim() || '',
  // Caminho do ffmpeg (arquivo ou pasta). Vazio = auto-detecta (PATH ou winget). CRÍTICO: sem ele
  // o yt-dlp não junta vídeo+áudio e cai numa resolução baixa (o PM2 nem sempre tem ffmpeg no PATH).
  ffmpegLocation: process.env.FFMPEG_LOCATION?.trim() || '',
  // Codec do vídeo: 'h264' = compatível com editores (Premiere/CapCut) — H.264/AAC, até 1080p no YouTube.
  //                 'best' = máxima resolução (pode vir VP9/AV1 4K, que muitos editores não abrem).
  downloadVideoCodec: (process.env.DOWNLOAD_VIDEO_CODEC?.trim() || 'h264').toLowerCase() === 'best' ? 'best' : 'h264',
  // Qualidade do vídeo: 0 = SEMPRE a maior disponível (sem teto). >0 limita a altura (ex.: 1080).
  downloadMaxHeight: Number(process.env.DOWNLOAD_MAX_HEIGHT ?? 0) || 0,
  // Teto de tamanho (generoso p/ alta qualidade) e duração.
  downloadMaxFilesizeMB: Number(process.env.DOWNLOAD_MAX_FILESIZE_MB ?? 500) || 500,
  downloadMaxDurationSec: Number(process.env.DOWNLOAD_MAX_DURATION_SEC ?? 1200) || 1200,
  // Máximo de arquivos por link (carrossel do Instagram, galeria, etc).
  downloadMaxItems: Number(process.env.DOWNLOAD_MAX_ITEMS ?? 10) || 10,
  // Navegador de onde puxar cookies (ex.: chrome|edge|firefox) p/ conteúdo que exige login. Vazio = sem cookies.
  downloadCookiesFromBrowser: process.env.DOWNLOAD_COOKIES_BROWSER?.trim() || '',
  // Arquivo cookies.txt (formato Netscape) p/ IG/X logado — mais estável no servidor que ler o navegador.
  downloadCookiesFile: process.env.DOWNLOAD_COOKIES_FILE?.trim() || '',
  // Instagram via instaloader (sessão persistente: login uma vez, dura meses). Usuário do IG.
  instagramUser: process.env.INSTAGRAM_USER?.trim() || '',
  // Caminho do executável instaloader (vazio = auto-detecta no PATH).
  instaloaderPath: process.env.INSTALOADER_PATH?.trim() || '',
  // Arquivo de sessão do instaloader (vazio = auth/instaloader/session-<user>).
  instaloaderSession: process.env.INSTALOADER_SESSION?.trim() || '',

  // --- Arquivamento automático no Google Drive ---
  // Credenciais do OAuth "app para computador" (Google Cloud Console).
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || '',
  // Liga o arquivamento (true|false).
  archiveEnabled: (process.env.ARCHIVE_ENABLED?.trim() || 'false').toLowerCase() === 'true',
  // JIDs dos grupos a arquivar (separados por vírgula). Ex: 12036...@g.us
  archiveGroups: (process.env.ARCHIVE_GROUPS?.trim() || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Loga "nome do grupo -> JID" pra você descobrir o JID (ligar só uma vez).
  archiveDiscover: (process.env.ARCHIVE_DISCOVER?.trim() || 'false').toLowerCase() === 'true',
  // Pasta raiz no Drive onde tudo é organizado.
  archiveRootFolder: process.env.ARCHIVE_ROOT_FOLDER?.trim() || 'Edições WhatsApp',

  // --- Biblioteca de edições (guardar/recuperar vídeos em pastas nomeadas no Drive) ---
  // "esse é o compilado X" guarda o vídeo em Edições/Compilados/X.mp4; "manda o compilado X" recupera.
  editsEnabled: (process.env.EDITS_ENABLED?.trim() || 'true').toLowerCase() !== 'false',
  // Subpasta (dentro de ARCHIVE_ROOT_FOLDER) que agrupa as categorias de edição.
  editsParentFolder: process.env.EDITS_FOLDER?.trim() || 'Edições',

  // --- Interface web (gestão do arquivamento por grupo) ---
  webEnabled: (process.env.WEB_ENABLED?.trim() || 'false').toLowerCase() === 'true',
  webPort: Number(process.env.WEB_PORT ?? 3333) || 3333,
  webPassword: process.env.WEB_PASSWORD?.trim() || '',

  // Números (com DDI, só dígitos) autorizados a gerenciar o arquivamento pelo
  // WhatsApp (privado do bot). Separados por vírgula. Ex: 556199938020
  adminNumbers: (process.env.ADMIN_NUMBERS || '')
    .split(',')
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean),
}

if (!config.openRouterApiKey) {
  console.error(
    '\n❌ OPENROUTER_API_KEY não configurada.\n' +
      '   1. Copie .env.example para .env\n' +
      '   2. Pegue uma chave em https://openrouter.ai/keys\n' +
      '   3. Cole em OPENROUTER_API_KEY=\n'
  )
  process.exit(1)
}
