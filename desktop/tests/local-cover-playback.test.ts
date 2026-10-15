import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import type { LocalSong } from '../src/services/localMusicService';

/**
 * 本地曲播放时的封面补全（整链路：playerStore → localCoverMatch → 真实 mediaCache）。
 *
 * 只有网络与原生桥被替换：网易搜索走桩、官方 song/detail 走 HTTP 桩、网关文本走桩、
 * 磁盘缓存在 @lx/tauri-bridge 上桩。断言的是「这次播放能立刻看到封面」：缓存命中秒回填，
 * 未命中就搜一次、官方接口取地址、落盘后当次回填；手动封面优先、切歌不串图、挂起不阻塞起播。
 */
const fixture = vi.hoisted(() => ({
  state: { featureEnabled: false, featureReady: true, sources: [] as unknown[] },
  persistence: { ready: Promise.resolve() },
  localSongs: [] as unknown[],
  librarySubscribe: vi.fn(),
  engine: {
    play: vi.fn(), pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), setVolume: vi.fn(),
    getState: vi.fn(), subscribe: vi.fn(() => () => {}), onEnded: vi.fn(), onPreviewDetected: vi.fn(),
    updateCurrentMusic: vi.fn(),
  },
  lookupCachedMedia: vi.fn(),
  cacheRemoteImage: vi.fn(),
  resolvePlaybackUrl: vi.fn(),
  fetchText: vi.fn(),
  tauriFetch: vi.fn(),
  searchMatch: vi.fn(),
}));

