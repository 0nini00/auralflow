import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

const fixture = vi.hoisted(() => {
  const state = { featureEnabled: true, featureReady: true, sources: [{ id: 'lx', name: 'LX', enabled: true }], applyRuntimeUpdateAlert: vi.fn() };
  let version = 0;
  let controller = new AbortController();
  const access = {
    get version() { return version; },
    capture() {
      const captured = version;
      const signal = controller.signal;
      const isActive = () => state.featureReady && state.featureEnabled && version === captured && !signal.aborted;
      const assertActive = () => { if (!isActive()) throw new Error('LX 未启用或操作已失效'); };
      assertActive();
      return { signal, isActive, assertActive };
    },
  };
  return {
    state, access, persistence: { ready: Promise.resolve() },
    toggle(enabled: boolean) { controller.abort(); controller = new AbortController(); version++; state.featureEnabled = enabled; },
    runtime: vi.fn(), builtin: vi.fn(), provider: vi.fn(), probe: vi.fn(), media: vi.fn(),
    libraryLoad: vi.fn(), librarySave: vi.fn(), preload: vi.fn(), lyrics: vi.fn(),
  };
});
vi.mock('../src/stores/customSourceStore', () => ({ useCustomSourceStore: { getState: () => fixture.state }, customSourceAccess: fixture.access, customSourcePersistence: fixture.persistence }));
vi.mock('../src/services/customSourceRuntime', () => ({ requestCustomSourceMusicUrl: fixture.runtime }));
vi.mock('../src/services/playback/builtinNeteaseBackend', () => ({ builtinNeteaseBackend: { id: 'builtinNetease', resolve: fixture.builtin } }));
vi.mock('../src/services/playback/builtinProviderBackend', () => ({ builtinProviderBackend: { id: 'builtinProvider', resolve: fixture.provider } }));
vi.mock('../src/services/playback/streamProbe', () => ({ probeStreamUrl: fixture.probe }));
vi.mock('../src/services/sources/sourceService', () => ({ getSource: () => ({}) }));
vi.mock('../src/services/mediaCache', () => ({ cacheResolvedPlaybackMedia: fixture.media }));
vi.mock('../src/services/playerEngine', () => ({ playerEngine: { preload: fixture.preload } }));
vi.mock('../src/services/lyricsService', () => ({ getLyrics: fixture.lyrics }));
vi.mock('@lx/tauri-bridge', () => ({
  debugLog: vi.fn(), loadSettings: vi.fn(async () => ({ defaultQuality: '128k' })),
  libraryLoad: fixture.libraryLoad, librarySave: fixture.librarySave, libraryReset: vi.fn(),
}));
const music = { id: '1', source: 'wy', name: '歌曲', singer: '歌手', interval: 240 } as MusicInfo;
const next = { ...music, id: '2' };
function resolved(backend = 'customSource') {
  return { url: `https://audio/${backend}`, quality: 'flac24bit', music, backend, resolverName: backend, trace: [] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function seed(backend: string) {
  const entry = { ...resolved(backend), quality: '128k', cachedAt: Date.now(), expiresAt: Date.now() + 60000 };
  return { version: 1, playbackUrls: { 'wy:1:128k': entry }, lyrics: {} };
}
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  fixture.toggle(true);
  fixture.state.featureReady = true;
  fixture.persistence.ready = Promise.resolve();
  fixture.runtime.mockResolvedValue({ url: 'https://audio/customSource', quality: 'flac24bit' });
  fixture.builtin.mockRejectedValue(new Error('内置失败'));
  fixture.provider.mockRejectedValue(new Error('官方失败'));
  fixture.probe.mockResolvedValue({ ok: true });
  fixture.media.mockImplementation(async (_music, value) => value);
  fixture.libraryLoad.mockResolvedValue(null);
  fixture.librarySave.mockResolvedValue(undefined);
  fixture.lyrics.mockResolvedValue({ lines: [] });
});

