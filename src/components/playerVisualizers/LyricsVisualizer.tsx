import type { LyricLine } from '@/services/lyricsService';
import type { PlayerVisualizerProps } from './types';

function getLyricDisplayText(line: LyricLine): string {
  return line.text || line.words?.map((word) => word.text).join('') || ' ';
}

export function LyricsVisualizer({
  lyrics,
  currentLyricIndex,
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
          {lyrics.map((line, index) => (
            <div
              key={index}
              ref={lyricLineRef(index)}
              className={`af-lyric-line ${index === currentLyricIndex ? 'af-current' : ''}`}
            >
              <span className="af-lyric-primary">{getLyricDisplayText(line)}</span>
              {showTranslation && line.tr && (
                <span className="af-lyric-translation">{line.tr}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