vi.mock('../src/stores/customSourceStore', async () => {
  const { createCustomSourceAccess } = await import('../src/services/customSourceAccess');
  return {
    useCustomSourceStore: { getState: () => fixture.state },
    customSourcePersistence: fixture.persistence,
    customSourceAccess: createCustomSourceAccess(() => fixture.state.featureReady && fixture.state.featureEnabled),
  };
});
vi.mock('../src/services/playerEngine', () => ({ playerEngine: fixture.engine }));
vi.mock('../src/stores/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({ localSongs: fixture.localSongs }),
    subscribe: fixture.librarySubscribe,
  },
}));
// 磁盘缓存（真实 mediaCache 用它查盘/下载）与原生桥
vi.mock('@lx/tauri-bridge', () => ({
  lookupCachedMedia: fixture.lookupCachedMedia,
  cacheRemoteImage: fixture.cacheRemoteImage,
  cacheRemoteAudio: vi.fn(),
  removeCachedMedia: vi.fn(),
  libraryLoad: vi.fn().mockResolvedValue(null),
  librarySave: vi.fn().mockResolvedValue(undefined),
  debugLog: vi.fn(),
  patchSettings: vi.fn(),
}));
// 平台搜索走桩（判定结果由用例决定）；官方 song/detail 用 fetchNeteaseJson 的 HTTP 桩，网关文本单独桩
vi.mock('../src/services/localMediaMatch', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchNeteaseMatch: fixture.searchMatch,
}));
vi.mock('../src/services/builtinMusicApiClient', () => ({ fetchBuiltinMusicApiText: fixture.fetchText }));
vi.mock('../src/services/playback/playbackResolver', () => ({ resolvePlaybackUrl: fixture.resolvePlaybackUrl }));
vi.mock('../src/services/playback/prefetchService', () => ({
  getPrefetchedTrack: vi.fn(() => null),
  prefetchNearbyTracks: vi.fn(async () => {}),
  prefetchTracks: vi.fn(async () => {}),
  invalidatePrefetchedTrack: vi.fn(),
}));
vi.mock('../src/services/persistentCache', () => ({ invalidateCachedPlaybackUrl: vi.fn(async () => {}) }));
vi.mock('../src/services/playback/crossSourceFallbackService', () => ({
  findTxVariants: vi.fn(async () => []),
  describeCrossSourceFailure: () => '无候选',
}));
vi.mock('../src/stores/historyStore', () => ({ useHistoryStore: { getState: () => ({ add: vi.fn() }) } }));
vi.mock('../src/stores/sleepTimerStore', () => ({ useSleepTimerStore: { getState: () => ({ mode: 'off' }) } }));
vi.mock('../src/stores/discoveryStore', () => ({ useDiscoveryStore: { getState: () => ({ fmQueue: [], fmIndex: 0 }) } }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fixture.tauriFetch }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

/** 实测形态：官方 song/detail 的 album.picUrl（主路径）。 */
const OFFICIAL_COVER_URL = 'https://p1.music.126.net/mLJ_pKshFVtboLyD-4nBdA==/109951168573694568.jpg';
/** 实测形态：网关 pic 返回过一次的假地址（图床 404），只用于验证兜底链路。 */
const GATEWAY_COVER_URL = 'https://p2.music.126.net/LUrBUIFSa0U3qyKw42Ex-w==/3446942914.jpg?param=500y500';
const COVER_PATH = 'C:/cache/local-local-1-cover.jpg';
const COVER_URL = `asset://${COVER_PATH}`;
/** 该曲的封面缓存键：buildMediaCacheKey(song, 'cover')。 */
const COVER_KEY = 'local-local-1-cover';

const song: LocalSong = {
  id: 'local-1',
  path: 'F:\\music\\bad-girl.flac',
  title: 'Bad Girl',
  artist: '吴亦凡',
  album: '',
  duration: 201.5,
  format: 'flac',
  size: 1,
  isLocal: true,
  url: 'asset://F:/music/bad-girl.flac',
};

const track = (extra: Partial<MusicInfo> = {}): MusicInfo => ({
  id: song.id,
  name: song.title,
  singer: song.artist,
  albumName: song.album,
  source: 'local',
  isLocal: true,
  localPath: song.path,
  interval: song.duration,
  url: song.url,
  ...extra,
} as MusicInfo);

/** 平台搜索命中的被采用候选（真实判定逻辑不在本文件里测）。 */
const searchHit = () => ({
  match: { status: 'matched' as const, tier: 'same-recording' as const, candidates: [{ id: '555' }] as MusicInfo[], issues: [] },
  candidates: [{ id: '555' }] as MusicInfo[],
});

const flushTasks = () => new Promise((done) => setTimeout(done, 10));

async function loadStore() {
  const { usePlayerStore } = await import('../src/stores/playerStore');
  return usePlayerStore;
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  fixture.state.featureEnabled = false;
  fixture.state.featureReady = true;
  fixture.localSongs = [song];
  fixture.engine.play.mockResolvedValue(undefined);
  fixture.engine.getState.mockReturnValue({ currentMusic: null });
  fixture.engine.subscribe.mockReturnValue(() => {});
  fixture.lookupCachedMedia.mockResolvedValue(null);
  fixture.cacheRemoteImage.mockResolvedValue(COVER_PATH);
  // 官方 detail 的 HTTP 桩：默认给出可用地址（网关因此不该被调用）
  fixture.tauriFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ songs: [{ album: { picUrl: OFFICIAL_COVER_URL } }] }),
    text: async () => JSON.stringify({ url: GATEWAY_COVER_URL }),
  }));
  fixture.fetchText.mockResolvedValue(JSON.stringify({ url: GATEWAY_COVER_URL }));
  fixture.searchMatch.mockResolvedValue({ match: null, candidates: [] });
  fixture.resolvePlaybackUrl.mockResolvedValue(undefined);
});

