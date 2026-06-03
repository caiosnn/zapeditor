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
