import { LyricText, LyricRomanization } from './LyricAnnotations';
import { memo, useCallback, type CSSProperties, type RefCallback } from 'react';
import { useLyricAutoScroll } from '@/hooks/useLyricAutoScroll';
import { useInterpolatedPlaybackProgress, usePlaybackProgressValue } from '@/hooks/useInterpolatedPlaybackProgress';
import { calculateLyricLineProgress, DEFAULT_LYRIC_LEAD_SECONDS, findCurrentLyricLineIndex, LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS, type PlaybackProgressClock } from '@lx/core';
import type { LyricLine, LyricWord } from '@/services/lyricsService';
import { getLyricDisplayText } from './lyricDisplay';
import type { PlayerVisualizerProps } from './types';

function getWordProgress(word: LyricWord, currentTime: number): number {
  if (currentTime <= word.start) return 0;
  if (word.dur <= 0 || currentTime >= word.start + word.dur) return 1;
  return (currentTime - word.start) / word.dur;
}

function renderKaraokeWord(word: LyricWord, currentTime: number, key: number, showRuby: boolean) {
  const progress = getWordProgress(word, currentTime);
  const percent = Math.min(100, Math.max(0, Math.round(progress * 1000) / 10));
  return (
    <span key={key} className="af-scrolling-karaoke-word">
      <span className="af-scrolling-karaoke-word-base"><LyricText {...word} showRuby={showRuby} /></span>
      <span
        className="af-scrolling-karaoke-word-fill"
        aria-hidden="true"
        style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
      >
        <LyricText {...word} showRuby={showRuby} />
      </span>
    </span>
  );
}

function buildContentKey(trackKey: string, lyrics: LyricLine[]): string {
  if (lyrics.length === 0) return `${trackKey}:empty`;
  return `${trackKey}:${lyrics.length}:${lyrics[0].time}:${lyrics[lyrics.length - 1].time}`;
}

function clockOptions(clock: PlaybackProgressClock | undefined, currentTime: number) {
  return clock
    ? { ...clock, progressSampledAt: clock.updatedAt }
    : { status: 'paused', progress: currentTime, duration: 0, playbackRate: 1 };
}

function ActiveLyricText({ lyrics, index, clock, currentTime, offset, showRuby }: {
  lyrics: LyricLine[]; index: number; clock?: PlaybackProgressClock;
  currentTime: number; offset: number; showRuby: boolean;
}) {
  const progress = useInterpolatedPlaybackProgress(clockOptions(clock, currentTime));
  const time = progress + (clock ? offset : 0);
  const line = lyrics[index];
  const percent = `${Math.round(calculateLyricLineProgress(lyrics, index, time) * 1000) / 10}%`;
  return <div className="af-scrolling-lyric-primary" style={{ '--af-scrolling-lyric-progress': percent } as CSSProperties}>
    {line.words?.length
      ? line.words.map((word, wordIndex) => renderKaraokeWord(word, time, wordIndex, showRuby))
      : <LyricText {...line} text={getLyricDisplayText(line)} showRuby={showRuby} />}
  </div>;
}

const LyricRow = memo(function LyricRow({ line, lyrics, index, active, completed, lineRef, clock, currentTime,
  offset, showRuby, showRomanization, showTranslation }: {
  line: LyricLine; lyrics: LyricLine[]; index: number; active: boolean; completed: boolean;
  lineRef: RefCallback<HTMLDivElement>; clock?: PlaybackProgressClock; currentTime: number;
  offset: number; showRuby: boolean; showRomanization: boolean; showTranslation: boolean;
}) {
  return <div ref={lineRef} className={`af-scrolling-lyric-line ${active ? 'af-active' : ''}`} aria-current={active ? 'true' : undefined}>
    {active
      ? <ActiveLyricText lyrics={lyrics} index={index} clock={clock} currentTime={currentTime} offset={offset} showRuby={showRuby} />
      : <div className="af-scrolling-lyric-primary" style={{ '--af-scrolling-lyric-progress': completed ? '100%' : '0%' } as CSSProperties}>
        <LyricText {...line} text={getLyricDisplayText(line)} showRuby={showRuby} />
      </div>}
    <LyricRomanization text={line.roma} show={showRomanization} />
    {showTranslation && line.tr && <div className="af-scrolling-lyric-translation">{line.tr}</div>}
  </div>;
});

export function ScrollingLyricsVisualizer({
  currentTrack,
  lyrics,
  currentLyricIndex,
  currentTime,
  isPlaying,
  showTranslation,
  showRomanization = false,
  showRuby = false,
  layoutKey,
  playbackClock,
  lyricOffsetSeconds = 0,
}: PlayerVisualizerProps) {
  const trackKey = `${currentTrack?.source ?? ''}:${currentTrack?.id ?? ''}`;
  const selectLine = useCallback((progress: number) => {
    if (!playbackClock) return currentLyricIndex;
    if (!lyrics.length) return -1;
    return Math.max(0, findCurrentLyricLineIndex(lyrics, progress + lyricOffsetSeconds, {
      leadSeconds: DEFAULT_LYRIC_LEAD_SECONDS,
      hysteresisSeconds: LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS,
    }));
  }, [currentLyricIndex, lyricOffsetSeconds, lyrics, playbackClock]);
  const activeIndex = usePlaybackProgressValue(clockOptions(playbackClock, currentTime), selectLine);
  const bindings = useLyricAutoScroll({
    currentLineIndex: activeIndex,
    contentKey: buildContentKey(trackKey, lyrics),
    layoutKey: `${layoutKey}:${lyrics.length}:${showRuby}:${showRomanization}`,
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
      {lyrics.map((line, index) => <LyricRow key={`${line.time}:${index}`} line={line} lyrics={lyrics} index={index}
        active={index === activeIndex} completed={index < activeIndex} lineRef={bindings.setLineRef(index)}
        clock={index === activeIndex ? playbackClock : undefined} currentTime={index === activeIndex ? currentTime : 0}
        offset={lyricOffsetSeconds} showRuby={showRuby} showRomanization={showRomanization} showTranslation={showTranslation} />)}
      <div className="af-scrolling-lyrics-spacer af-scrolling-lyrics-spacer-bottom" aria-hidden="true" />
    </div>
  );
}
