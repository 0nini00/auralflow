import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

/**
 * 歌词匹配成功时的封面补全：用被采用的网易候选 id 问官方 song/detail（主，网关 pic 兜底），
 * 把地址落到该本地曲的缓存键；整条链路完全旁路 —— 封面挂起/失败都不能改变歌词结果
 * （不改返回值、更不许 await）。
 */
const deps = vi.hoisted(() => ({
  getSource: vi.fn(),
  getCachedLyrics: vi.fn(),
  saveCachedLyrics: vi.fn(),
  fetch: vi.fn(),
  cacheRemoteImage: vi.fn(),
  lookupCachedMedia: vi.fn(),
}));
vi.mock('@/services/sources/sourceService', () => ({ getSource: deps.getSource }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: deps.fetch }));
vi.mock('@/services/persistentCache', () => ({
  getCachedLyrics: deps.getCachedLyrics,
  saveCachedLyrics: deps.saveCachedLyrics,
  isCacheableEmptyLyricResult: () => false,
}));
vi.mock('@lx/tauri-bridge', () => ({
  cacheRemoteImage: deps.cacheRemoteImage,
  cacheRemoteAudio: vi.fn(),
  lookupCachedMedia: deps.lookupCachedMedia,
  removeCachedMedia: vi.fn(),
  // 这些持久化入口必须一起桩住：mediaCache → persistentCache → customSourceStore 会在导入时挂载它
  libraryLoad: vi.fn().mockResolvedValue(null),
  librarySave: vi.fn().mockResolvedValue(undefined),
  debugLog: vi.fn(),
  patchSettings: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

import { __lyricsInternals } from '../src/services/lyricsService';

const { searchAndMatchLyrics } = __lyricsInternals;

/** 实测形态：官方 song/detail 的 album.picUrl（主路径）。 */
const OFFICIAL_COVER_URL = 'https://p1.music.126.net/mLJ_pKshFVtboLyD-4nBdA==/109951168573694568.jpg';
/** 实测形态：网关 pic 返回过一次的假地址（图床 404），只用于验证兜底链路。 */
const GATEWAY_COVER_URL = 'https://p2.music.126.net/LUrBUIFSa0U3qyKw42Ex-w==/3446942914.jpg?param=500y500';

type Route = (url: URL) => { status: number; data?: unknown } | 'hang';

const httpCalls: URL[] = [];

function mockHttp(route: Route) {
  deps.fetch.mockImplementation((raw: string) => {
    const url = new URL(raw);
    httpCalls.push(url);
    const result = route(url);
    // 'hang'：永不返回，用来证明调用方没有 await 封面请求
    if (result === 'hang') return new Promise(() => {});
    return Promise.resolve({
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      text: async () => (typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? {})),
      json: async () => result.data ?? {},
    });
  });
}

const detailCalls = () => httpCalls.filter((url) => url.pathname === '/api/song/detail');
/** 官方 detail 的 ids 参数（实测口径 `ids=["<id>"]`）。 */
const detailIds = () => detailCalls()[0]?.searchParams.get('ids');
const gatewayCalls = () => httpCalls.filter((url) => url.hostname === 'music-api.gdstudio.xyz');
const flushTasks = () => new Promise((done) => setTimeout(done, 10));

/** 本地曲：曲名/歌手/专辑与候选一致，时长一致 → same-recording 档。 */
const localTrack = (extra: Partial<MusicInfo> = {}): MusicInfo => ({
  id: 'local:ri',
  source: 'local',
  name: '日',
  singer: '吴亦凡',
  albumName: '专辑',
  interval: 200,
  ...extra,
});

const lyricCandidate = (id: string, duration = 200_000) => ({
  id,
  name: '日',
  artists: [{ name: '吴亦凡' }],
  album: { name: '专辑' },
  duration,
});

/** 歌词 + 封面都齐的成功路径；封面路由由参数决定。 */
function routeLyricsWithCover(cover: 'hit' | 'gateway-fallback' | 'hang' | 'both-fail') {
  mockHttp((url) => {
    if (url.hostname === 'lrclib.net') return { status: 404 };
    if (url.pathname === '/api/search/get/web') {
      return { status: 200, data: { result: { songs: [lyricCandidate('8002')] } } };
    }
    if (url.pathname === '/api/song/lyric') {
      return { status: 200, data: { lrc: { lyric: '[00:01.000]一\n[00:02.000]二' } } };
    }
    // 官方 song/detail（主路径）
    if (url.pathname === '/api/song/detail') {
      if (cover === 'hit') {
        return { status: 200, data: { songs: [{ album: { picUrl: OFFICIAL_COVER_URL } }] } };
      }
      if (cover === 'hang') return 'hang';
      // gateway-fallback / both-fail：官方这一条没有可用封面
      return { status: 200, data: { songs: [{ album: {} }] } };
    }
    // 网关 pic（兜底）
    if (url.hostname === 'music-api.gdstudio.xyz') {
      if (cover === 'both-fail') return { status: 500, data: 'gateway error' };
      return { status: 200, data: { url: GATEWAY_COVER_URL } };
    }
    throw new Error(`不应请求 ${url.href}`);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  httpCalls.length = 0;
  deps.getSource.mockReturnValue(null);
  deps.getCachedLyrics.mockResolvedValue(null);
  deps.saveCachedLyrics.mockResolvedValue(undefined);
  deps.lookupCachedMedia.mockResolvedValue(null);
  deps.cacheRemoteImage.mockResolvedValue('cover-file');
});

describe('歌词匹配成功后的封面补全', () => {
  it('官方 detail 优先：ids=[<候选id>] 的 album.picUrl 落到该本地曲的封面缓存键', async () => {
    routeLyricsWithCover('hit');

    const result = await searchAndMatchLyrics(localTrack());

    expect(result.lines.map((line) => line.text)).toEqual(['一', '二']);
    expect(result.origin).toEqual({ tier: 'same-recording', source: 'wy' });

    await vi.waitFor(() => expect(deps.cacheRemoteImage).toHaveBeenCalledTimes(1));
    expect(detailIds()).toBe('["8002"]');
    expect(gatewayCalls()).toHaveLength(0);
    expect(deps.cacheRemoteImage).toHaveBeenCalledWith({
      url: `${OFFICIAL_COVER_URL}?param=600y600`,
      cacheKey: 'local-local-ri-cover',
    });
  });

  it('官方没给地址 → 网关兜底，仍然落到同一个缓存键', async () => {
    routeLyricsWithCover('gateway-fallback');

    const result = await searchAndMatchLyrics(localTrack());

    expect(result.lines.map((line) => line.text)).toEqual(['一', '二']);
    await vi.waitFor(() => expect(deps.cacheRemoteImage).toHaveBeenCalledTimes(1));
    expect(detailIds()).toBe('["8002"]');
    expect(gatewayCalls()).toHaveLength(1);
    expect(deps.cacheRemoteImage).toHaveBeenCalledWith({
      url: 'https://p2.music.126.net/LUrBUIFSa0U3qyKw42Ex-w==/3446942914.jpg?param=600y600',
      cacheKey: 'local-local-ri-cover',
    });
  });

  it('封面请求挂起也照样按时返回歌词（旁路，不 await 封面）', async () => {
    routeLyricsWithCover('hang');

    const result = await searchAndMatchLyrics(localTrack());

    expect(result.lines.map((line) => line.text)).toEqual(['一', '二']);
    expect(result.origin).toEqual({ tier: 'same-recording', source: 'wy' });
    expect(deps.cacheRemoteImage).not.toHaveBeenCalled();
  });

  it('官方与网关都取不到封面 → 不落盘，歌词结果与 origin 不变', async () => {
    routeLyricsWithCover('both-fail');

    const result = await searchAndMatchLyrics(localTrack());

    expect(result.lines.map((line) => line.text)).toEqual(['一', '二']);
    expect(result.origin).toEqual({ tier: 'same-recording', source: 'wy' });
    await flushTasks();
    expect(deps.cacheRemoteImage).not.toHaveBeenCalled();
  });

  it('已有封面的本地曲连两个封面接口都不发', async () => {
    routeLyricsWithCover('hit');

    const track = localTrack({ picUrl: 'asset://F:/music/cover.jpg', img: 'asset://F:/music/cover.jpg' });
    const result = await searchAndMatchLyrics(track);

    expect(result.lines).toHaveLength(2);
    await flushTasks();
    expect(detailCalls()).toHaveLength(0);
    expect(gatewayCalls()).toHaveLength(0);
    expect(deps.cacheRemoteImage).not.toHaveBeenCalled();
  });

  it('同曲异唱档同样用被采用候选的 id 取封面', async () => {
    mockHttp((url) => {
      if (url.hostname === 'lrclib.net') return { status: 404 };
      if (url.pathname === '/api/search/get/web') {
        return {
          status: 200,
          data: {
            result: {
              songs: [
                { id: 9001, name: 'Bad Girl', artists: [{ name: '湘伦' }], album: { name: 'Bad Girl' }, duration: 201_600 },
                { id: 901, name: 'Bad Girl', artists: [{ name: 'Avril Lavigne' }], album: { name: 'Bad Girl' }, duration: 175_000 },
              ],
            },
          },
        };
      }
      if (url.pathname === '/api/song/lyric') {
        return { status: 200, data: { lrc: { lyric: '[00:01.000]翻唱词' } } };
      }
      if (url.pathname === '/api/song/detail') {
        return { status: 200, data: { songs: [{ album: { picUrl: OFFICIAL_COVER_URL } }] } };
      }
      if (url.hostname === 'music-api.gdstudio.xyz') return { status: 200, data: { url: GATEWAY_COVER_URL } };
      throw new Error(`不应请求 ${url.href}`);
    });

    const track: MusicInfo = {
      id: 'local:bad-girl',
      source: 'local',
      name: 'Bad Girl',
      singer: '吴亦凡/Kris',
      albumName: '',
      interval: 201.56,
    };
    const result = await searchAndMatchLyrics(track);

    expect(result.origin).toEqual({ tier: 'other-performer', performer: '湘伦', source: 'wy' });
    await vi.waitFor(() => expect(deps.cacheRemoteImage).toHaveBeenCalledTimes(1));
    expect(detailIds()).toBe('["9001"]');
    expect(gatewayCalls()).toHaveLength(0);
    expect(deps.cacheRemoteImage.mock.calls[0][0].cacheKey).toBe('local-local-bad-girl-cover');
  });
});
