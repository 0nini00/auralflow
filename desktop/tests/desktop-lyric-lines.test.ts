import { describe, expect, it } from 'vitest';
import type { LyricLine } from '@lx/core';
import {
  buildDesktopLyricLines,
  DESKTOP_LYRIC_SCROLL_BASE_MS,
  getDesktopLyricScrollDuration,
  getDesktopLyricScrollLayout,
  getDesktopLyricScrollTop,
} from '../src/utils/desktopLyric';

const lines = [
  { time: 0, text: '第一行', tr: 'tr-0' },
  { time: 5, text: '第二行' },
  { time: 10, text: '第三行', words: [{ start: 10, end: 11, text: '第' }, { start: 11, end: 12, text: '三' }] },
  { time: 15, text: '   ' },
] as unknown as LyricLine[];

const base = { lines, hasCurrentMusic: true, showTranslation: false };

describe('buildDesktopLyricLines', () => {
  it('返回整篇歌词与当前行下标，而不是只截一段', () => {
    const result = buildDesktopLyricLines({ ...base, currentLine: 1, currentTime: 7 });
    expect(result.lines).toHaveLength(4);
    expect(result.currentIndex).toBe(1);
    expect(result.lines.map((line) => line.index)).toEqual([0, 1, 2, 3]);
    expect(result.lines.map((line) => line.text)).toEqual(['第一行', '第二行', '第三行', '...']);
  });

  it('按当前行划分 previous / current / next（补上「上一行」）', () => {
    const result = buildDesktopLyricLines({ ...base, currentLine: 2, currentTime: 10 });
    expect(result.lines.map((line) => line.role)).toEqual(['previous', 'previous', 'current', 'next']);
  });

  it('进度与逐字只挂在当前行', () => {
    const result = buildDesktopLyricLines({ ...base, currentLine: 2, currentTime: 10.5 });
    const current = result.lines[2];
    expect(current.words).toHaveLength(2);
    expect(typeof current.progress).toBe('number');
    for (const other of [result.lines[0], result.lines[1], result.lines[3]]) {
      expect(other.words).toBeUndefined();
      expect(other.progress).toBeUndefined();
    }
  });

  it('译文按开关透传，只给有译文的行', () => {
    const withTr = buildDesktopLyricLines({ ...base, currentLine: 0, showTranslation: true });
    expect(withTr.lines[0].translation).toBe('tr-0');
    expect(withTr.lines[1].translation).toBeUndefined();

    const withoutTr = buildDesktopLyricLines({ ...base, currentLine: 0, showTranslation: false });
    expect(withoutTr.lines[0].translation).toBeUndefined();
  });

  it('当前行越界时夹到首尾', () => {
    expect(buildDesktopLyricLines({ ...base, currentLine: -3 }).currentIndex).toBe(0);
    expect(buildDesktopLyricLines({ ...base, currentLine: 99 }).currentIndex).toBe(3);
  });

  it('没有歌曲或没有歌词时给一条占位行', () => {
    const noMusic = buildDesktopLyricLines({ ...base, lines: [], hasCurrentMusic: false, currentLine: 0 });
    expect(noMusic.currentIndex).toBe(0);
    expect(noMusic.lines).toEqual([
      { key: 'no-music', role: 'empty', index: -1, text: '打开主窗口选首歌吧' },
    ]);

    const noLyric = buildDesktopLyricLines({ ...base, lines: [], currentLine: 0 });
    expect(noLyric.lines).toEqual([{ key: 'empty', role: 'empty', index: -1, text: '暂无歌词' }]);
  });
});

describe('桌面歌词滚动几何：首尾留白与当前行行位', () => {
  it('首尾 spacer 让第一句与最后一句也能停到当前行行位', () => {
    // 3 行窗口、中间行位：上下各留一格行高
    expect(getDesktopLyricScrollLayout({ visibleLines: 3, currentRow: 1, lineHeight: 36, lineGap: 8 }))
      .toEqual({ spacerTop: 36, spacerBottom: 36, step: 44 });
    // 2 行窗口当前行在最上面：只要下方留白
    expect(getDesktopLyricScrollLayout({ visibleLines: 2, currentRow: 0, lineHeight: 36, lineGap: 8 }))
      .toEqual({ spacerTop: 0, spacerBottom: 36, step: 44 });
    // 单行窗口不需要留白
    expect(getDesktopLyricScrollLayout({ visibleLines: 1, currentRow: 0, lineHeight: 36, lineGap: 8 }))
      .toEqual({ spacerTop: 0, spacerBottom: 0, step: 44 });
  });

  it('行高还没量到时留白为 0，不会把歌词顶出可视区', () => {
    expect(getDesktopLyricScrollLayout({ visibleLines: 3, currentRow: 1, lineHeight: 0, lineGap: 8 }))
      .toEqual({ spacerTop: 0, spacerBottom: 0, step: 8 });
  });

  it('首行、中间行、末行都落在当前行行位', () => {
    const { spacerTop, step } = getDesktopLyricScrollLayout({ visibleLines: 3, currentRow: 1, lineHeight: 36, lineGap: 8 });
    // 行与 spacer 之间也会吃一次 gap，所以第一行的 offsetTop 是 spacerTop + gap
    const lineTop = (index: number) => spacerTop + 8 + index * step;
    const maxScroll = 10 * step; // 11 行时「内容高 - 可见高」
    expect(getDesktopLyricScrollTop({ lineTop: lineTop(0), currentRow: 1, step, maxScroll })).toBe(0);
    expect(getDesktopLyricScrollTop({ lineTop: lineTop(5), currentRow: 1, step, maxScroll })).toBe(5 * step);
    expect(getDesktopLyricScrollTop({ lineTop: lineTop(10), currentRow: 1, step, maxScroll })).toBe(maxScroll);
  });

  it('超出可滚动区间时夹住，避免滚出内容', () => {
    expect(getDesktopLyricScrollTop({ lineTop: -100, currentRow: 1, step: 44, maxScroll: 440 })).toBe(0);
    expect(getDesktopLyricScrollTop({ lineTop: 9999, currentRow: 1, step: 44, maxScroll: 440 })).toBe(440);
  });

  it('动效强度决定滚动时长，关掉动效或减少动态时直接到位', () => {
    expect(getDesktopLyricScrollDuration({ enabled: true, intensityScale: 1, reduceMotion: false })).toBe(DESKTOP_LYRIC_SCROLL_BASE_MS);
    expect(getDesktopLyricScrollDuration({ enabled: true, intensityScale: 0.55, reduceMotion: false })).toBe(176);
    expect(getDesktopLyricScrollDuration({ enabled: true, intensityScale: 1.25, reduceMotion: false })).toBe(400);
    expect(getDesktopLyricScrollDuration({ enabled: false, intensityScale: 1, reduceMotion: false })).toBe(0);
    expect(getDesktopLyricScrollDuration({ enabled: true, intensityScale: 1, reduceMotion: true })).toBe(0);
  });
});
