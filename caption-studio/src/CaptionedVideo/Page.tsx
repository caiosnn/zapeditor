import { TikTokPage } from "@remotion/captions";
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CoverSans, CoverSerif } from "../load-font";

type Token = TikTokPage["tokens"][number];

const letterCount = (s: string): number => s.replace(/[^\p{L}\p{N}]/gu, "").length;

/** Divide em NO MÁXIMO 2 linhas, equilibradas (≤3 palavras = 1 linha). */
const groupLines = (tokens: Token[]): Token[][] => {
  const n = tokens.length;
  if (n <= 3) return [tokens];
  const first = Math.ceil(n / 2);
  return [tokens.slice(0, first), tokens.slice(first)];
};

/** Palavra de destaque da linha (a mais longa, >= 4 letras) -> serif itálico. */
const emphasisIndex = (line: Token[]): number => {
  let best = -1;
  let bestLen = 3;
  line.forEach((t, i) => {
    const l = letterCount(t.text);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  });
  return best;
};

export const Page: React.FC<{ readonly page: TikTokPage }> = ({ page }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const lines = groupLines(page.tokens);
  const base = Math.round(height * 0.046);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: height * 0.3,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: Math.round(height * 0.004),
        }}
      >
        {lines.map((line, li) => {
          const emph = emphasisIndex(line);
          return (
            <div
              key={li}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "baseline",
                justifyContent: "center",
                gap: `${Math.round(base * 0.26)}px`,
                lineHeight: 1.05,
              }}
            >
              {line.map((t, wi) => {
                const startFrame = ((t.fromMs - page.startMs) / 1000) * fps;
                const since = frame - startFrame;
                const shown = since >= 0;
                const isEmph = wi === emph;
                const size = isEmph ? Math.round(base * 1.12) : base;

                const appear = shown
                  ? spring({
                      frame: since,
                      fps,
                      durationInFrames: 6,
                      config: { damping: 13, mass: 0.5, stiffness: 200 },
                    })
                  : 0;
                const scale = shown ? interpolate(appear, [0, 1], [0.6, 1]) : 0.6;
                const opacity = shown
                  ? interpolate(appear, [0, 1], [0, 1], { extrapolateRight: "clamp" })
                  : 0;

                const stroke = Math.max(1, Math.round(size * 0.026));
                return (
                  <span
                    key={`${t.fromMs}-${wi}`}
                    style={{
                      fontFamily: isEmph ? CoverSerif : CoverSans,
                      fontSize: size,
                      color: "white",
                      display: "inline-block",
                      letterSpacing: isEmph ? "0" : "-0.03em",
                      transform: `scale(${scale})`,
                      transformOrigin: "center 70%",
                      opacity,
                      // contorno cinza + sombra preta (atributos do Captions)
                      WebkitTextStroke: `${stroke}px rgba(120,120,120,0.85)`,
                      paintOrder: "stroke",
                      textShadow: `0 ${Math.round(size * 0.05)}px ${Math.round(
                        size * 0.09,
                      )}px rgba(0,0,0,0.62)`,
                      whiteSpace: "pre",
                    }}
                  >
                    {t.text.trim()}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
