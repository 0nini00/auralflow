import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

/**
 * 本地歌曲歌词自动匹配：LRC Lib 两轮直查 + 网易搜索交 @lx/core 判定。
 *
 * 桩数据用真实接口形态（lrclib /api/get 的 duration、网易 /api/search/get/web 的
 * artists+album+duration、/api/song/lyric 的 lrc.lyric），只有网络这一层被替换。
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
  isCacheableEmptyLyricResult: () => false,
}));

import { __lyricsInternals } from '../src/services/lyricsService';

const { searchAndMatchLyrics } = __lyricsInternals;

interface HttpCall {
  raw: string;
  url: URL;
}

const httpCalls: HttpCall[] = [];

function mockHttp(handler: (url: URL, raw: string) => { status: number; data?: any }) {
  deps.fetch.mockImplementation((raw: string) => {
    const url = new URL(raw);
    httpCalls.push({ raw, url });
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

/** 本地文件：Bad Girl，演唱者 tag 写成「吴亦凡/Kris」。 */
const localTrack = (extra: Partial<MusicInfo> = {}): MusicInfo => ({
  id: 'local:bad-girl',
  source: 'local',
  name: 'Bad Girl',
  singer: '吴亦凡/Kris',
  albumName: '',
  ...extra,
});

/** 网易 s=Bad Girl 吴亦凡 的真实召回：8 条里没有一条是吴亦凡，全是同名不同曲/别人的翻唱。 */
const WY_BAD_GIRL_CANDIDATES = [
  { id: 301, name: 'Bad Girl', artists: [{ name: 'Avril Lavigne' }], album: { name: 'Bad Girl' }, duration: 175000 },
  { id: 302, name: 'Bad Girl', artists: [{ name: 'HENRY刘宪华' }], album: { name: 'Bad Girl' }, duration: 194000 },
  { id: 303, name: 'Bad Girl', artists: [{ name: '湘伦' }], album: { name: 'Bad Girl' }, duration: 136000 },
  { id: 304, name: 'Bad Girl', artists: [{ name: 'Lil Games' }], album: { name: 'Bad Girl' }, duration: 156000 },
];

const wySearch = (songs: unknown[]) => ({ result: { songs } });

beforeEach(() => {
  vi.resetAllMocks();
  httpCalls.length = 0;
  deps.getSource.mockReturnValue(null);
  deps.getCachedLyrics.mockResolvedValue(null);
  deps.saveCachedLyrics.mockResolvedValue(undefined);
});

