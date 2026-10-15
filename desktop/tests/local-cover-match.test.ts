import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

/**
 * 本地曲封面自动匹配：磁盘缓存 →（缺 id 时才搜平台）→ 官方 song/detail（主）→ 网关 pic（兜底）
 * → 落盘并回填地址。
 *
 * 桩只替换 IO（官方 detail、网关、搜索、缓存读写、convertFileSrc）；URL 拼接、缓存 key、
 * 协议校验、优先级与负缓存判定都是被测代码自己算的。每个用例用不同的曲目 id：负缓存与并发去重
 * 都是模块级状态，跨用例复用同一 id 会互相污染。
 */
const deps = vi.hoisted(() => ({
  fetch: vi.fn(),
  cacheRemoteImage: vi.fn(),
  lookupCachedMedia: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: deps.fetch }));
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

import {
  fetchGatewayCoverUrl,
  matchLocalCover,
  type LocalCoverMatchDeps,
} from '../src/services/localCoverMatch';
import { cacheCoverForMusic } from '../src/services/mediaCache';

/** 实测形态：官方 song/detail 的 album.picUrl（id 2034742057，取图 200）。 */
const OFFICIAL_COVER_URL = 'https://p1.music.126.net/mLJ_pKshFVtboLyD-4nBdA==/109951168573694568.jpg';
/** 实测形态：网关 pic 返回过一次的「假地址」（图床 404 NoSuchKey），只用于验证兜底链路的搬运。 */
const GATEWAY_COVER_URL = 'https://p2.music.126.net/LUrBUIFSa0U3qyKw42Ex-w==/3446942914.jpg?param=500y500';
const LOCAL_COVER_PATH = 'C:/cache/local-local-bad-girl-cover.jpg';

/** 官方 detail 回包形态（picUrl 缺省表示这一条没有封面）。 */
const officialDetail = (picUrl?: string) => ({ songs: [{ album: picUrl ? { picUrl } : {} }] });

/** 扫描入库的本地曲：只有 source/isLocal 与本地地址，没有封面。 */
const localSong = (extra: Partial<MusicInfo> = {}): MusicInfo => ({
  id: 'local:bad-girl',
  source: 'local',
  isLocal: true,
  name: 'Bad Girl',
  singer: '吴亦凡',
  url: 'asset://F:/music/bad-girl.flac',
  ...extra,
} as MusicInfo);

/** 被采用的候选（匹配结果只需要 id 与 tier 会被封面路径读取）。 */
const matched = (id: string) => ({
  match: { status: 'matched' as const, tier: 'same-recording' as const, candidates: [{ id }] as MusicInfo[], issues: [] },
  candidates: [{ id }] as MusicInfo[],
});

/**
 * 注入桩：默认「缓存未命中 + 官方没给地址 + 网关命中 + 落盘成功」——
 * 官方没给地址是有意为之，好让兜底链路的用例继续被测到。
 */
function stubDeps(overrides: Partial<LocalCoverMatchDeps> = {}): LocalCoverMatchDeps {
  return {
    lookupCoverPath: vi.fn(async () => null),
    searchMatch: vi.fn(async () => ({ match: null, candidates: [] })),
    fetchJson: vi.fn(async () => officialDetail()),
    fetchText: vi.fn(async () => JSON.stringify({ url: GATEWAY_COVER_URL })),
    cacheCover: vi.fn(async () => `asset://${LOCAL_COVER_PATH}`),
    ...overrides,
  };
}

const fetchCalls = () => deps.fetch.mock.calls.map(([url]) => String(url));
const gatewayCalls = () => fetchCalls().map((url) => new URL(url)).filter((url) => url.hostname === 'music-api.gdstudio.xyz');
const officialUrl = (id: string) => `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify([id]))}`;

beforeEach(() => {
  vi.resetAllMocks();
  deps.lookupCachedMedia.mockResolvedValue(null);
  deps.cacheRemoteImage.mockResolvedValue(LOCAL_COVER_PATH);
  // 默认 HTTP 桩同时支持两条链路：官方走 .json()，网关走 .text()
  deps.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ url: GATEWAY_COVER_URL }),
    json: async () => officialDetail(OFFICIAL_COVER_URL),
  });
});

