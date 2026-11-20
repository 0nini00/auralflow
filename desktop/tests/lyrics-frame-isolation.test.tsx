// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ScrollingLyricsVisualizer } from '../src/components/playerVisualizers/ScrollingLyricsVisualizer';

const rendering = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock('@/components/playerVisualizers/LyricAnnotations', () => ({
  LyricText: ({ text }: { text: string }) => { rendering.texts.push(text); return <>{text}</>; },
  LyricRomanization: () => null,
}));
vi.mock('@/hooks/useLyricAutoScroll', () => ({ useLyricAutoScroll: () => ({ setLineRef: () => undefined }) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); rendering.texts = []; });

it('逐帧歌词只更新活动行，时钟跨行及 seek 会切换，静止行不重算', () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const lyrics = Array.from({ length: 300 }, (_, index) => ({
    time: index, text: `Line ${index}`, words: [{ text: `Line ${index}`, start: index, dur: 1 }],
  }));
  const container = document.createElement('div');
  const root = createRoot(container);
  const props = { currentTrack: null, coverUrl: '', lyrics, currentLyricIndex: 0, currentTime: 0,
    duration: 300, progressPercent: 0, isPlaying: true, showTranslation: true, layoutKey: 'test',
    playbackClock: { status: 'playing', progress: 0, updatedAt: 10000, duration: 300, playbackRate: 1 } };
  try {
    act(() => root.render(<ScrollingLyricsVisualizer {...props} />));
    rendering.texts = [];
    const mapLyrics = vi.spyOn(lyrics, 'map');
    act(() => vi.advanceTimersByTime(400));
    expect(container.querySelector('.af-scrolling-karaoke-word-fill')?.getAttribute('style')).toContain('60%');
    expect(rendering.texts.length).toBeGreaterThan(0);
    expect(rendering.texts.every(text => text === 'Line 0')).toBe(true);
    expect(mapLyrics).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(700));
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Line 1');
    act(() => root.render(<ScrollingLyricsVisualizer {...props} currentTime={20} currentLyricIndex={20}
      playbackClock={{ ...props.playbackClock, progress: 20.2, updatedAt: Date.now() }} />));
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Line 20');
    act(() => root.render(<ScrollingLyricsVisualizer {...props} isPlaying={false} lyricOffsetSeconds={2}
      playbackClock={{ ...props.playbackClock, status: 'paused', progress: 20.2, updatedAt: Date.now() }} />));
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Line 22');
    const paused = container.querySelector('.af-scrolling-karaoke-word-fill')?.getAttribute('style');
    act(() => vi.advanceTimersByTime(2000));
    expect(container.querySelector('.af-scrolling-karaoke-word-fill')?.getAttribute('style')).toBe(paused);
    mapLyrics.mockRestore();
  } finally { act(() => root.unmount()); }
});
