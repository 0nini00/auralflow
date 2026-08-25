import type { CSSProperties } from 'react';
import { calculateLyricLineProgress } from '@/services/lyrics/playbackSync';
import type { LyricLine, LyricWord } from '@/services/lyricsService';
import { getLyricDisplayText, getSecondaryLyricText } from './lyricDisplay';
import type { PlayerVisualizerProps } from './types';

/** 每个字的已播进度（0..1）：currentTime 小于字开始为 0，超出结束为 1。 */
function perWordProgressPercent(line: LyricLine, currentTime: number): number[] {
  if (!line.words?.length) return [];
  return line.words.map((word) => {
    if (currentTime <= word.start) return 0;
    if (word.dur <= 0 || currentTime >= word.start + word.dur) return 1;
    return (currentTime - word.start) / word.dur;
  });
}

/** 渲染单个卡拉OK 字：两层 span 叠加，上层用 clip-path 按进度裁剪出高亮色。 */
function renderKaraokeWord(word: LyricWord, progress: number, key: number) {
  const pct = Math.min(100, Math.max(0, Math.round(progress * 1000) / 10));
  return (
    <span key={key} className="af-poster-karaoke-word">
      <span className="af-poster-karaoke-word-base">{word.text}</span>
      <span
        className="af-poster-karaoke-word-fill"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` } as CSSProperties}
      >
        {word.text}
      </span>
    </span>
  );
}

export function PosterLyricsVisualizer({
  currentTrack,
  lyrics,
  currentLyricIndex,
  currentTime,
  isPlaying,
  showTranslation,
}: PlayerVisualizerProps) {
  const currentLine = currentLyricIndex >= 0 ? lyrics[currentLyricIndex] : undefined;
  const primaryLyric = getLyricDisplayText(currentLine);
  const secondaryLyric = getSecondaryLyricText(lyrics, currentLyricIndex, showTranslation);
  const lyricProgress = calculateLyricLineProgress(lyrics, currentLyricIndex, currentTime);
  const lyricProgressPercent = `${Math.round(lyricProgress * 1000) / 10}%`;

  // 有字级时间轴（YRC/QRC/KRC/enhanced-lrc）时走逐字卡拉OK 渲染；每帧随 currentTime 重算，48 字内开销可接受
  const karaokeWords = currentLine?.words?.length ? currentLine.words : null;
  const karaokeProgress = karaokeWords ? perWordProgressPercent(currentLine!, currentTime) : null;

  return (
    <div className={`af-poster-lyrics-visualizer ${isPlaying ? 'af-playing' : ''}`} aria-live="polite">
      <div className="af-poster-reference-panel">
        <div className="af-poster-track-copy">
          <h2>{currentTrack?.name ?? '暂无播放内容'}</h2>
          <p>{currentTrack?.singer || '未知歌手'}</p>
        </div>

        <div className="af-poster-lyric-panel">
          <strong
            className="af-poster-primary-lyric"
            style={
              karaokeProgress
                ? // 字级路径：关闭行级渐变避免与子层文字叠加串色
                  ({ backgroundImage: 'none' } as CSSProperties)
                : ({ '--af-poster-lyric-progress': lyricProgressPercent } as CSSProperties)
            }
          >
            {karaokeProgress && karaokeWords
              ? karaokeWords.map((word, i) => renderKaraokeWord(word, karaokeProgress[i], i))
              : primaryLyric}
          </strong>
          {secondaryLyric && <span className="af-poster-secondary-lyric">{secondaryLyric}</span>}
        </div>
      </div>
    </div>
  );
}