describe('LRC Lib 两轮直查', () => {
  it('第一轮只送主歌手且不带 duration，命中整串歌手 404 的原唱同步词', async () => {
    const track = localTrack({ interval: 201.5 });
    mockHttp((url) => {
      expect(url.hostname).toBe('lrclib.net');
      // 整串歌手（吴亦凡/Kris）与带 duration 的查询都查不到，只有主歌手不带时长能命中
      if (url.searchParams.get('artist_name') !== '吴亦凡' || url.searchParams.has('duration')) {
        return { status: 404 };
      }
      return {
        status: 200,
        data: {
          id: 1234,
          trackName: 'Bad Girl',
          artistName: '吴亦凡',
          duration: 201.5624939,
          syncedLyrics: '[00:01.000]原唱同步词\n[00:02.000]原唱第二行',
        },
      };
    });

    const result = await searchAndMatchLyrics(track);

    expect(lrclibCalls()).toHaveLength(1);
    expect(lrclibCalls()[0].url.searchParams.get('artist_name')).toBe('吴亦凡');
    expect(lrclibCalls()[0].url.searchParams.has('duration')).toBe(false);
    expect(result.lines.map((line) => line.text)).toEqual(['原唱同步词', '原唱第二行']);
    expect(wySearchCalls()).toHaveLength(0);
  });

  it('两轮都没命中才走网易搜索，第二轮带完整歌手与本地时长', async () => {
    const track = localTrack({ interval: 214.4 });
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 404 };
      if (url.pathname === '/api/search/get/web') {
        expect(url.searchParams.get('s')).toBe('Bad Girl 吴亦凡/Kris');
        return { status: 200, data: wySearch([]) };
      }
      throw new Error(`不应请求 ${url.href}`);
    });

    const result = await searchAndMatchLyrics(track);

    const requests = lrclibCalls().map((call) => ({
      artist: call.url.searchParams.get('artist_name'),
      duration: call.url.searchParams.get('duration'),
    }));
    expect(requests).toEqual([
      { artist: '吴亦凡', duration: null },
      { artist: '吴亦凡/Kris', duration: '214' },
    ]);
    expect(wySearchCalls()).toHaveLength(1);
    expect(result).toEqual({ lines: [], error: '未找到匹配歌曲' });
  });

  it('第一轮命中纯音乐即短路，不再试第二轮与网易搜索', async () => {
    const track = localTrack({ interval: 201.5 });
    mockHttp((url) => {
      expect(url.hostname).toBe('lrclib.net');
      return { status: 200, data: { instrumental: true, duration: 201.5624939 } };
    });

    const result = await searchAndMatchLyrics(track);

    expect(lrclibCalls()).toHaveLength(1);
    expect(result).toEqual({ lines: [], error: '暂无歌词' });
  });

  it('回包署名与曲名都是我们要的那首时，时长差超 5 秒也采用', async () => {
    // 本地 tag 写 214s、条目是 201.56s，但署名与曲名都对得上：那是同一位演唱者的另一个版本
    // （或 tag 里的时长本身就是错的），歌词还是同一首歌的，不该因为时长差把能用的词丢掉。
    const track = localTrack({ interval: 214 });
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') {
        return {
          status: 200,
          data: {
            trackName: 'Bad Girl',
            artistName: '吴亦凡',
            duration: 201.5624939,
            syncedLyrics: '[00:01.000]原唱的词',
          },
        };
      }
      throw new Error(`不应请求 ${url.href}`);
    });

    const result = await searchAndMatchLyrics(track);

    expect(lrclibCalls()).toHaveLength(1);
    expect(result.lines.map((line) => line.text)).toEqual(['原唱的词']);
  });

  it('回包是别人的录音（署名对不上）且时长差超 5 秒时视为未命中', async () => {
    // 接口在没有 duration 时会返回「最近似」条目，这种回包必须用时长窗挡住。
    const track = localTrack({ interval: 214 });
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') {
        if (!url.searchParams.has('duration')) {
          return {
            status: 200,
            data: {
              trackName: 'Bad Girl',
              artistName: '别人的乐队',
              duration: 201.5624939,
              syncedLyrics: '[00:01.000]别人的词',
            },
          };
        }
        return { status: 404 };
      }
      if (url.pathname === '/api/search/get/web') return { status: 200, data: wySearch([]) };
      throw new Error(`不应请求 ${url.href}`);
    });

    const result = await searchAndMatchLyrics(track);

    expect(lrclibCalls()).toHaveLength(2);
    expect(result.lines).toEqual([]);
    expect(result.error).toBe('未找到匹配歌曲');
  });

  it('Parse 不到行的条目按未命中继续下一轮', async () => {
    const track = localTrack({ interval: 201.5 });
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') {
        return url.searchParams.has('duration')
          ? { status: 200, data: { duration: 201.5, plainLyrics: '[00:01.000]第二轮命中' } }
          : { status: 200, data: { duration: 201.5624939, syncedLyrics: '既不是 LRC 也不是任何已知格式' } };
      }
      throw new Error(`不应请求 ${url.href}`);
    });

    const result = await searchAndMatchLyrics(track);

    expect(result.lines.map((line) => line.text)).toEqual(['第二轮命中']);
  });
});