describe('LX backend 生命周期', () => {
  it('已 hydrated 时在第一个异步让出点前捕获令牌', async () => {
    const { customSourceBackend } = await import('../src/services/playback/customSourceBackend');
    const pending = customSourceBackend.resolve({ primary: music, qualityPreference: ['flac24bit'] });
    const rejection = expect(pending).rejects.toThrow();
    fixture.toggle(false);
    fixture.toggle(true);
    await rejection;
  });
  it('等待 hydration 后才选择源并给 runtime 传入令牌', async () => {
    const hydration = deferred<void>();
    fixture.state.featureReady = false;
    fixture.state.featureEnabled = false;
    fixture.persistence.ready = hydration.promise;
    const { customSourceBackend } = await import('../src/services/playback/customSourceBackend');
    const pending = customSourceBackend.resolve({ primary: music, qualityPreference: ['flac24bit'] });
    await Promise.resolve();
    expect(fixture.runtime).not.toHaveBeenCalled();
    fixture.state.featureReady = true;
    fixture.toggle(true);
    hydration.resolve();
    await pending;
    expect(fixture.runtime.mock.calls[0][3]).toMatchObject({ signal: expect.any(AbortSignal), assertActive: expect.any(Function) });
  });
  it('关闭时直接 backend 调用显式拒绝，不执行 runtime', async () => {
    fixture.toggle(false);
    const { customSourceBackend } = await import('../src/services/playback/customSourceBackend');
    await expect(customSourceBackend.resolve({ primary: music, qualityPreference: ['flac24bit'] })).rejects.toThrow();
    expect(fixture.runtime).not.toHaveBeenCalled();
  });
  it('off→on 后旧 runtime 返回和更新回调均不能生效', async () => {
    const request = deferred<{ url: string; quality: string }>();
    fixture.runtime.mockReturnValue(request.promise);
    const { customSourceBackend } = await import('../src/services/playback/customSourceBackend');
    const pending = customSourceBackend.resolve({ primary: music, qualityPreference: ['flac24bit', '128k'] });
    await vi.waitFor(() => expect(fixture.runtime).toHaveBeenCalledTimes(1));
    const call = fixture.runtime.mock.calls[0];
    const callback = call[4] ?? call[3];
    fixture.toggle(false);
    fixture.toggle(true);
    expect(() => callback({ message: '旧更新' })).toThrow();
    request.resolve({ url: 'https://old', quality: 'flac24bit' });
    await expect(pending).rejects.toThrow();
    expect(fixture.state.applyRuntimeUpdateAlert).not.toHaveBeenCalled();
    expect(fixture.runtime).toHaveBeenCalledTimes(1);
  });
});

describe('LX 播放候选与异步返回', () => {
  it('调用后立即 off→on，不以新生命周期唤醒旧解析的 LX 候选', async () => {
    fixture.provider.mockResolvedValue(resolved('builtinProvider'));
    const { resolvePlaybackUrl } = await import('../src/services/playback/playbackResolver');
    const pending = resolvePlaybackUrl(music);
    fixture.toggle(false);
    fixture.toggle(true);
    expect((await pending).backend).toBe('builtinProvider');
    expect(fixture.runtime).not.toHaveBeenCalled();
  });
  it('关闭时主源失败也不选择 LX，继续官方内置', async () => {
    fixture.toggle(false);
    fixture.provider.mockResolvedValue(resolved('builtinProvider'));
    const { resolvePlaybackUrl } = await import('../src/services/playback/playbackResolver');
    const result = await resolvePlaybackUrl(music);
    expect(result.backend).toBe('builtinProvider');
    expect(fixture.runtime).not.toHaveBeenCalled();
  });
  it('老用户 hydration 完成后才决定是否启用 LX', async () => {
    const hydration = deferred<void>();
    fixture.state.featureReady = false;
    fixture.state.featureEnabled = false;
    fixture.persistence.ready = hydration.promise;
    const { resolvePlaybackUrl } = await import('../src/services/playback/playbackResolver');
    const pending = resolvePlaybackUrl(music);
    await new Promise((done) => setTimeout(done, 10));
    expect(fixture.builtin).not.toHaveBeenCalled();
    fixture.state.featureReady = true;
    fixture.toggle(true);
    hydration.resolve();
    expect((await pending).backend).toBe('customSource');
  });
  it.each(['probe', 'media'] as const)('%s 等待期间 off→on 后旧 LX 结果不返回、不写 URL 缓存', async (stage) => {
    const gate = deferred<unknown>();
    fixture[stage].mockReturnValue(gate.promise);
    const { resolvePlaybackUrl } = await import('../src/services/playback/playbackResolver');
    const pending = resolvePlaybackUrl(music);
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(fixture[stage]).toHaveBeenCalled());
    fixture.toggle(false);
    fixture.toggle(true);
    gate.resolve(stage === 'probe' ? { ok: true } : resolved());
    await rejection;
    expect(fixture.librarySave).not.toHaveBeenCalled();
  });
});

