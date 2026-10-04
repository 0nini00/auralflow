import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import type { PlaybackPrefetchEntry } from '../src/services/playback/prefetchModel';
const fixture = vi.hoisted(() => ({
  state: { featureEnabled: true, featureReady: true, sources: [] },
  persistence: { ready: Promise.resolve() },
  play: vi.fn(), pause: vi.fn(), stop: vi.fn(), resolve: vi.fn(), cached: vi.fn(), history: vi.fn(),
}));
vi.mock('../src/stores/customSourceStore', async () => {
  const { createCustomSourceAccess } = await import('../src/services/customSourceAccess');
  return {
    useCustomSourceStore: { getState: () => fixture.state },
    customSourcePersistence: fixture.persistence,
    customSourceAccess: createCustomSourceAccess(() => fixture.state.featureReady && fixture.state.featureEnabled),
  };
});
vi.mock('../src/services/playerEngine', () => ({ playerEngine: {
  play: fixture.play, pause: fixture.pause, stop: fixture.stop,
  subscribe: vi.fn(), onEnded: vi.fn(), onPreviewDetected: vi.fn(),
} }));
vi.mock('../src/services/playback/playbackResolver', () => ({ resolvePlaybackUrl: fixture.resolve }));
vi.mock('../src/services/playback/prefetchService', () => ({ getPrefetchedTrack: fixture.cached, prefetchNearbyTracks: vi.fn(async () => {}), prefetchTracks: vi.fn(async () => {}), invalidatePrefetchedTrack: vi.fn() }));
vi.mock('../src/services/persistentCache', () => ({ invalidateCachedPlaybackUrl: vi.fn(async () => {}) }));
vi.mock('../src/services/mediaCache', () => ({ removeCachedAudioForMusic: vi.fn(async () => {}) }));
vi.mock('../src/services/playback/crossSourceFallbackService', () => ({ findTxVariants: vi.fn(async () => []), describeCrossSourceFailure: () => '无候选' }));
vi.mock('../src/stores/historyStore', () => ({ useHistoryStore: { getState: () => ({ add: fixture.history }) } }));
vi.mock('../src/stores/sleepTimerStore', () => ({ useSleepTimerStore: { getState: () => ({ mode: 'off' }) } }));
vi.mock('../src/stores/discoveryStore', () => ({ useDiscoveryStore: { getState: () => ({ fmQueue: [], fmIndex: 0 }) } }));
vi.mock('@lx/tauri-bridge', () => ({ debugLog: vi.fn(), patchSettings: vi.fn() }));
const music = { id: '1', source: 'wy', name: '歌曲', singer: '歌手' } as MusicInfo;
function resolved(backend = 'customSource') {
  return { music, backend, url: `https://audio/${backend}`, quality: '128k', trace: [], resolverName: backend };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function load() {
  const { customSourceAccess } = await import('../src/stores/customSourceStore');
  const { usePlayerStore } = await import('../src/stores/playerStore');
  const toggle = (enabled: boolean) => {
    fixture.state.featureEnabled = enabled;
    customSourceAccess.invalidate();
  };
  return { customSourceAccess, usePlayerStore, toggle };
}
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  fixture.state.featureEnabled = true;
  fixture.state.featureReady = true;
  fixture.persistence.ready = Promise.resolve();
  fixture.play.mockResolvedValue(undefined);
  fixture.resolve.mockResolvedValue(resolved('builtinNetease'));
});
describe('playerStore LX 快路径及在途结果', () => {
  it('关闭时 wy 的 LX 预取快路径不播放，仍解析内置', async () => {
    fixture.state.featureEnabled = false;
    fixture.cached.mockReturnValue({ ...resolved(), fetchedAt: Date.now() });
    const { usePlayerStore } = await load();
    await usePlayerStore.getState().play(music);
    expect(fixture.resolve).toHaveBeenCalled();
    expect(fixture.play).toHaveBeenCalledWith(music, 'https://audio/builtinNetease', undefined);
    expect(fixture.play).not.toHaveBeenCalledWith(music, 'https://audio/customSource', expect.any(Function));
  });
  it('开启且版本匹配时仍走 LX 快路径', async () => {
    const { usePlayerStore, customSourceAccess } = await load();
    fixture.cached.mockReturnValue({ ...resolved(), fetchedAt: Date.now(), customSourceVersion: customSourceAccess.version } as PlaybackPrefetchEntry);
    await usePlayerStore.getState().play(music);
    expect(fixture.resolve).not.toHaveBeenCalled();
    expect(() => fixture.play.mock.calls[0][2]()).not.toThrow();
    customSourceAccess.invalidate();
    expect(() => fixture.play.mock.calls[0][2]()).toThrow();
    expect(fixture.play).toHaveBeenCalledWith(music, 'https://audio/customSource', expect.any(Function));
  });
  it('off→on 后旧版本的 LX 快路径不复活', async () => {
    const { usePlayerStore, customSourceAccess, toggle } = await load();
    const version = customSourceAccess.version;
    toggle(false);
    toggle(true);
    fixture.cached.mockReturnValue({ ...resolved(), fetchedAt: Date.now(), customSourceVersion: version });
    await usePlayerStore.getState().play(music);
    expect(fixture.play).not.toHaveBeenCalledWith(music, 'https://audio/customSource', expect.any(Function));
    expect(fixture.resolve).toHaveBeenCalled();
  });
  it.each(['customSource', 'builtinNetease'])('解析在途 off→on 仅拒绝旧 LX，保留内置：%s', async (backend) => {
    const request = deferred<ReturnType<typeof resolved>>();
    fixture.resolve.mockReturnValue(request.promise);
    const { usePlayerStore, toggle } = await load();
    const pending = usePlayerStore.getState().play(music);
    await vi.waitFor(() => expect(fixture.resolve).toHaveBeenCalled());
    toggle(false);
    toggle(true);
    request.resolve(resolved(backend));
    await pending;
    if (backend === 'customSource') {
      expect(fixture.play).not.toHaveBeenCalled();
      expect(fixture.history).not.toHaveBeenCalled();
    } else {
      expect(fixture.play).toHaveBeenCalledWith(music, 'https://audio/builtinNetease', undefined);
    }
  });
  it('hydrate 未完成不读取在线缓存，完成后按迁移状态播放', async () => {
    const hydration = deferred<void>();
    fixture.state.featureReady = false;
    fixture.state.featureEnabled = false;
    fixture.persistence.ready = hydration.promise;
    const { usePlayerStore, customSourceAccess } = await load();
    const pending = usePlayerStore.getState().play(music);
    await new Promise((done) => setTimeout(done, 10));
    expect(fixture.cached).not.toHaveBeenCalled();
    fixture.state.featureReady = true;
    fixture.state.featureEnabled = true;
    fixture.cached.mockReturnValue({ ...resolved(), fetchedAt: Date.now(), customSourceVersion: customSourceAccess.version });
    hydration.resolve();
    await pending;
    expect(fixture.play).toHaveBeenCalledWith(music, 'https://audio/customSource', expect.any(Function));
  });
  it('已开始播放不因开关变化暂停或停止', async () => {
    const playing = deferred<void>();
    fixture.play.mockReturnValue(playing.promise);
    fixture.resolve.mockResolvedValue(resolved());
    const { usePlayerStore, toggle } = await load();
    const pending = usePlayerStore.getState().play(music);
    await vi.waitFor(() => expect(fixture.play).toHaveBeenCalled());
    toggle(false);
    playing.resolve();
    await pending;
    expect(fixture.pause).not.toHaveBeenCalled();
    expect(fixture.stop).not.toHaveBeenCalled();
    expect(fixture.play).toHaveBeenCalledTimes(1);
  });
});