describe('网易搜索候选判定', () => {
  it('同名不同演唱者的候选一律不套用', async () => {
    const track = localTrack({ interval: 214 });
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 404 };
      if (url.pathname === '/api/search/get/web') return { status: 200, data: wySearch(WY_BAD_GIRL_CANDIDATES) };
      throw new Error(`不应请求 ${url.href}`);
    });

    const result = await searchAndMatchLyrics(track);

    expect(result).toEqual({ lines: [], error: '未找到匹配歌曲' });
    // 关键：连歌词接口都不该碰，更不能把 Avril/湘伦 的词返回
    expect(wyLyricCalls()).toHaveLength(0);
  });

  it('候选都拉不到词时显式失败，不再回退第一名候选', async () => {
    const track = { ...localTrack({ interval: 200 }), name: '日', singer: '吴亦凡', albumName: '专辑' };
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 404 };
      if (url.pathname === '/api/search/get/web') {
        return {
          status: 200,
          data: wySearch([
            { id: 7001, name: '日', artists: [{ name: '吴亦凡' }], album: { name: '专辑' }, duration: 200000 },
          ]),
        };
      }
      if (url.pathname === '/api/song/lyric') {
        expect(url.searchParams.get('id')).toBe('7001');
        return { status: 200, data: { lrc: { lyric: '' } } };
      }
      throw new Error(`不应请求 ${url.href}`);
    });

    const result = await searchAndMatchLyrics(track);

    expect(wyLyricCalls()).toHaveLength(1);
    expect(result).toEqual({ lines: [], error: '暂无歌词' });
    expect(result.origin).toBeUndefined();
  });

  it('原唱缺席但存在时长几乎一致的翻唱 → 采用其歌词并标注来源', async () => {
    // 本地 201.56s vs 候选 201.6s：翻唱几乎同速，这一条才是「同曲」的硬证据
    const track = localTrack({ interval: 201.56 });
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 404 };
      if (url.pathname === '/api/search/get/web') {
        return {
          status: 200,
          data: wySearch([
            { id: 9001, name: 'Bad Girl', artists: [{ name: '湘伦' }], album: { name: 'Bad Girl' }, duration: 201600 },
            ...WY_BAD_GIRL_CANDIDATES,
          ]),
        };
      }
      if (url.pathname === '/api/song/lyric') {
        expect(url.searchParams.get('id')).toBe('9001');
        return { status: 200, data: { lrc: { lyric: '[00:01.000]翻唱词\n[00:02.000]翻唱第二行' } } };
      }
      throw new Error(`不应请求 ${url.href}`);
    });

    const result = await searchAndMatchLyrics(track);

    expect(result.lines.map((line) => line.text)).toEqual(['翻唱词', '翻唱第二行']);
    expect(result.origin).toEqual({ tier: 'other-performer', performer: '湘伦', source: 'wy' });
  });

  it('召回里出现同演唱者候选时不得走同曲异唱档', async () => {
    const track = localTrack({ interval: 201.56 });
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 404 };
      if (url.pathname === '/api/search/get/web') {
        return {
          status: 200,
          data: wySearch([
            { id: 9001, name: 'Bad Girl', artists: [{ name: '湘伦' }], album: { name: 'Bad Girl' }, duration: 201600 },
            // 「吴亦凡」在召回里，即便时长完全不对，也说明原唱并非不可得，异唱档必须关闭
            { id: 9010, name: 'Bad Girl', artists: [{ name: '吴亦凡' }], album: { name: 'Bad Girl' }, duration: 260000 },
          ]),
        };
      }
      throw new Error(`不应请求 ${url.href}`);
    });

    const result = await searchAndMatchLyrics(track);

    expect(result).toEqual({ lines: [], error: '未找到匹配歌曲' });
    expect(wyLyricCalls()).toHaveLength(0);
  });

  it('同一录音组内只按歌词内容质量择优，匹配分不再参与', async () => {
    const track = { ...localTrack({ interval: 200 }), name: '日', singer: '吴亦凡', albumName: '专辑' };
    const longLyrics = '[00:01.000]一\n[00:05.000]二\n[00:09.000]三\n[00:13.000]四\n[00:17.000]五\n'
      + '[00:21.000]六\n[00:25.000]七\n[00:29.000]八\n[00:33.000]九\n[00:37.000]十';
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 404 };
      if (url.pathname === '/api/search/get/web') {
        return {
          status: 200,
          data: wySearch([
            { id: 8001, name: '日', artists: [{ name: '吴亦凡' }], album: { name: '专辑' }, duration: 200000 },
            { id: 8002, name: '日', artists: [{ name: '吴亦凡' }], album: { name: '专辑' }, duration: 200500 },
          ]),
        };
      }
      if (url.pathname === '/api/song/lyric') {
        const id = url.searchParams.get('id');
        return { status: 200, data: { lrc: { lyric: id === '8002' ? longLyrics : '[00:01.000]短\n[00:02.000]残缺' } } };
      }
      throw new Error(`不应请求 ${url.href}`);
    });

    const result = await searchAndMatchLyrics(track);

    expect(wyLyricCalls().map((call) => call.url.searchParams.get('id'))).toEqual(['8001', '8002']);
    expect(result.lines.map((line) => line.text)).toEqual(['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']);
    expect(result.origin).toEqual({ tier: 'same-recording', source: 'wy' });
  });
});