describe('持久化缓存 backend 过滤及提交', () => {
  it('没有原始令牌的 LX 结果不能在重新开启后补发许可', async () => {
    const value = resolved();
    fixture.toggle(false);
    fixture.toggle(true);
    const { saveCachedPlaybackUrl } = await import('../src/services/persistentCache');
    await expect(saveCachedPlaybackUrl(music, value as never)).rejects.toThrow('令牌');
    expect(fixture.libraryLoad).not.toHaveBeenCalled();
    expect(fixture.librarySave).not.toHaveBeenCalled();
  });
  it.each(['https://audio/custom', 'asset://local/custom'])('关闭时过滤已有 LX 缓存，包括 %s', async (url) => {
    const disk = seed('customSource');
    disk.playbackUrls['wy:1:128k'].url = url;
    fixture.libraryLoad.mockResolvedValue(disk);
    fixture.toggle(false);
    const { getCachedPlaybackUrl } = await import('../src/services/persistentCache');
    expect(await getCachedPlaybackUrl(music, ['128k'])).toBeNull();
  });
  it('关闭时继续读取同一 wy 曲目的内置缓存', async () => {
    fixture.libraryLoad.mockResolvedValue(seed('builtinNetease'));
    fixture.toggle(false);
    const { getCachedPlaybackUrl } = await import('../src/services/persistentCache');
    expect((await getCachedPlaybackUrl(music, ['128k']))?.backend).toBe('builtinNetease');
  });
  it('缓存读取在途遇到 off→on，不能复活旧 LX 读取', async () => {
    const disk = deferred<unknown>();
    fixture.libraryLoad.mockReturnValue(disk.promise);
    const { getCachedPlaybackUrl } = await import('../src/services/persistentCache');
    const pending = getCachedPlaybackUrl(music, ['128k']);
    await vi.waitFor(() => expect(fixture.libraryLoad).toHaveBeenCalled());
    fixture.toggle(false);
    fixture.toggle(true);
    disk.resolve(seed('customSource'));
    expect(await pending).toBeNull();
  });
  it('LX 缓存写等待 load 时关闭重开，不提交', async () => {
    const disk = deferred<unknown>();
    fixture.libraryLoad.mockReturnValue(disk.promise);
    const { saveCachedPlaybackUrl } = await import('../src/services/persistentCache');
    const pending = saveCachedPlaybackUrl(music, resolved() as never, undefined, fixture.access.capture());
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(fixture.libraryLoad).toHaveBeenCalled());
    fixture.toggle(false);
    fixture.toggle(true);
    disk.resolve(null);
    await rejection;
    expect(fixture.librarySave).not.toHaveBeenCalled();
  });
  it('LX 写排在其他写之后，提交前失效不能污染内存和磁盘', async () => {
    const writing = deferred<void>();
    fixture.librarySave.mockReturnValueOnce(writing.promise);
    const cache = await import('../src/services/persistentCache');
    const builtin = cache.saveCachedPlaybackUrl(next, { ...resolved('builtinNetease'), music: next } as never);
    await vi.waitFor(() => expect(fixture.librarySave).toHaveBeenCalledTimes(1));
    const custom = cache.saveCachedPlaybackUrl(music, resolved() as never, undefined, fixture.access.capture());
    const rejection = expect(custom).rejects.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    fixture.toggle(false);
    fixture.toggle(true);
    writing.resolve();
    await builtin;
    await rejection;
    expect(await cache.getCachedPlaybackUrl(music, ['flac24bit'])).toBeNull();
    expect(fixture.librarySave).toHaveBeenCalledTimes(1);
  });
});

