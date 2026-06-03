import { continueRender, delayRender, staticFile } from "remotion";

export const CoverSans = "CoverSans"; // Instrument Sans (palavras normais)
export const CoverSerif = "CoverSerif"; // Instrument Serif Italic (destaque)

let loaded = false;

export const loadFont = async (): Promise<void> => {
  if (loaded) {
    return Promise.resolve();
  }
  const wait = delayRender();
  loaded = true;

  const sans = new FontFace(
    CoverSans,
    `url('${staticFile("sans.ttf")}') format('truetype')`,
  );
  const serif = new FontFace(
    CoverSerif,
    `url('${staticFile("serif.ttf")}') format('truetype')`,
  );

  await Promise.all([sans.load(), serif.load()]);
  document.fonts.add(sans);
  document.fonts.add(serif);

  continueRender(wait);
};