describe('本地曲播放时的封面补全', () => {
  it('缓存命中：当前曲与引擎元信息立刻带上封面，不搜索、不下载', async () => {
    fixture.lookupCachedMedia.mockResolvedValue({ path: COVER_PATH, bytes: 1024 });
    const usePlayerStore = await loadStore();

    await usePlayerStore.getState().play(track());
    await vi.waitFor(() => expect(fixture.engine.updateCurrentMusic).toHaveBeenCalledTimes(1));

    expect(fixture.lookupCachedMedia).toHaveBeenCalledWith('cover', COVER_KEY);
    expect(usePlayerStore.getState().current?.picUrl).toBe(COVER_URL);
    expect(usePlayerStore.getState().current?.img).toBe(COVER_URL);
    // 回写引擎是必须的：store.current 每帧都会被引擎推送的 currentMusic 覆盖
    expect(fixture.engine.updateCurrentMusic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'local-1', picUrl: COVER_URL, img: COVER_URL }),
    );
    expect(fixture.searchMatch).not.toHaveBeenCalled();
    expect(fixture.fetchText).not.toHaveBeenCalled();
    expect(fixture.cacheRemoteImage).not.toHaveBeenCalled();
  });

  it('缓存未命中 + 搜到候选：搜一次、落盘，并当次回填到正在播放的曲目', async () => {
    fixture.searchMatch.mockResolvedValue(searchHit());
    const usePlayerStore = await loadStore();

    await usePlayerStore.getState().play(track());
    await vi.waitFor(() => expect(fixture.engine.updateCurrentMusic).toHaveBeenCalledTimes(1));

    // 用被采用候选的 id 问官方 detail（ids=[id]），官方命中就不该再碰网关
    expect(fixture.tauriFetch).toHaveBeenCalledWith(
      `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify(['555']))}`,
      expect.anything(),
    );
    expect(fixture.fetchText).not.toHaveBeenCalled();
    // 落盘到该曲的封面缓存键，档位与沉浸页一致（官方原图 → 600）
    expect(fixture.cacheRemoteImage).toHaveBeenCalledWith({
      url: `${OFFICIAL_COVER_URL}?param=600y600`,
      cacheKey: COVER_KEY,
    });
    expect(usePlayerStore.getState().current?.picUrl).toBe(COVER_URL);
    expect(fixture.engine.updateCurrentMusic).toHaveBeenCalledWith(
      expect.objectContaining({ picUrl: COVER_URL, img: COVER_URL }),
    );
  });

  it('官方没给地址 → 网关兜底，落盘后同样当次回填', async () => {
    fixture.searchMatch.mockResolvedValue(searchHit());
    fixture.tauriFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ songs: [{ album: {} }] }),
      text: async () => JSON.stringify({ url: GATEWAY_COVER_URL }),
    }));
    const usePlayerStore = await loadStore();

    await usePlayerStore.getState().play(track());
    await vi.waitFor(() => expect(fixture.engine.updateCurrentMusic).toHaveBeenCalledTimes(1));

    expect(fixture.fetchText).toHaveBeenCalledTimes(1);
    expect(new URL(fixture.fetchText.mock.calls[0][0]).searchParams.get('id')).toBe('555');
    expect(fixture.cacheRemoteImage).toHaveBeenCalledWith({
      url: 'https://p2.music.126.net/LUrBUIFSa0U3qyKw42Ex-w==/3446942914.jpg?param=600y600',
      cacheKey: COVER_KEY,
    });
    expect(usePlayerStore.getState().current?.picUrl).toBe(COVER_URL);
  });

  it('缓存未命中且搜不到候选：current 与引擎一字不动', async () => {
    const usePlayerStore = await loadStore();

    await usePlayerStore.getState().play(track());
    await vi.waitFor(() => expect(fixture.searchMatch).toHaveBeenCalled());
    await flushTasks();

    expect(usePlayerStore.getState().current?.picUrl).toBeUndefined();
    expect(fixture.cacheRemoteImage).not.toHaveBeenCalled();
    expect(fixture.engine.updateCurrentMusic).not.toHaveBeenCalled();
  });

  it('查询挂起不阻塞起播（封面绝不参与播放成败）', async () => {
    fixture.lookupCachedMedia.mockReturnValue(new Promise(() => {}));
    const usePlayerStore = await loadStore();

    await usePlayerStore.getState().play(track());

    // play() 已经走完：引擎拿到本地曲开始播放，封面还在查
    expect(fixture.engine.play).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'local-1' }),
      song.url,
      undefined,
      undefined,
    );
    expect(usePlayerStore.getState().current?.picUrl).toBeUndefined();
  });

  it('查询期间切了歌：旧结果不贴到新歌上', async () => {
    let resolveLookup!: (value: { path: string; bytes: number }) => void;
    fixture.lookupCachedMedia.mockReturnValue(new Promise((done) => { resolveLookup = done; }));
    const usePlayerStore = await loadStore();

    await usePlayerStore.getState().play(track());
    const next = track({ id: 'local-2', name: '下一首' });
    usePlayerStore.setState({ current: next });

    resolveLookup({ path: COVER_PATH, bytes: 1024 });
    await flushTasks();

    expect(usePlayerStore.getState().current?.id).toBe('local-2');
    expect(usePlayerStore.getState().current?.picUrl).toBeUndefined();
    expect(fixture.engine.updateCurrentMusic).not.toHaveBeenCalled();
  });

  it('切歌后回到同一首：结果贴到当时的当前对象上，不把旧对象写回去', async () => {
    let resolveLookup!: (value: { path: string; bytes: number }) => void;
    fixture.lookupCachedMedia.mockReturnValue(new Promise((done) => { resolveLookup = done; }));
    const usePlayerStore = await loadStore();

    await usePlayerStore.getState().play(track());
    // 同一首（source:id 相同）但已被重新装载的新对象：地址/标签可能与旧对象不同
    const reLoaded = track({ url: 'asset://F:/music/re-resolved.flac' });
    usePlayerStore.setState({ current: reLoaded });

    resolveLookup({ path: COVER_PATH, bytes: 1024 });
    await vi.waitFor(() => expect(fixture.engine.updateCurrentMusic).toHaveBeenCalledTimes(1));

    const current = usePlayerStore.getState().current;
    expect(current).not.toBe(reLoaded);
    expect(current?.picUrl).toBe(COVER_URL);
    // 保留当时那份对象的字段，而不是旧对象上的值
    expect(current?.url).toBe('asset://F:/music/re-resolved.flac');
    expect(fixture.engine.updateCurrentMusic).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'asset://F:/music/re-resolved.flac', picUrl: COVER_URL }),
    );
  });

  it('手动封面永远优先：不查缓存、不搜索、不覆盖', async () => {
    fixture.lookupCachedMedia.mockResolvedValue({ path: COVER_PATH, bytes: 1024 });
    fixture.searchMatch.mockResolvedValue(searchHit());
    const usePlayerStore = await loadStore();
    const manual = 'asset://F:/manual/cover.jpg';

    await usePlayerStore.getState().play(track({ picUrl: manual, img: manual }));
    await flushTasks();

    expect(fixture.lookupCachedMedia).not.toHaveBeenCalled();
    expect(fixture.searchMatch).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().current?.picUrl).toBe(manual);
    expect(fixture.engine.updateCurrentMusic).not.toHaveBeenCalled();
  });

  it('非本地曲不触发（在线曲目不查本地封面缓存）', async () => {
    const usePlayerStore = await loadStore();
    const online = { id: '1', source: 'wy', name: 'x', singer: 'y' } as MusicInfo;

    await usePlayerStore.getState().play(online);
    await flushTasks();

    expect(fixture.lookupCachedMedia).not.toHaveBeenCalled();
    expect(fixture.searchMatch).not.toHaveBeenCalled();
    expect(fixture.cacheRemoteImage).not.toHaveBeenCalled();
  });

  it('引擎随后才装载这首（对象本身仍无封面）时，靠记住的封面补回来', async () => {
    fixture.lookupCachedMedia.mockResolvedValue({ path: COVER_PATH, bytes: 1024 });
    const usePlayerStore = await loadStore();
    const bare = track();

    await usePlayerStore.getState().play(bare);
    await vi.waitFor(() => expect(fixture.engine.updateCurrentMusic).toHaveBeenCalled());

    // play() 交给引擎的就是这份无封面对象：索引重建（引擎推送 / 曲库变化）必须重新补上封面
    const { createLocalPlaybackLookup } = await import('../src/services/localPlaybackMetadata');
    const lookup = createLocalPlaybackLookup(() => [song] as LocalSong[]);
    expect(lookup(bare)).toMatchObject({ picUrl: COVER_URL, img: COVER_URL });
  });
});

describe('元信息重建时的封面优先级', () => {
  it('曲库记录没有封面时保留播放期间补上的封面', async () => {
    const { createLocalPlaybackLookup } = await import('../src/services/localPlaybackMetadata');
    const lookup = createLocalPlaybackLookup(() => [song] as LocalSong[]);
    const covered = track({ picUrl: COVER_URL, img: COVER_URL });

    expect(lookup(covered)).toBe(covered);
  });

  it('曲库有手动封面时以它为准', async () => {
    const { createLocalPlaybackLookup } = await import('../src/services/localPlaybackMetadata');
    const manual = 'asset://F:/manual/cover.jpg';
    const lookup = createLocalPlaybackLookup(() => [{ ...song, coverOverride: manual }] as LocalSong[]);

    expect(lookup(track({ picUrl: COVER_URL, img: COVER_URL }))).toMatchObject({ picUrl: manual, img: manual });
  });
});