describe('官方 song/detail 封面地址（主路径）', () => {
  it('请求 music.163.com/api/song/detail?ids=[<id>]，用 album.picUrl 按 600 档落到该曲缓存键', async () => {
    const music = localSong({ id: 'local:official' });

    await expect(matchLocalCover(music, '123456')).resolves.toBe(`asset://${LOCAL_COVER_PATH}`);

    // URL 与实测口径逐字一致；官方命中就不该再碰网关
    expect(fetchCalls()).toEqual([officialUrl('123456')]);
    expect(gatewayCalls()).toHaveLength(0);
    expect(deps.lookupCachedMedia).toHaveBeenCalledWith('cover', 'local-local-official-cover');
    expect(deps.cacheRemoteImage).toHaveBeenCalledWith({
      url: `${OFFICIAL_COVER_URL}?param=600y600`,
      cacheKey: 'local-local-official-cover',
    });
  });

  it('官方地址已带 ?param=500y500 → 改写成 600y600，不叠加', async () => {
    const fetchJson = vi.fn(async () => officialDetail(`${OFFICIAL_COVER_URL}?param=500y500`));

    await expect(matchLocalCover(localSong({ id: 'local:official-param' }), '1', { fetchJson })).resolves.toBe(
      `asset://${LOCAL_COVER_PATH}`,
    );

    const cached = deps.cacheRemoteImage.mock.calls[0][0];
    expect(cached.url).toBe(`${OFFICIAL_COVER_URL}?param=600y600`);
    expect(cached.url.match(/param=/g)).toHaveLength(1);
    expect(cached.cacheKey).toBe('local-local-official-param-cover');
  });

  it('官方给 http:// → 下载地址升级成 https://', async () => {
    const fetchJson = vi.fn(async () => officialDetail('http://p1.music.126.net/abc==/1.jpg'));

    await expect(matchLocalCover(localSong({ id: 'local:official-http' }), '1', { fetchJson })).resolves.toBe(
      `asset://${LOCAL_COVER_PATH}`,
    );

    expect(deps.cacheRemoteImage).toHaveBeenCalledWith({
      url: 'https://p1.music.126.net/abc==/1.jpg?param=600y600',
      cacheKey: 'local-local-official-http-cover',
    });
  });

  it('老接口字段 songs[0].al.picUrl 同样接受', async () => {
    const fetchJson = vi.fn(async () => ({ songs: [{ al: { picUrl: OFFICIAL_COVER_URL } }] }));

    await expect(matchLocalCover(localSong({ id: 'local:official-al' }), '1', { fetchJson })).resolves.toBe(
      `asset://${LOCAL_COVER_PATH}`,
    );

    expect(deps.cacheRemoteImage.mock.calls[0][0].cacheKey).toBe('local-local-official-al-cover');
  });

  it.each([
    ['没有 album', officialDetail()],
    ['album 里没有 picUrl', { songs: [{ album: { name: '专辑' } }] }],
    ['songs 为空', { songs: [] }],
    ['回包为空对象', {}],
    ['picUrl 不是字符串', { songs: [{ album: { picUrl: 12345 } }] }],
  ])('官方响应没有可用地址（%s）→ 回退网关，网关成功则落盘', async (_name, detail) => {
    const fetchJson = vi.fn(async () => detail);
    const stub = stubDeps({ fetchJson });
    const music = localSong({ id: `local:official-empty-${_name}` });

    await expect(matchLocalCover(music, '1', stub)).resolves.toBe(`asset://${LOCAL_COVER_PATH}`);

    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(stub.fetchText).toHaveBeenCalledTimes(1);
    expect(stub.cacheCover).toHaveBeenCalledWith(music, GATEWAY_COVER_URL);
  });

  it('官方接口抛错 → 仍走网关兜底，异常不抛给调用方', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('HTTP 500'));
    const stub = stubDeps({ fetchJson });

    await expect(matchLocalCover(localSong({ id: 'local:official-throw' }), '1', stub)).resolves.toBe(
      `asset://${LOCAL_COVER_PATH}`,
    );
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(stub.fetchText).toHaveBeenCalledTimes(1);
  });

  it('官方与网关都失败 → null、不落盘、不记负缓存（第二次仍会重试）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const searchMatch = vi.fn(async () => matched('555'));
    const fetchJson = vi.fn(async () => officialDetail());
    const fetchText = vi.fn(async () => JSON.stringify({ code: 200 }));
    const cacheCover = vi.fn(async () => `asset://${LOCAL_COVER_PATH}`);
    const stub = stubDeps({ searchMatch, fetchJson, fetchText, cacheCover });
    const music = localSong({ id: 'local:both-failed' });

    await expect(matchLocalCover(music, undefined, stub)).resolves.toBeNull();
    await expect(matchLocalCover(music, undefined, stub)).resolves.toBeNull();

    // 没有记负缓存：搜索与两个地址来源都会重试
    expect(searchMatch).toHaveBeenCalledTimes(2);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchText).toHaveBeenCalledTimes(2);
    expect(cacheCover).not.toHaveBeenCalled();
    expect(warn.mock.calls.some(([message]) => String(message).includes('[local-cover] 未取到封面地址'))).toBe(true);
    warn.mockRestore();
  });
});