describe('预取身份与提交', () => {
  it('关闭重开期间失败的解析不留下阻止新预取的空条目', async () => {
    const gate = deferred<void>();
    const service = await import('../src/services/playback/prefetchService');
    const pending = service.prefetchNearbyTracks({ queue: [next, music], currentIndex: 0, repeatMode: 'off', resolvePlaybackUrl: () => gate.promise.then(() => { throw new Error('解析已失败'); }) });
    fixture.toggle(false);
    fixture.toggle(true);
    gate.resolve();
    await pending;
    expect(service.getPrefetchedTrack(music)).toBeUndefined();
    const retry = vi.fn(async () => resolved());
    await service.prefetchNearbyTracks({ queue: [next, music], currentIndex: 0, repeatMode: 'off', resolvePlaybackUrl: retry as never });
    expect(retry).toHaveBeenCalled();
  });
  it('调用后立即 off→on，不允许旧预取被新版本接纳', async () => {
    const service = await import('../src/services/playback/prefetchService');
    const pending = service.prefetchNearbyTracks({ queue: [next, music], currentIndex: 0, repeatMode: 'off', resolvePlaybackUrl: vi.fn(async () => resolved()) as never });
    fixture.toggle(false);
    fixture.toggle(true);
    await pending;
    expect(fixture.preload).not.toHaveBeenCalled();
    expect(service.getPrefetchedTrack(music)?.url).toBeUndefined();
  });
  async function prefetch(resolveUrl = vi.fn(async () => resolved())) {
    const service = await import('../src/services/playback/prefetchService');
    const pending = service.prefetchNearbyTracks({ queue: [next, music], currentIndex: 0, repeatMode: 'off', resolvePlaybackUrl: resolveUrl as never });
    return { service, pending };
  }
  it('模型和快路径保留 backend，不以 wy 冒充内置', async () => {
    const model = await import('../src/services/playback/prefetchModel');
    const entry = model.buildPlaybackPrefetchEntry(music, resolved() as never, Date.now());
    expect(entry).toMatchObject({ backend: 'customSource' });
    expect(model.selectCachedPlaybackTarget(music, entry)).toMatchObject({ backend: 'customSource' });
  });
  it('关闭/重开会作废已缓存 LX 预取，但保留内置预取', async () => {
    const { service, pending } = await prefetch();
    await pending;
    expect(service.getPrefetchedTrack(music)?.url).toBeTruthy();
    fixture.toggle(false);
    expect(service.getPrefetchedTrack(music)).toBeUndefined();
    fixture.toggle(true);
    expect(service.getPrefetchedTrack(music)).toBeUndefined();
    await service.prefetchNearbyTracks({ queue: [next, music], currentIndex: 0, repeatMode: 'off', resolvePlaybackUrl: vi.fn(async () => resolved('builtinNetease')) as never });
    fixture.toggle(false);
    expect(service.getPrefetchedTrack(music)?.url).toBe('https://audio/builtinNetease');
  });
  it('解析在途遇到 off→on，不 preload 也不提交旧 LX URL', async () => {
    const request = deferred<ReturnType<typeof resolved>>();
    const resolveUrl = vi.fn(() => request.promise);
    const { service, pending } = await prefetch(resolveUrl);
    await vi.waitFor(() => expect(resolveUrl).toHaveBeenCalled());
    fixture.toggle(false);
    fixture.toggle(true);
    request.resolve(resolved());
    await pending;
    expect(fixture.preload).not.toHaveBeenCalled();
    expect(service.getPrefetchedTrack(music)?.url).toBeUndefined();
  });
  it('歌词等待期间失效的 LX 预取不写入缓存', async () => {
    const lyrics = deferred<{ lines: never[] }>();
    fixture.lyrics.mockReturnValue(lyrics.promise);
    const { service, pending } = await prefetch();
    await vi.waitFor(() => expect(fixture.lyrics).toHaveBeenCalled());
    fixture.toggle(false);
    fixture.toggle(true);
    lyrics.resolve({ lines: [] });
    await pending;
    expect(service.getPrefetchedTrack(music)?.url).toBeUndefined();
  });
});
