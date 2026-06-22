import type { LyricLine } from "@/services/lyricsService";

export type DesktopLyricLineRole = "current" | "next" | "empty";

export interface DesktopLyricDisplayLine {
  key: string;
  role: DesktopLyricLineRole;
  text: string;
  translation?: string;
}

export interface DesktopLyricLineOptions {
  lines: LyricLine[];
  currentLine: number;
  hasCurrentMusic: boolean;
  showNextLine: boolean;
  singleLine: boolean;
  maxLineNum: number;
  showTranslation: boolean;
}

const NO_MUSIC_TEXT = "打开主窗口选首歌吧";
const EMPTY_LYRIC_TEXT = "暂无歌词";

function clampCurrentIndex(currentLine: number, lineCount: number) {
  if (lineCount <= 0) return -1;
  if (currentLine < 0) return 0;
  if (currentLine >= lineCount) return lineCount - 1;
  return currentLine;
}

function normalizeLineText(text: string | undefined) {
  const normalized = text?.trim();
  return normalized || "♪";
}

export function buildDesktopLyricLines({
  lines,
  currentLine,
  hasCurrentMusic,
  showNextLine,
  singleLine,
  maxLineNum,
  showTranslation,
}: DesktopLyricLineOptions): DesktopLyricDisplayLine[] {
  if (!hasCurrentMusic) {
    return [{ key: "no-music", role: "empty", text: NO_MUSIC_TEXT }];
  }
  if (lines.length === 0) {
    return [{ key: "empty", role: "empty", text: EMPTY_LYRIC_TEXT }];
  }

  const currentIndex = clampCurrentIndex(currentLine, lines.length);
  const current = lines[currentIndex];
  const result: DesktopLyricDisplayLine[] = [{
    key: `current-${currentIndex}`,
    role: "current",
    text: normalizeLineText(current.text),
    ...(showTranslation && current.tr ? { translation: current.tr } : {}),
  }];

  if (singleLine || !showNextLine) return result;

  const targetCount = Math.max(1, Math.min(4, Math.trunc(maxLineNum || 1)));
  for (let index = currentIndex + 1; index < lines.length && result.length < targetCount; index += 1) {
    const line = lines[index];
    result.push({
      key: `next-${index}`,
      role: "next",
      text: normalizeLineText(line.text),
      ...(showTranslation && line.tr ? { translation: line.tr } : {}),
    });
  }

  return result;
}