describe('【兜底】网关封面地址', () => {
  it('默认走内置网关客户端：types=pic&source=netease&id=<歌曲id>&size=500，取顶层 url', async () => {
    await expect(fetchGatewayCoverUrl('123456')).resolves.toBe(GATEWAY_COVER_URL);

    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [call] = gatewayCalls();
    expect(call.searchParams.get('types')).toBe('pic');
    expect(call.searchParams.get('source')).toBe('netease');
    expect(call.searchParams.get('id')).toBe('123456');
    expect(call.searchParams.get('size')).toBe('500');
  });

  it('空 id 不发请求', async () => {
    await expect(fetchGatewayCoverUrl('   ')).resolves.toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['url 为空', '{"url":""}'],
    ['没有 url 字段', '{"code":200}'],
    ['非 http 协议', '{"url":"ftp://cdn.local/cover.jpg"}'],
    ['非 JSON', '<html>rate limited</html>'],
    ['JSON 但不是对象', 'null'],
  ])('响应不合法（%s）→ null，不抛错', async (_name, payload) => {
    deps.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => payload });
    await expect(fetchGatewayCoverUrl('1')).resolves.toBeNull();
  });

  it.each([
    ['HTTP 500', { ok: false, status: 500, text: async () => 'gateway error' }],
    ['网络异常', new Error('network down')],
  ])('%s → null，不抛错', async (_name, result) => {
    if (result instanceof Error) deps.fetch.mockRejectedValue(result);
    else deps.fetch.mockResolvedValue(result);
    await expect(fetchGatewayCoverUrl('1')).resolves.toBeNull();
  });
});

