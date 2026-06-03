import { TikTokPage } from "@remotion/captions";
import React from "react";
import { AbsoluteFill } from "remotion";
import { Page } from "./Page";

const SubtitlePage: React.FC<{ readonly page: TikTokPage }> = ({ page }) => {
  return (
    <AbsoluteFill>
      <Page page={page} />
    </AbsoluteFill>
  );
};

export default SubtitlePage;
