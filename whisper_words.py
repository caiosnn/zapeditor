"""Transcreve um áudio com faster-whisper e imprime JSON com timestamp por palavra.
Uso: python whisper_words.py <audio> [modelo] [idioma]
Saída (stdout): {"language": "...", "duration": N, "words": [{"word","start","end"}]}
"""
import sys
import json

# Garante UTF-8 no stdout (Windows usa cp1252 por padrão e quebra os acentos)
sys.stdout.reconfigure(encoding="utf-8")

from faster_whisper import WhisperModel

audio = sys.argv[1]
model_size = sys.argv[2] if len(sys.argv) > 2 else "small"
language = sys.argv[3] if len(sys.argv) > 3 else "pt"
if language in ("", "auto"):
    language = None

# int8 na CPU = rápido e leve; o modelo é baixado e cacheado no 1º uso.
model = WhisperModel(model_size, device="cpu", compute_type="int8")

segments, info = model.transcribe(
    audio,
    language=language,
    word_timestamps=True,
    vad_filter=True,
    beam_size=5,
)

words = []
for seg in segments:
    for w in (seg.words or []):
        text = w.word.strip()
        if not text:
            continue
        words.append({"word": text, "start": round(w.start, 3), "end": round(w.end, 3)})

print(json.dumps({"language": info.language, "duration": info.duration, "words": words}, ensure_ascii=False))
