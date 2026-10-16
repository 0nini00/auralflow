import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

/**
 * 「选择歌词」面板的候选列表：来源齐备、只排序标注不隐藏、失败只回流错误。
 *
 * 桩数据用真实接口形态（lrclib /api/get 的 syncedLyrics、网易 /api/search/get/web 的
 * artists+album+duration、/api/song/lyric 的 lrc.lyric），只有网络这一层被替换。
 */

const deps = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: deps.fetch }));

import {
  __lyricsInternals,
  fetchLyricsCandidateLines,
  formatLyricsAsLrc,
  listLocalLyricCandidates,
} from '../src/services/lyricsService';

interface HttpCall { url: URL; raw: string }
const httpCalls: HttpCall[] = [];

function mockHttp(handler: (url: URL, raw: string) => { status: number; data?: any }) {
  deps.fetch.mockImplementation((raw: string) => {
    const url = new URL(raw);
    httpCalls.push({ url, raw });
    const result = handler(url, raw);
    return Promise.resolve({
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.data ?? {},
    });
  });
}

const callsTo = (hostname: string, pathname?: string) =>
  httpCalls.filter((call) => call.url.hostname === hostname && (pathname === undefined || call.url.pathname === pathname));
const lrclibCalls = () => callsTo('lrclib.net');
const wySearchCalls = () => callsTo('music.163.com', '/api/search/get/web');
const wyLyricCalls = () => callsTo('music.163.com', '/api/song/lyric');

const localTrack = (extra: Partial<MusicInfo> = {}): MusicInfo => ({
  id: 'local-choice', source: 'local', name: '日', singer: '吴亦凡', albumName: '专辑', interval: 200,
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  httpCalls.length = 0;
});

describe('候选来源与排序标注', () => {
  it('本地已有 → LRCLIB → 平台召回，按 core 的档位与时长差排序并标注', async () => {
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') {
        return { status: 200, data: { trackName: '日', artistName: '吴亦凡', duration: 200, syncedLyrics: '[00:01]LRCLIB 的词' } };
      }
      if (url.pathname === '/api/search/get/web') {
        return {
          status: 200,
          data: {
            result: {
              songs: [
                { id: 7001, name: '日', artists: [{ name: '吴亦凡' }], album: { name: '专辑' }, duration: 200000 },
                { id: 7002, name: '日', artists: [{ name: '湘伦' }], album: { name: '翻唱集' }, duration: 201000 },
                { id: 7003, name: '别的歌', artists: [{ name: '某人' }], album: { name: '别的专辑' }, duration: 100000 },
              ],
            },
          },
        };
      }
      if (url.pathname === '/api/song/lyric') {
        return { status: 200, data: { lrc: { lyric: `[00:01]第 ${url.searchParams.get('id')} 条` } } };
      }
      throw new Error(`不应请求 ${url.href}`);
    });

    const { candidates, error } = await listLocalLyricCandidates(localTrack({
      localLyrics: '[00:01]文件里的词',
    }));

    expect(error).toBeUndefined();
    expect(candidates.map((candidate) => candidate.sourceLabel)).toEqual(['本地文件', 'LRCLIB', '网易云', '网易云', '网易云']);
    expect(candidates.map((candidate) => candidate.key)).toEqual(['local', 'lrclib', 'wy:7001', 'wy:7002', 'wy:7003']);
    // 档位只用于排序与标注：同一录音档在前，同曲异唱档其次，判定不出的排在最后但**不隐藏**
    expect(candidates.map((candidate) => candidate.tier)).toEqual([undefined, undefined, 'same-recording', 'other-performer', undefined]);
    expect(candidates[0]).toMatchObject({ preview: '文件里的词', name: '日', singer: '吴亦凡', albumName: '专辑' });
    expect(candidates[1]).toMatchObject({ preview: 'LRCLIB 的词' });
    expect(candidates[2]).toMatchObject({
      name: '日', singer: '吴亦凡', albumName: '专辑', durationDeltaSeconds: 0, preview: '第 7001 条', neteaseId: '7001',
    });
    expect(candidates[3]).toMatchObject({ singer: '湘伦', albumName: '翻唱集', durationDeltaSeconds: 1 });
    expect(candidates[4]).toMatchObject({ name: '别的歌', durationDeltaSeconds: 100 });
    expect(candidates[4].tier).toBeUndefined();
    expect(candidates[4].lines?.map((line) => line.text)).toEqual(['第 7003 条']);
  });

  it('平台召回整体摆出来：超出预览预算的候选仍然在列，只是没有首行预览', async () => {
    const songs = Array.from({ length: 8 }, (_, index) => ({
      id: 8001 + index, name: `别的歌 ${index}`, artists: [{ name: '某人' }], album: { name: '专辑' }, duration: 100000,
    }));
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 404 };
      if (url.pathname === '/api/search/get/web') return { status: 200, data: { result: { songs } } };
      if (url.pathname === '/api/song/lyric') {
        return { status: 200, data: { lrc: { lyric: `[00:01]第 ${url.searchParams.get('id')} 条` } } };
      }
      throw new Error(`不应请求 ${url.href}`);
    });

    const { candidates } = await listLocalLyricCandidates(localTrack());

    expect(candidates).toHaveLength(8);
    expect(candidates.slice(0, 6).every((candidate) => Boolean(candidate.preview) && Boolean(candidate.lines)))
      .toBe(true);
    // 预览预算只给最靠前的几条，其余点选时再取（见 fetchLyricsCandidateLines）
    expect(wyLyricCalls()).toHaveLength(6);
    for (const candidate of candidates.slice(6)) {
      expect(candidate.preview).toBeUndefined();
      expect(candidate.lines).toBeUndefined();
      expect(candidate.neteaseId).toMatch(/^800[78]$/);
    }

    const lines = await fetchLyricsCandidateLines(candidates[7]);
    expect(wyLyricCalls()).toHaveLength(7);
    expect(wyLyricCalls()[6].url.searchParams.get('id')).toBe('8008');
    expect(lines.map((line) => line.text)).toEqual(['第 8008 条']);
  });

  it('已经取到词的候选点选时不再请求一次', async () => {
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 200, data: { duration: 200, syncedLyrics: '[00:01]LRCLIB 的词' } };
      if (url.pathname === '/api/search/get/web') return { status: 200, data: { result: { songs: [] } } };
      throw new Error(`不应请求 ${url.href}`);
    });

    const { candidates } = await listLocalLyricCandidates(localTrack());
    const lrclib = candidates.find((candidate) => candidate.kind === 'lrclib')!;
    expect(lrclibCalls()).toHaveLength(1);

    expect((await fetchLyricsCandidateLines(lrclib)).map((line) => line.text)).toEqual(['LRCLIB 的词']);
    expect(lrclibCalls()).toHaveLength(1);
  });
});

