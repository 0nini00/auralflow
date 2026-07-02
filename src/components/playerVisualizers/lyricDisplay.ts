import type { LyricLine } from '@/services/lyricsService';

export function getLyricDisplayText(line?: LyricLine | null): string {
  if (!line) return '暂无歌词';
  return line.text || line.words?.map((word) => word.text).join('') || ' ';
}

export function getSecondaryLyricText(
  lyrics: LyricLine[],
  currentIndex: number,
  showTranslation: boolean,
): string {
  const currentLine = currentIndex >= 0 ? lyrics[currentIndex] : undefined;
  if (showTranslation && currentLine?.tr) return currentLine.tr;

  const nextLine = currentIndex >= 0 ? lyrics[currentIndex + 1] : lyrics[0];
  if (nextLine && nextLine !== currentLine) return getLyricDisplayText(nextLine);

  return '';
}

