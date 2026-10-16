import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import type { LocalSong } from '../src/services/localMusicService';

/**
 * 本地曲封面不发起任何网络请求。
 *
 * 桌面端封面只允许来自音频文件自己（内嵌标签 / 同目录旁挂图，扫描时由 Rust 落盘成
 * cover 短路径），平台自动匹配与用户自定义都已删除。这条用例把整条
 * 起播 → 元信息重建链路上的**所有出站出口**都换成探针：Tauri http（网易 / QQ / LRCLIB
 * 走它）、浏览器 fetch（网关兜底走它）、原生 invoke（出站代理走它）与封面落盘/查盘，
 * 有封面与没封面两种情况都必须零调用——不许再「猜」一张图回来。
 */
const fixture = vi.hoisted(() => ({
  state: { featureEnabled: false, featureReady: true, sources: [] as unknown[] },
  persistence: { ready: Promise.resolve() },
  localSongs: [] as unknown[],
  engine: {
    play: vi.fn(), pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), setVolume: vi.fn(),
    getState: vi.fn(), subscribe: vi.fn(() => () => {}), onEnded: vi.fn(), onPreviewDetected: vi.fn(),
    updateCurrentMusic: vi.fn(),
  },
  lookupCachedMedia: vi.fn(),
  cacheRemoteImage: vi.fn(),
  tauriFetch: vi.fn(),
  browserFetch: vi.fn(),
  invoke: vi.fn(),
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
    subscribe: vi.fn(),
  },
}));
vi.mock('@lx/tauri-bridge', () => ({
  lookupCachedMedia: fixture.lookupCachedMedia,
  cacheRemoteImage: fixture.cacheRemoteImage,
  cacheRemoteAudio: vi.fn(),
  removeCachedMedia: vi.fn(),
  scanDirectory: vi.fn(),
  getAudioInfo: vi.fn(),
  debugLog: vi.fn(),
  patchSettings: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fixture.tauriFetch }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: fixture.invoke,
}));
vi.mock('../src/services/playback/playbackResolver', () => ({ resolvePlaybackUrl: vi.fn() }));
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

/** 内嵌/旁挂封面已经由扫描写进记录的本地曲。 */
const songWithCover: LocalSong = {
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
  cover: 'asset://F:/music/cover.jpg',
};
/** 同一个文件目录里既没有内嵌封面也没有旁挂图。 */
const songWithoutCover: LocalSong = { ...songWithCover, id: 'local-2', path: 'F:\\music\\bare.flac', cover: undefined };

const flushTasks = () => new Promise((done) => setTimeout(done, 10));

async function loadStore() {
  const { usePlayerStore } = await import('../src/stores/playerStore');
  return usePlayerStore;
}

function expectNoOutbound(): void {
  expect(fixture.tauriFetch).not.toHaveBeenCalled();
  expect(fixture.browserFetch).not.toHaveBeenCalled();
  expect(fixture.invoke).not.toHaveBeenCalled();
  expect(fixture.cacheRemoteImage).not.toHaveBeenCalled();
  expect(fixture.lookupCachedMedia).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  fixture.state.featureEnabled = false;
  fixture.state.featureReady = true;
  fixture.localSongs = [];
  fixture.engine.play.mockResolvedValue(undefined);
  fixture.engine.getState.mockReturnValue({ currentMusic: null });
  fixture.engine.subscribe.mockReturnValue(() => {});
  fixture.lookupCachedMedia.mockResolvedValue(null);
  fixture.tauriFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) });
  vi.stubGlobal('fetch', fixture.browserFetch);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('本地曲封面解析的出站请求', () => {
  it('有内嵌/旁挂封面：封面直接来自曲库记录，播放全程零请求', async () => {
    fixture.localSongs = [songWithCover];
    const { localSongToMusicInfo } = await import('../src/services/localMusicService');
    const usePlayerStore = await loadStore();
    const track = localSongToMusicInfo(songWithCover);

    await usePlayerStore.getState().play(track);
    await flushTasks();

    expect(usePlayerStore.getState().current?.picUrl).toBe(songWithCover.cover);
    expect(fixture.engine.play).toHaveBeenCalledWith(
      expect.objectContaining({ id: songWithCover.id, picUrl: songWithCover.cover }),
      songWithCover.url,
      undefined,
      undefined,
    );
    expectNoOutbound();
  });

  it('没有封面：不发起任何平台请求，播放照常、封面留空', async () => {
    fixture.localSongs = [songWithoutCover];
    const { localSongToMusicInfo } = await import('../src/services/localMusicService');
    const usePlayerStore = await loadStore();

    await usePlayerStore.getState().play(localSongToMusicInfo(songWithoutCover));
    await flushTasks();

    expect(fixture.engine.play).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().current?.picUrl).toBeUndefined();
    expect(usePlayerStore.getState().current?.img).toBeUndefined();
    expectNoOutbound();
  });
});

describe('元信息重建时的封面来源', () => {
  const bareTrack = (song: LocalSong): MusicInfo => ({
    id: song.id,
    name: '播放中的旧名',
    singer: '',
    albumName: '',
    source: 'local',
    isLocal: true,
    interval: 0,
    url: 'asset://active-stream',
  });

  it('曲库记录有封面：重建后直接用记录里的地址，不查缓存也不下载', async () => {
    const { createLocalPlaybackLookup } = await import('../src/services/localPlaybackMetadata');
    const lookup = createLocalPlaybackLookup(() => [songWithCover]);

    const rebuilt = lookup(bareTrack(songWithCover));

    expect(rebuilt).toMatchObject({ picUrl: songWithCover.cover, img: songWithCover.cover, url: 'asset://active-stream' });
    expectNoOutbound();
  });

  it('曲库记录没有封面：重建后依然没有封面，也不去别处找一张', async () => {
    const { createLocalPlaybackLookup } = await import('../src/services/localPlaybackMetadata');
    const lookup = createLocalPlaybackLookup(() => [songWithoutCover]);

    const rebuilt = lookup(bareTrack(songWithoutCover));

    expect(rebuilt.picUrl).toBeUndefined();
    expect(rebuilt.img).toBeUndefined();
    expectNoOutbound();
  });
});