describe('候选搜索失败', () => {
  it('平台搜索报错只回流错误，本地那一档仍然可用（离线也能选「不要匹配」）', async () => {
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 404 };
      if (url.pathname === '/api/search/get/web') return { status: 500 };
      throw new Error(`不应请求 ${url.href}`);
    });

    const { candidates, error } = await listLocalLyricCandidates(localTrack({ localLyrics: '[00:01]文件里的词' }));

    expect(error).toContain('平台搜索失败');
    expect(candidates.map((candidate) => candidate.kind)).toEqual(['local']);
    expect(candidates[0].lines?.map((line) => line.text)).toEqual(['文件里的词']);
  });

  it('LRCLIB 不可用时同样只回流错误，不吞掉平台候选', async () => {
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') throw new Error('network down');
      if (url.pathname === '/api/search/get/web') {
        return {
          status: 200,
          data: {
            result: {
              songs: [{ id: 9001, name: '日', artists: [{ name: '吴亦凡' }], album: { name: '专辑' }, duration: 200000 }],
            },
          },
        };
      }
      if (url.pathname === '/api/song/lyric') return { status: 200, data: { lrc: { lyric: '[00:01]平台的词' } } };
      throw new Error(`不应请求 ${url.href}`);
    });

    const { candidates, error } = await listLocalLyricCandidates(localTrack());

    expect(error).toContain('LRCLIB 查询失败');
    expect(candidates.map((candidate) => candidate.key)).toEqual(['wy:9001']);
    expect(wySearchCalls()).toHaveLength(1);
  });

  it('信息不完整时不发起任何查询', async () => {
    mockHttp(() => { throw new Error('不该发起任何请求'); });

    expect(await listLocalLyricCandidates(localTrack({ name: '' }))).toEqual({ candidates: [], error: '歌曲信息不完整' });
    expect(httpCalls).toHaveLength(0);
  });
});

describe('选中一份文本时的序列化', () => {
  it('把候选的行写成可被本地解析器读回来的 LRC（译文单独成行，空行丢弃）', () => {
    const lrc = formatLyricsAsLrc([
      { time: 2, text: '一' },
      { time: 2, text: '二', tr: 'two' },
      { time: 61.5, text: '三' },
      { time: 90, text: '   ' },
    ]);

    expect(lrc).toBe('[00:02.000]一\n[00:02.000]二\n[00:02.000]two\n[01:01.500]三');
    // 存下来的文本必须能自己解析回同样的行：不新增字段就靠这一点
    expect(__lyricsInternals.parseEmbeddedLyrics(lrc).map((line) => line.text)).toEqual(['一', '二', 'two', '三']);
  });
});
