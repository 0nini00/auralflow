import { describe, expect, it } from 'vitest';
import type { LyricLine } from '@lx/core';
import { buildDesktopLyricLines } from '../src/utils/desktopLyric';

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
