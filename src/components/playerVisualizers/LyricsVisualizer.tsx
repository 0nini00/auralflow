import type { CSSProperties } from 'react';
import type { LyricLine } from '@/services/lyricsService';
import { calculateLyricLineProgress } from '@/services/lyrics/playbackSync';
import type { PlayerVisualizerProps } from './types';

function getLyricDisplayText(line: LyricLine): string {
  return line.text || line.words?.map((word) => word.text).join('') || ' ';
}

function getWordProgress(currentTime: number, start: number, duration: number): number {
  if (currentTime <= start) return 0;
  if (duration <= 0) return 1;
  return Math.max(0, Math.min((currentTime - start) / duration, 1));
}

function getPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function renderPrimaryLyric(
  line: LyricLine,
  currentTime: number,
  isCurrent: boolean,
  lineProgress: number,
) {
  if (!line.words?.length) {
    return (
      <span
        className={`af-lyric-primary ${isCurrent ? 'af-lyric-primary-sweep' : ''}`}
        style={{ '--af-line-progress': getPercent(lineProgress) } as CSSProperties}
      >
        {getLyricDisplayText(line)}
      </span>
    );
  }

  const label = getLyricDisplayText(line);
  return (
    <span className="af-lyric-primary af-lyric-karaoke" aria-label={label}>
      {line.words.map((word, wordIndex) => {
        const progress = isCurrent ? getWordProgress(currentTime, word.start, word.dur) : 0;
        return (
          <span
            key={`${word.start}-${wordIndex}`}
            className="af-lyric-word"
            data-text={word.text}
            style={{ '--af-word-progress': getPercent(progress) } as CSSProperties}
            aria-hidden="true"
          >
            {word.text}
          </span>
        );
      })}
    </span>
  );
}

export function LyricsVisualizer({
  lyrics,
  currentLyricIndex,
  currentTime,
  showTranslation,
  lyricsViewportRef,
  handleLyricsWheel,
  lyricLineRef,
}: PlayerVisualizerProps) {
  return (
    <div className="af-lyrics-viewport" ref={lyricsViewportRef} onWheel={handleLyricsWheel}>
      {lyrics.length === 0 ? (
        <div className="af-lyrics-empty">暂无歌词</div>
      ) : (
        <div className="af-lyrics-track">
          {lyrics.map((line, index) => {
            const isCurrent = index === currentLyricIndex;
            const offset = currentLyricIndex < 0 ? 0 : index - currentLyricIndex;
            const distance = Math.min(Math.abs(offset), 4);
            const lineProgress = isCurrent
              ? calculateLyricLineProgress(lyrics, index, currentTime)
              : 0;

            return (
              <div
                key={index}
                ref={lyricLineRef(index)}
                className={[
                  'af-lyric-line',
                  isCurrent ? 'af-current' : '',
                  offset < 0 ? 'af-before' : '',
                  offset > 0 ? 'af-after' : '',
                ].filter(Boolean).join(' ')}
                style={{
                  '--af-line-distance': distance,
                  '--af-line-offset': offset,
                } as CSSProperties}
              >
                {renderPrimaryLyric(line, currentTime, isCurrent, lineProgress)}
                {showTranslation && line.tr && (
                  <span className="af-lyric-translation">{line.tr}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