describe('匹配编排', () => {
  it('缓存命中：直接返回 asset 地址，不搜索、不请求地址', async () => {
    const stub = stubDeps({ lookupCoverPath: vi.fn(async () => LOCAL_COVER_PATH) });

    await expect(matchLocalCover(localSong({ id: 'local:hit' }), undefined, stub)).resolves.toBe(
      `asset://${LOCAL_COVER_PATH}`,
    );
    expect(stub.searchMatch).not.toHaveBeenCalled();
    expect(stub.fetchJson).not.toHaveBeenCalled();
    expect(stub.fetchText).not.toHaveBeenCalled();
    expect(stub.cacheCover).not.toHaveBeenCalled();
  });

  it('已有候选 id：不搜索，官方没给地址时用网关兜底', async () => {
    const stub = stubDeps();

    await expect(matchLocalCover(localSong({ id: 'local:known-id' }), '999', stub)).resolves.toBe(
      `asset://${LOCAL_COVER_PATH}`,
    );
    expect(stub.searchMatch).not.toHaveBeenCalled();
    // 官方先问一次（用同一个 id），它没给地址才轮到网关
    expect((stub.fetchJson as any).mock.calls[0][0]).toBe(officialUrl('999'));
    expect(stub.fetchText).toHaveBeenCalledTimes(1);
    expect(new URL((stub.fetchText as any).mock.calls[0][0]).searchParams.get('id')).toBe('999');
  });

  it('缺候选 id：先搜平台，再用被采用候选的 id 换封面', async () => {
    const stub = stubDeps({ searchMatch: vi.fn(async () => matched('555')) });

    await expect(matchLocalCover(localSong({ id: 'local:search' }), undefined, stub)).resolves.toBe(
      `asset://${LOCAL_COVER_PATH}`,
    );
    expect(stub.searchMatch).toHaveBeenCalledTimes(1);
    expect((stub.fetchJson as any).mock.calls[0][0]).toBe(officialUrl('555'));
    expect(new URL((stub.fetchText as any).mock.calls[0][0]).searchParams.get('id')).toBe('555');
  });

  it('搜到过但没有任何可用候选：记负缓存，第二次不再搜索', async () => {
    const stub = stubDeps({ searchMatch: vi.fn(async () => ({ match: null, candidates: [] })) });
    const music = localSong({ id: 'local:no-candidate' });

    await expect(matchLocalCover(music, undefined, stub)).resolves.toBeNull();
    await expect(matchLocalCover(music, undefined, stub)).resolves.toBeNull();

    expect(stub.searchMatch).toHaveBeenCalledTimes(1);
    expect(stub.fetchJson).not.toHaveBeenCalled();
    expect(stub.fetchText).not.toHaveBeenCalled();
  });

  it('搜索抛错不记负缓存：第二次仍会重新搜索', async () => {
    const searchMatch = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(matched('777'));
    const stub = stubDeps({ searchMatch });
    const music = localSong({ id: 'local:search-failed' });

    await expect(matchLocalCover(music, undefined, stub)).resolves.toBeNull();
    await expect(matchLocalCover(music, undefined, stub)).resolves.toBe(`asset://${LOCAL_COVER_PATH}`);

    expect(searchMatch).toHaveBeenCalledTimes(2);
  });

  it('网关兜底失败不记负缓存：第二次仍会用同一个候选重试', async () => {
    const fetchText = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce(JSON.stringify({ url: GATEWAY_COVER_URL }));
    const stub = stubDeps({ searchMatch: vi.fn(async () => matched('777')), fetchText });
    const music = localSong({ id: 'local:gateway-failed' });

    await expect(matchLocalCover(music, undefined, stub)).resolves.toBeNull();
    await expect(matchLocalCover(music, undefined, stub)).resolves.toBe(`asset://${LOCAL_COVER_PATH}`);

    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it('同一首并发触发只跑一次：搜索与落盘各一次', async () => {
    let releaseSearch!: () => void;
    const gate = new Promise<void>((done) => { releaseSearch = done; });
    const searchMatch = vi.fn(async () => {
      await gate;
      return matched('555');
    });
    // cacheCover 不注入：走真实 cacheCoverForMusic，落盘只应发生一次
    const stub = stubDeps({ searchMatch, cacheCover: undefined });
    const music = localSong({ id: 'local:concurrent' });

    const first = matchLocalCover(music, undefined, stub);
    const second = matchLocalCover(music, undefined, stub);
    releaseSearch();
    const results = await Promise.all([first, second]);

    // 落盘路径由 @lx/tauri-bridge 返回；两次调用必须拿到同一个地址（同一份落盘文件）
    expect(results).toEqual([`asset://${LOCAL_COVER_PATH}`, `asset://${LOCAL_COVER_PATH}`]);
    expect(searchMatch).toHaveBeenCalledTimes(1);
    expect(deps.cacheRemoteImage).toHaveBeenCalledTimes(1);
    // 落盘用的是该曲的封面缓存键（buildMediaCacheKey(song, 'cover')）
    expect(deps.cacheRemoteImage.mock.calls[0][0].cacheKey).toBe('local-local-concurrent-cover');
  });

  it.each([
    ['空 url', async () => '{"url":""}'],
    ['非 http 协议', async () => '{"url":"ftp://cdn.local/cover.jpg"}'],
    ['非 JSON 响应', async () => 'not json'],
  ])('官方没给地址且网关响应不可用（%s）→ null 且不落盘', async (_name, fetchText) => {
    const cacheCover = vi.fn(async () => `asset://${LOCAL_COVER_PATH}`);
    const stub = stubDeps({ fetchText, cacheCover });

    await expect(matchLocalCover(localSong({ id: `local:bad-${_name}` }), '1', stub)).resolves.toBeNull();
    expect(cacheCover).not.toHaveBeenCalled();
  });

  it('落盘失败（cacheCover 给 null / 抛错）→ null', async () => {
    const music = localSong({ id: 'local:write-failed' });
    await expect(matchLocalCover(music, '1', stubDeps({ cacheCover: async () => null }))).resolves.toBeNull();
    await expect(
      matchLocalCover(localSong({ id: 'local:write-throw' }), '1', stubDeps({
        cacheCover: async () => { throw new Error('disk full'); },
      })),
    ).resolves.toBeNull();
  });

  it.each([
    ['曲库带封面', localSong({ id: 'local:has-pic', picUrl: 'asset://F:/music/cover.jpg' })],
    ['曲目上有 img', localSong({ id: 'local:has-img', img: 'asset://F:/music/cover.jpg' })],
    ['手动 coverOverride（已写进 picUrl）', localSong({ id: 'local:manual', picUrl: 'asset://F:/manual/cover.jpg', img: 'asset://F:/manual/cover.jpg' })],
    ['在线曲目', { id: '1', source: 'wy', name: 'x', singer: 'y' } as MusicInfo],
  ])('已有封面或非本地曲（%s）→ 一个请求都不发', async (_name, music) => {
    const stub = stubDeps();
    await expect(matchLocalCover(music, undefined, stub)).resolves.toBeNull();
    expect(stub.lookupCoverPath).not.toHaveBeenCalled();
    expect(stub.searchMatch).not.toHaveBeenCalled();
    // 官方 detail 与网关都在「已有封面」之后，一次都不该请求
    expect(stub.fetchJson).not.toHaveBeenCalled();
    expect(stub.fetchText).not.toHaveBeenCalled();
    expect(stub.cacheCover).not.toHaveBeenCalled();
  });
});

describe('默认链路（真实 cacheCoverForMusic）', () => {
  it('缓存未命中 → 官方地址落盘并返回 convertFileSrc(落盘路径)，key 为该曲的封面缓存键', async () => {
    const music = localSong({ id: 'local:default-miss' });

    await expect(matchLocalCover(music, '123456')).resolves.toBe(`asset://${LOCAL_COVER_PATH}`);
    expect(fetchCalls()).toEqual([officialUrl('123456')]);
    expect(deps.lookupCachedMedia).toHaveBeenCalledWith('cover', 'local-local-default-miss-cover');
    expect(deps.cacheRemoteImage).toHaveBeenCalledWith({
      // 官方原图地址被改写成缓存统一使用的 600 档
      url: `${OFFICIAL_COVER_URL}?param=600y600`,
      cacheKey: 'local-local-default-miss-cover',
    });
  });

  it('缓存已落盘 → 直接返回现成地址，不再请求，也不再下载', async () => {
    deps.lookupCachedMedia.mockResolvedValue({ path: LOCAL_COVER_PATH, bytes: 2048 });

    await expect(matchLocalCover(localSong({ id: 'local:default-hit' }), '123456')).resolves.toBe(
      `asset://${LOCAL_COVER_PATH}`,
    );
    expect(fetchCalls()).toHaveLength(0);
    expect(deps.cacheRemoteImage).not.toHaveBeenCalled();
  });
});

describe('封面落盘（cacheCoverForMusic）', () => {
  it('已落过盘就不再下载一次，并返回现成的 asset 地址', async () => {
    deps.lookupCachedMedia.mockResolvedValue({ path: LOCAL_COVER_PATH, bytes: 2048 });

    await expect(cacheCoverForMusic(localSong(), OFFICIAL_COVER_URL)).resolves.toBe(`asset://${LOCAL_COVER_PATH}`);
    expect(deps.lookupCachedMedia).toHaveBeenCalledWith('cover', 'local-local-bad-girl-cover');
    expect(deps.cacheRemoteImage).not.toHaveBeenCalled();
  });

  it('未落盘 → 下载后返回 convertFileSrc(落盘路径)', async () => {
    await expect(cacheCoverForMusic(localSong(), OFFICIAL_COVER_URL)).resolves.toBe(`asset://${LOCAL_COVER_PATH}`);
    expect(deps.cacheRemoteImage).toHaveBeenCalledTimes(1);
  });

  it.each(['asset://F:/music/cover.jpg', 'data:image/png;base64,AAAA', ''])(
    '非 http(s) 地址（%s）直接忽略',
    async (coverUrl) => {
      await expect(cacheCoverForMusic(localSong(), coverUrl)).resolves.toBeNull();
      expect(deps.lookupCachedMedia).not.toHaveBeenCalled();
      expect(deps.cacheRemoteImage).not.toHaveBeenCalled();
    },
  );

  it('落盘抛错 → null，不向外抛', async () => {
    deps.cacheRemoteImage.mockRejectedValue(new Error('disk full'));
    await expect(cacheCoverForMusic(localSong(), OFFICIAL_COVER_URL)).resolves.toBeNull();
  });
});
