import type { CSSProperties } from 'react';
import { useLyricAutoScroll } from '@/hooks/useLyricAutoScroll';
import { calculateLyricLineProgress } from '@/services/lyrics/playbackSync';
import type { LyricLine, LyricWord } from '@/services/lyricsService';
import { getLyricDisplayText } from './lyricDisplay';
import type { PlayerVisualizerProps } from './types';

function getWordProgress(word: LyricWord, currentTime: number): number {
  if (currentTime <= word.start) return 0;
  if (word.dur <= 0 || currentTime >= word.start + word.dur) return 1;
  return (currentTime - word.start) / word.dur;
}

function renderKaraokeWord(word: LyricWord, currentTime: number, key: number) {
  const progress = getWordProgress(word, currentTime);
  const percent = Math.min(100, Math.max(0, Math.round(progress * 1000) / 10));
  return (
    <span key={key} className="af-scrolling-karaoke-word">
      <span className="af-scrolling-karaoke-word-base">{word.text}</span>
      <span
        className="af-scrolling-karaoke-word-fill"
        style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
      >
        {word.text}
      </span>
    </span>
  );
}

function buildContentKey(trackKey: string, lyrics: LyricLine[]): string {
  if (lyrics.length === 0) return `${trackKey}:empty`;
  return `${trackKey}:${lyrics.length}:${lyrics[0].time}:${lyrics[lyrics.length - 1].time}`;
}

export function ScrollingLyricsVisualizer({
  currentTrack,
  lyrics,
  currentLyricIndex,
  currentTime,
  isPlaying,
  showTranslation,
  layoutKey,
}: PlayerVisualizerProps) {
  const trackKey = `${currentTrack?.source ?? ''}:${currentTrack?.id ?? ''}`;
  const bindings = useLyricAutoScroll({
    currentLineIndex: currentLyricIndex,
    contentKey: buildContentKey(trackKey, lyrics),
    layoutKey: `${layoutKey}:${lyrics.length}`,
    isPlaying,
  });

  if (lyrics.length === 0) {
    return <div className="af-scrolling-lyrics-empty">暂无歌词</div>;
  }

  return (
    <div
      ref={bindings.containerRef}
      className={`af-scrolling-lyrics ${isPlaying ? 'af-playing' : ''}`}
      onWheel={bindings.onWheel}
      onPointerDown={bindings.onPointerDown}
      onPointerMove={bindings.onPointerMove}
      onPointerUp={bindings.onPointerUp}
      onPointerCancel={bindings.onPointerCancel}
      aria-label="滚动歌词"
    >
      <div className="af-scrolling-lyrics-spacer af-scrolling-lyrics-spacer-top" aria-hidden="true" />
      {lyrics.map((line, index) => {
        const active = index === currentLyricIndex;
        const lineProgress = active
          ? calculateLyricLineProgress(lyrics, currentLyricIndex, currentTime)
          : index < currentLyricIndex ? 1 : 0;
        const lineProgressPercent = `${Math.round(lineProgress * 1000) / 10}%`;
        const karaokeWords = active && line.words?.length ? line.words : null;

        return (
          <div
            key={`${line.time}:${index}`}
            ref={bindings.setLineRef(index)}
            className={`af-scrolling-lyric-line ${active ? 'af-active' : ''}`}
            aria-current={active ? 'true' : undefined}
          >
            <div
              className="af-scrolling-lyric-primary"
              style={{ '--af-scrolling-lyric-progress': lineProgressPercent } as CSSProperties}
            >
              {karaokeWords
                ? karaokeWords.map((word, wordIndex) => renderKaraokeWord(word, currentTime, wordIndex))
                : getLyricDisplayText(line)}
            </div>
            {showTranslation && line.tr && (
              <div className="af-scrolling-lyric-translation">{line.tr}</div>
            )}
          </div>
        );
      })}
      <div className="af-scrolling-lyrics-spacer af-scrolling-lyrics-spacer-bottom" aria-hidden="true" />
    </div>
  );
}
