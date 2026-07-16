import type { CSSProperties } from 'react';
import { calculateLyricLineProgress } from '@/services/lyrics/playbackSync';
import { getLyricDisplayText, getSecondaryLyricText } from './lyricDisplay';
import type { PlayerVisualizerProps } from './types';

const POSTER_WAVE_PATH =
  'M0 27 C10 27 12 22 20 22 C28 22 29 31 38 31 C47 31 48 18 58 18 C68 18 69 32 80 32 C91 32 92 24 102 24 C112 24 113 29 124 29 C135 29 136 17 148 17 C160 17 161 33 174 33 C187 33 188 22 200 22 C212 22 213 29 225 29 C237 29 238 20 250 20 C262 20 263 31 276 31 C289 31 290 23 302 23 C314 23 315 28 328 28 C341 28 342 24 360 24';
const POSTER_WAVE_ECHO_PATH =
  'M0 25 C12 25 13 29 25 29 C37 29 38 21 50 21 C62 21 63 28 75 28 C87 28 88 24 100 24 C112 24 113 30 126 30 C139 30 140 19 153 19 C166 19 167 27 180 27 C193 27 194 23 207 23 C220 23 221 29 234 29 C247 29 248 21 261 21 C274 21 275 28 288 28 C301 28 302 25 315 25 C328 25 329 27 342 27 C350 27 352 25 360 25';

export function PosterLyricsVisualizer({
  currentTrack,
  lyrics,
  currentLyricIndex,
  currentTime,
  progressPercent,
  isPlaying,
  showTranslation,
  controlsHidden,
}: PlayerVisualizerProps) {
  const currentLine = currentLyricIndex >= 0 ? lyrics[currentLyricIndex] : undefined;
  const primaryLyric = getLyricDisplayText(currentLine);
  const secondaryLyric = getSecondaryLyricText(lyrics, currentLyricIndex, showTranslation);
  const lyricProgress = calculateLyricLineProgress(lyrics, currentLyricIndex, currentTime);
  const lyricProgressPercent = `${Math.round(lyricProgress * 1000) / 10}%`;

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
            style={{ '--af-poster-lyric-progress': lyricProgressPercent } as CSSProperties}
          >
            {primaryLyric}
          </strong>
          {secondaryLyric && <span className="af-poster-secondary-lyric">{secondaryLyric}</span>}
        </div>
      </div>

      {controlsHidden && (
        <div className="af-poster-bottom-wave">
          <div className="af-poster-wave" aria-hidden="true">
            <svg className="af-poster-wave-svg" viewBox="0 0 360 54" preserveAspectRatio="none">
              <path className="af-poster-wave-baseline" d="M0 27 H360" />
              <path className="af-poster-wave-line" d={POSTER_WAVE_PATH} />
              <path className="af-poster-wave-line af-poster-wave-line-echo" d={POSTER_WAVE_ECHO_PATH} />
            </svg>
            <b
              className="af-poster-wave-progress"
              style={{ '--af-poster-wave-progress': `${progressPercent}%` } as CSSProperties}
            >
              <svg className="af-poster-wave-svg af-poster-wave-svg-progress" viewBox="0 0 360 54" preserveAspectRatio="none">
                <path className="af-poster-wave-line af-poster-wave-line-active" d={POSTER_WAVE_PATH} />
              </svg>
            </b>
          </div>
        </div>
      )}
    </div>
  );
}
