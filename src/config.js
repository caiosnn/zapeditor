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
