import type { LyricLine, LyricWord } from "@/services/lyricsService";
import { calculateLyricLineProgress } from "@/services/lyrics/playbackSync";

export type DesktopLyricLineRole = "previous" | "current" | "next" | "empty";

export interface DesktopLyricDisplayLine {
  key: string;
  role: DesktopLyricLineRole;
  /** 在 lyrics 数组中的下标；占位行为 -1 */
  index: number;
  text: string;
  translation?: string;
  progress?: number;
  /** 逐字时间轴（仅当前行透传，存在时启用卡拉OK 渲染） */
  words?: LyricWord[];
  /** 行起始时间（秒）；部分格式的 word.start 相对行首，需用它换算绝对时间 */
  time?: number;
}

export interface DesktopLyricLineOptions {
  lines: LyricLine[];
  currentLine: number;
  hasCurrentMusic: boolean;
  showTranslation: boolean;
  currentTime?: number;
}

export interface DesktopLyricBuildResult {
  /** 整篇歌词；没有歌曲或没有歌词时是一条占位行 */
  lines: DesktopLyricDisplayLine[];
  /** 当前行在上面数组中的下标（占位行时为 0） */
  currentIndex: number;
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
  return normalized || "...";
}

/**
 * 把整篇歌词铺成可滚动的行列表，并标出当前行。
 *
 * 早先这里只产出「当前行 + 后续若干行」，滚动窗口里就永远看不到刚唱过的那句；
 * 现在改成整篇 + currentIndex，由渲染层把当前行滚到固定行位（见 LyricWindowView），
 * 这样上下都有上下文，窗口显示几行只由窗口高度决定。
 */
export function buildDesktopLyricLines({
  lines,
  currentLine,
  hasCurrentMusic,
  showTranslation,
  currentTime,
}: DesktopLyricLineOptions): DesktopLyricBuildResult {
  if (!hasCurrentMusic) {
    return {
      lines: [{ key: "no-music", role: "empty", index: -1, text: NO_MUSIC_TEXT }],
      currentIndex: 0,
    };
  }
  if (lines.length === 0) {
    return {
      lines: [{ key: "empty", role: "empty", index: -1, text: EMPTY_LYRIC_TEXT }],
      currentIndex: 0,
    };
  }

  const currentIndex = clampCurrentIndex(currentLine, lines.length);
  const built: DesktopLyricDisplayLine[] = lines.map((line, index) => {
    const role: DesktopLyricLineRole =
      index === currentIndex ? "current" : index < currentIndex ? "previous" : "next";
    return {
      key: `${role}-${index}`,
      role,
      index,
      text: normalizeLineText(line.text),
      ...(showTranslation && line.tr ? { translation: line.tr } : {}),
      // 进度与逐字只对当前行有意义，其余行不参与卡拉OK
      ...(index === currentIndex && typeof currentTime === "number"
        ? { progress: calculateLyricLineProgress(lines, currentIndex, currentTime) }
        : {}),
      ...(index === currentIndex && line.words?.length ? { words: line.words, time: line.time } : {}),
    };
  });

  return { lines: built, currentIndex };
}
