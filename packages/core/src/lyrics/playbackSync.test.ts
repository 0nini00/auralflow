import { describe, expect, it } from 'vitest';
import {
  calculateLyricLineProgress,
  calculateWordLevelLineProgress,
  estimatePlaybackProgress,
  findCurrentLyricLineIndex,
  LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS,
  type PlaybackProgressClock,
  type TimedLyricLine,
} from './playbackSync';

const LINES: TimedLyricLine[] = [
  { time: 10, text: '第一行' },
  { time: 20, text: '第二行' },
  { time: 30, text: '第三行' },
];

describe('findCurrentLyricLineIndex', () => {
  it('空列表与首行之前返回 -1，由调用方决定空态或预高亮', () => {
    expect(findCurrentLyricLineIndex([], 50)).toBe(-1);
    expect(findCurrentLyricLineIndex(LINES, 5)).toBe(-1);
    // 提前量也不足以够到首行
    expect(findCurrentLyricLineIndex(LINES, 9, { leadSeconds: 0.08 })).toBe(-1);
  });

  it('提前量让行起点前 0.08s 即切入', () => {
    expect(findCurrentLyricLineIndex(LINES, 19.95)).toBe(0);
    expect(findCurrentLyricLineIndex(LINES, 19.95, { leadSeconds: 0.08 })).toBe(1);
  });

  it('滞后带只对前进方向生效：刚越过行起点仍停留上一行，落在行中部立即切换', () => {
    const justCrossed = 20 + LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS / 2;
    expect(findCurrentLyricLineIndex(LINES, justCrossed, { hysteresisSeconds: LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS })).toBe(0);
    // 无状态判定：落在行中部（超过滞后带）立即切换，seek 回退同样即时
    expect(findCurrentLyricLineIndex(LINES, 20.5, { hysteresisSeconds: LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS })).toBe(1);
    expect(findCurrentLyricLineIndex(LINES, 30.06, { hysteresisSeconds: LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS })).toBe(1);
    expect(findCurrentLyricLineIndex(LINES, 30.5, { hysteresisSeconds: LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS })).toBe(2);
  });

  it('二分落在最后一个满足 time <= target 的行', () => {
    expect(findCurrentLyricLineIndex(LINES, 29.9)).toBe(1);
    expect(findCurrentLyricLineIndex(LINES, 100)).toBe(2);
  });
});

describe('calculateWordLevelLineProgress', () => {
  const absolute: TimedLyricLine = {
    time: 10,
    text: 'abcd',
    words: [
      { start: 10, dur: 2 },
      { start: 12, dur: 2 },
    ],
  };

  it('绝对时间戳：进度 = 已完成字 + 当前字内插值，再除以字数', () => {
    expect(calculateWordLevelLineProgress(absolute, 9)).toBe(0);
    // 两个字：t=11 在第一个字中点 → (0 + 0.5) / 2 = 0.25
    expect(calculateWordLevelLineProgress(absolute, 11)).toBe(0.25);
    expect(calculateWordLevelLineProgress(absolute, 12)).toBe(0.5);
    expect(calculateWordLevelLineProgress(absolute, 13)).toBe(0.75);
    expect(calculateWordLevelLineProgress(absolute, 15)).toBe(1);
  });

  it('相对行首的时间戳（小于行起点）按偏移解释', () => {
    const relative: TimedLyricLine = {
      time: 10,
      words: [
        { start: 0, dur: 2 },
        { start: 2, dur: 2 },
      ],
    };
    expect(calculateWordLevelLineProgress(relative, 11)).toBe(0.25);
    expect(calculateWordLevelLineProgress(relative, 14)).toBe(1);
  });

  it('没有字级时间返回 null，由调用方回退行级估算', () => {
    expect(calculateWordLevelLineProgress({ time: 10, text: 'x' }, 11)).toBeNull();
  });
});

describe('calculateLyricLineProgress', () => {
  it('无字级时间：时长取文本估计与到下一行间隙的较小值', () => {
    // 5 个 CJK 字：0.65 + 5×0.24 = 1.85s，间隙 10s 更大 → 时长 1.85
    const lines: TimedLyricLine[] = [{ time: 10, text: '一二三四五' }, { time: 20, text: '下一行' }];
    expect(calculateLyricLineProgress(lines, 0, 10)).toBe(0);
    expect(calculateLyricLineProgress(lines, 0, 10.925)).toBeCloseTo(0.5, 5);
    // 间奏长间隙：估计时长内走完并停在 1
    expect(calculateLyricLineProgress(lines, 0, 12)).toBe(1);
  });

  it('间隙比估计更短时跟间隙走，避免提前走完', () => {
    const lines: TimedLyricLine[] = [{ time: 10, text: '一二三四五' }, { time: 11, text: '下一行' }];
    expect(calculateLyricLineProgress(lines, 0, 10.5)).toBeCloseTo(0.5, 5);
  });

  it('有字级时间时优先字级进度（字级路径本身不做间隙截断）', () => {
    const lines: TimedLyricLine[] = [
      {
        time: 10,
        text: 'abcd',
        words: [
          { start: 10, dur: 1 },
          { start: 11, dur: 3 },
        ],
      },
      { time: 13, text: '下一行' },
    ];
    // t=11.5：第一个字完成，第二个字走了 0.5/3 → (1 + 1/6) / 2
    expect(calculateLyricLineProgress(lines, 0, 11.5)).toBeCloseTo(7 / 12, 5);
    expect(calculateLyricLineProgress(lines, 0, 14)).toBe(1);
  });

  it('currentLine 越界返回 0', () => {
    expect(calculateLyricLineProgress(LINES, 99, 50)).toBe(0);
  });
});

describe('estimatePlaybackProgress', () => {
  const clock = (overrides: Partial<PlaybackProgressClock>): PlaybackProgressClock => ({
    status: 'playing',
    progress: 100,
    duration: 200,
    playbackRate: 1,
    updatedAt: 1_000_000_000,
    ...overrides,
  });

  it('playing 时按墙钟外推并夹到时长内', () => {
    expect(estimatePlaybackProgress(clock({}), 1_000_000_000 + 1_000)).toBe(101);
    expect(estimatePlaybackProgress(clock({ progress: 199, playbackRate: 2 }), 1_000_000_000 + 1_400)).toBe(200);
  });

  it('暂停与时间倒流不外推', () => {
    expect(estimatePlaybackProgress(clock({ status: 'paused' }), 1_000_000_000 + 2_000)).toBe(100);
    expect(estimatePlaybackProgress(clock({}), 999_000_000)).toBe(100);
  });

  it('时钟超过 1.5s 未刷新（后台挂起）不再外推，避免歌词冲过头', () => {
    expect(estimatePlaybackProgress(clock({}), 1_000_000_000 + 1_400)).toBe(101.4);
    expect(estimatePlaybackProgress(clock({}), 1_000_000_000 + 1_600)).toBe(100);
  });

  it('非法倍速按 1 处理', () => {
    expect(estimatePlaybackProgress(clock({ playbackRate: 0 }), 1_000_000_000 + 1_000)).toBe(101);
    expect(estimatePlaybackProgress(clock({ playbackRate: Number.NaN }), 1_000_000_000 + 1_000)).toBe(101);
    expect(estimatePlaybackProgress(clock({ playbackRate: 2 }), 1_000_000_000 + 1_000)).toBe(102);
  });
});
