import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import type { LocalLyricsChoiceFields } from '../src/services/localLyricsChoiceModel';

/**
 * `lyricsMode` 三态在歌词服务里的行为（`getLocalLyricsOverride` 的落点）。
 *
 * 重点是「不联网」必须可观察：picked / local-only 一律不发任何歌词请求，也不读自动匹配缓存；
 * local-only 没有本地词时返回权威空，绝不回退搜索。auto 下空白文本只是「没有文本」，
 * 仍然走既有自动链（空串不再表示「明确不匹配」）。
 */

const deps = vi.hoisted(() => ({
  getSource: vi.fn(),
  getCachedLyrics: vi.fn(),
  saveCachedLyrics: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/services/sources/sourceService', () => ({ getSource: deps.getSource }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: deps.fetch }));
vi.mock('@/services/persistentCache', () => ({
  getCachedLyrics: deps.getCachedLyrics,
  saveCachedLyrics: deps.saveCachedLyrics,
  isCacheableEmptyLyricResult: () => true,
}));

import { __lyricsInternals, getLyrics, getLocalLyricsOverride } from '../src/services/lyricsService';

type LocalTrack = MusicInfo & LocalLyricsChoiceFields;

let sequence = 0;
const localTrack = (extra: Partial<LocalTrack> = {}): LocalTrack => ({
  // 每例一个新 id：模块内的内存缓存按 source:id 命中，复用 id 会串味
  id: `local-choice-${++sequence}`,
  source: 'local',
  name: '日',
  singer: '吴亦凡',
  albumName: '专辑',
  interval: 200,
  ...extra,
});

const texts = (result: { lines: { text: string }[] }) => result.lines.map((line) => line.text);

beforeEach(() => {
  vi.resetAllMocks();
  deps.getSource.mockReturnValue(undefined);
  deps.getCachedLyrics.mockResolvedValue(null);
  deps.saveCachedLyrics.mockResolvedValue(undefined);
  // 任何一次出站都直接抛错：这样「不联网」既被调用数断言兜住，也会在误调用时炸得明明白白
  deps.fetch.mockImplementation(() => {
    throw new Error('不该发起任何歌词网络请求');
  });
});

describe('picked：只用选中的那一份，永不联网再搜', () => {
  it('返回选中的文本，且不读持久化/内存缓存、不发起任何请求', async () => {
    deps.getCachedLyrics.mockResolvedValue({ lines: [{ time: 1, text: '旧自动匹配' }] });
    const track = localTrack({ lyricsMode: 'picked', localLyrics: '[00:01]选中的词', lyricsFingerprint: '200:abc' });

    expect(texts(await getLyrics(track))).toEqual(['选中的词']);
    expect(texts(await __lyricsInternals.getLyricsForSingle(track))).toEqual(['选中的词']);

    expect(deps.getCachedLyrics).not.toHaveBeenCalled();
    expect(deps.saveCachedLyrics).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.getSource).not.toHaveBeenCalled();
  });

  it('选中的文本没了等于选择失效：交给自动链，而不是显示空歌词', async () => {
    const track = localTrack({ lyricsMode: 'picked', localLyrics: '', lyricsFingerprint: '200:abc' });

    expect(getLocalLyricsOverride(track)).toBeNull();
    // 自动链会真的去问 LRCLIB / 平台搜索（都被 mock 成抛错），说明没有停在 picked 上
    expect((await getLyrics(track)).lines).toEqual([]);
    expect(deps.fetch).toHaveBeenCalled();
  });
});

describe('local-only：不联网，只用本机已有的词', () => {
  it('有本地词时返回它，且零出站、不读自动匹配缓存', async () => {
    deps.getCachedLyrics.mockResolvedValue({ lines: [{ time: 1, text: '旧自动匹配' }] });
    const track = localTrack({ lyricsMode: 'local-only', localLyrics: '[00:01]内嵌词', lyricsFingerprint: '200:abc' });

    expect(texts(await getLyrics(track))).toEqual(['内嵌词']);
    expect(texts(await __lyricsInternals.getLyricsForSingle(track))).toEqual(['内嵌词']);

    expect(deps.getCachedLyrics).not.toHaveBeenCalled();
    expect(deps.saveCachedLyrics).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('一句本地词都没有时返回权威空，绝不回退搜索', async () => {
    deps.getCachedLyrics.mockResolvedValue({ lines: [{ time: 1, text: '旧自动匹配' }] });
    const track = localTrack({ lyricsMode: 'local-only', localLyrics: '', lyricsFingerprint: '200:abc' });

    expect(await getLyrics(track)).toEqual({ lines: [] });
    expect(await __lyricsInternals.getLyricsForSingle(track)).toEqual({ lines: [] });

    expect(deps.getCachedLyrics).not.toHaveBeenCalled();
    expect(deps.saveCachedLyrics).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.getSource).not.toHaveBeenCalled();
  });
});

describe('auto：既有行为，空串不再表示「明确不匹配」', () => {
  it('按曲文本仍然是权威输入，不联网', async () => {
    const track = localTrack({ localLyrics: '[00:01]手写的词' });

    expect(texts(await getLyrics(track))).toEqual(['手写的词']);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('空白文本只表示「没有文本」：回到自动链（LRCLIB → 平台搜索）', async () => {
    const track = localTrack({ localLyrics: '   ' });

    // 自动链的第一步是 LRCLIB 直查；被 mock 成抛错后由调用方吞掉并继续搜平台
    const result = await getLyrics(track);

    expect(deps.fetch).toHaveBeenCalled();
    expect(result.lines).toEqual([]);
  });
});

describe('getLocalLyricsOverride 的三态分派', () => {
  it('local-only 无文本是权威空，picked/auto 无文本是「没有覆盖」', () => {
    expect(getLocalLyricsOverride(localTrack({ lyricsMode: 'local-only' }))).toEqual({ lines: [] });
    expect(getLocalLyricsOverride(localTrack({ lyricsMode: 'picked' }))).toBeNull();
    expect(getLocalLyricsOverride(localTrack())).toBeNull();
  });

  it('无法识别的 mode 按 auto 处理', () => {
    const track = localTrack({ lyricsMode: 'who-knows' as LocalLyricsChoiceFields['lyricsMode'], localLyrics: '' });
    expect(getLocalLyricsOverride(track)).toBeNull();
  });

  it('非空但解析不出行时显式报错，不悄悄换成自动词', () => {
    const result = getLocalLyricsOverride(localTrack({ lyricsMode: 'picked', localLyrics: '没有时间戳的原文' }));
    expect(result).toEqual({ lines: [], error: '本地歌词无法解析' });
  });
});
