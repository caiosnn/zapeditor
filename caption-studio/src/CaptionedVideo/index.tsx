import { Caption, createTikTokStyleCaptions } from "@remotion/captions";
import { getVideoMetadata } from "@remotion/media-utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  cancelRender,
  getStaticFiles,
  OffthreadVideo,
  Sequence,
  staticFile,
  useDelayRender,
  useVideoConfig,
  watchStaticFile,
} from "remotion";
import { z } from "zod";
import { loadFont } from "../load-font";
import { NoCaptionFile } from "./NoCaptionFile";
import SubtitlePage from "./SubtitlePage";

export type SubtitleProp = {
  startInSeconds: number;
  text: string;
};

export const captionedVideoSchema = z.object({
  src: z.string(),
});

export const calculateCaptionedVideoMetadata: CalculateMetadataFunction<
  z.infer<typeof captionedVideoSchema>
> = async ({ props }) => {
  const fps = 30;
  const metadata = await getVideoMetadata(props.src);
  // mantém a MESMA resolução do vídeo enviado (dimensões pares p/ o H.264).
  // A resolução vem do dims.json (ffprobe), pois getVideoMetadata às vezes erra a altura.
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  let width = metadata.width;
  let height = metadata.height;
  try {
    const dims = await (await fetch(staticFile("dims.json"))).json();
    if (dims?.width && dims?.height) {
      width = dims.width;
      height = dims.height;
    }
  } catch {
    // segue com getVideoMetadata
  }

  return {
    fps,
    durationInFrames: Math.floor(metadata.durationInSeconds * fps),
    width: even(width),
    height: even(height),
  };
};

const getFileExists = (file: string) => {
  const files = getStaticFiles();
  const fileExists = files.find((f) => {
    return f.src === file;
  });
  return Boolean(fileExists);
};

// Quantas palavras por "página" de legenda (maior = agrupa frases mais longas,
// como o Captions, que junta ~6 palavras e quebra em 2 linhas de 3).
const SWITCH_CAPTIONS_EVERY_MS = 1500;

// Faixa preta no topo (a legenda agora fica embaixo, então 0 = sem faixa).
const COVER_TOP_PERCENT = 0;

type Page = ReturnType<typeof createTikTokStyleCaptions>["pages"][number];

const makePage = (tokens: Page["tokens"]): Page => ({
  text: tokens.map((t) => t.text).join(""),
  startMs: tokens[0].fromMs,
  durationMs: tokens[tokens.length - 1].toMs - tokens[0].fromMs,
  tokens,
});

// Quebra as páginas nas fronteiras de FRASE (., !, ?) para o Captions não
// misturar o fim de uma frase com o começo da próxima na mesma tela.
const splitAtSentences = (pages: Page[]): Page[] => {
  const out: Page[] = [];
  for (const page of pages) {
    let start = 0;
    for (let i = 0; i < page.tokens.length; i++) {
      const isEnd = /[.!?]$/.test(page.tokens[i].text.trim());
      if (isEnd || i === page.tokens.length - 1) {
        const toks = page.tokens.slice(start, i + 1);
        if (toks.length) out.push(makePage(toks));
        start = i + 1;
      }
    }
  }
  return out;
};

// No MÁXIMO 2 linhas por tela = 6 palavras (3 por linha).
const MAX_WORDS_PER_PAGE = 6;
const capPageLength = (pages: Page[]): Page[] =>
  pages.flatMap((p) => {
    if (p.tokens.length <= MAX_WORDS_PER_PAGE) return [p];
    const out: Page[] = [];
    for (let i = 0; i < p.tokens.length; i += MAX_WORDS_PER_PAGE) {
      out.push(makePage(p.tokens.slice(i, i + MAX_WORDS_PER_PAGE)));
    }
    return out;
  });

export const CaptionedVideo: React.FC<{
  src: string;
}> = ({ src }) => {
  const [subtitles, setSubtitles] = useState<Caption[]>([]);
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = useState(() => delayRender());
  const { fps } = useVideoConfig();

  const subtitlesFile = src
    .replace(/.mp4$/, ".json")
    .replace(/.mkv$/, ".json")
    .replace(/.mov$/, ".json")
    .replace(/.webm$/, ".json");

  const fetchSubtitles = useCallback(async () => {
    try {
      await loadFont();
      const res = await fetch(subtitlesFile);
      const data = (await res.json()) as Caption[];
      setSubtitles(data);
      continueRender(handle);
    } catch (e) {
      cancelRender(e);
    }
  }, [continueRender, handle, subtitlesFile]);

  useEffect(() => {
    fetchSubtitles();

    const c = watchStaticFile(subtitlesFile, () => {
      fetchSubtitles();
    });

    return () => {
      c.cancel();
    };
  }, [fetchSubtitles, src, subtitlesFile]);

  const { pages } = useMemo(() => {
    return createTikTokStyleCaptions({
      combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS,
      captions: subtitles ?? [],
    });
  }, [subtitles]);

  // separa por frase e limita a 2 linhas (6 palavras) por tela
  const pagesSplit = useMemo(() => capPageLength(splitAtSentences(pages)), [pages]);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill>
        <OffthreadVideo
          style={{
            objectFit: "cover",
          }}
          src={src}
        />
      </AbsoluteFill>
      {COVER_TOP_PERCENT > 0 ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: `${COVER_TOP_PERCENT}%`,
            backgroundColor: "black",
          }}
        />
      ) : null}
      {pagesSplit.map((page, index) => {
        const nextPage = pagesSplit[index + 1] ?? null;
        const subtitleStartFrame = (page.startMs / 1000) * fps;
        const subtitleEndFrame = Math.min(
          nextPage ? (nextPage.startMs / 1000) * fps : Infinity,
          subtitleStartFrame + SWITCH_CAPTIONS_EVERY_MS,
        );
        const durationInFrames = subtitleEndFrame - subtitleStartFrame;
        if (durationInFrames <= 0) {
          return null;
        }

        return (
          <Sequence
            key={index}
            from={subtitleStartFrame}
            durationInFrames={durationInFrames}
          >
            <SubtitlePage key={index} page={page} />;
          </Sequence>
        );
      })}
      {getFileExists(subtitlesFile) ? null : <NoCaptionFile />}
    </AbsoluteFill>
  );
};
