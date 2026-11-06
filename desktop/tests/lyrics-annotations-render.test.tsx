import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { parseLyricSource, mergeRomanization } from '@lx/core';
import { ScrollingLyricsVisualizer } from '../src/components/playerVisualizers/ScrollingLyricsVisualizer';
vi.mock('@/hooks/useLyricAutoScroll', () => ({ useLyricAutoScroll: () => ({ setLineRef: () => undefined }) }));
const lyrics = mergeRomanization(parseLyricSource({ content: '[00:01]<00:01><ruby>日<rt>ひ</rt></ruby><00:02>へ' }), '[00:01]hi e');
lyrics[0].tr = '向着太阳';
const props = { currentTrack: null, coverUrl: '', lyrics, currentLyricIndex: 0, currentTime: 1.5, duration: 10, progressPercent: 15, isPlaying: true, showTranslation: true, layoutKey: 'test' };
it(`${ScrollingLyricsVisualizer.name} 独立控制 roma/ruby，保留翻译和逐字进度`, () => {
  const hidden = renderToStaticMarkup(<ScrollingLyricsVisualizer {...props} />);
  expect(hidden).not.toContain('<ruby');
  expect(hidden).not.toContain('hi e');
  const roma = renderToStaticMarkup(<ScrollingLyricsVisualizer {...props} showRomanization showRuby={false} />);
  expect(roma).toContain('hi e');
  expect(roma).not.toContain('<ruby');
  const ruby = renderToStaticMarkup(<ScrollingLyricsVisualizer {...props} showRomanization={false} showRuby />);
  expect(ruby).toContain('<ruby');
  expect(ruby).toContain('ひ</rt>');
  expect(ruby).not.toContain('hi e');
  expect(ruby).toContain('向着太阳');
  expect(ruby).toContain('clip-path:inset(0 50% 0 0)');
});
it(`${ScrollingLyricsVisualizer.name} 无数据不开空白占位，源 HTML 仅作为转义文本`, () => {
  const markup = renderToStaticMarkup(<ScrollingLyricsVisualizer {...props} showRomanization showRuby lyrics={[{ time: 1, text: '<img src=x onerror=alert(1)>' }]} />);
  expect(markup).not.toContain('<ruby');
  expect(markup).not.toContain('af-lyric-romanization');
  expect(markup).not.toContain('<img');
  expect(markup).toContain('&lt;img');
});
