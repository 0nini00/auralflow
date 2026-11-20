import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import type { PlaybackPrefetchEntry } from '../src/services/playback/prefetchModel';
const fixture = vi.hoisted(() => ({
  state: { featureEnabled: true, featureReady: true, sources: [] },
  persistence: { ready: Promise.resolve() },
  setVolume: vi.fn(), subscribe: vi.fn(), play: vi.fn(), pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), getEngineState: vi.fn(), resolve: vi.fn(), cached: vi.fn(), history: vi.fn(),
  cacheMedia: vi.fn(), invalidatePersistent: vi.fn(), invalidatePrefetched: vi.fn(), preview: vi.fn(), rejectPlayback: vi.fn(),
}));
vi.mock('@/stores/libraryStore', () => ({ useLibraryStore: { getState: () => ({ localSongs: [] }), subscribe: vi.fn() } }));
vi.mock('../src/stores/customSourceStore', async () => {
  const { createCustomSourceAccess } = await import('../src/services/customSourceAccess');
  return {
    useCustomSourceStore: { getState: () => fixture.state },
    customSourcePersistence: fixture.persistence,
    customSourceAccess: createCustomSourceAccess(() => fixture.state.featureReady && fixture.state.featureEnabled),
  };
});
vi.mock('../src/services/playerEngine', () => ({ playerEngine: {
  play: fixture.play, pause: fixture.pause, stop: fixture.stop, resume: fixture.resume, getState: fixture.getEngineState,
  setVolume: fixture.setVolume, subscribe: fixture.subscribe, onEnded: vi.fn(), onPreviewDetected: fixture.preview, rejectCurrentPlayback: fixture.rejectPlayback,
} }));
vi.mock('../src/services/playback/playbackResolver', () => ({ resolvePlaybackUrl: fixture.resolve }));
vi.mock('../src/services/playback/prefetchService', () => ({ consumePrefetchedTrack: vi.fn(async () => undefined), getPrefetchedTrack: fixture.cached, prefetchNearbyTracks: vi.fn(async () => {}), prefetchTracks: vi.fn(async () => {}), invalidatePrefetchedTrack: fixture.invalidatePrefetched }));
vi.mock('../src/services/persistentCache', () => ({ invalidateCachedPlaybackUrl: fixture.invalidatePersistent, isLocalCachedPlaybackUrl: (url: string) => url.startsWith('asset://') }));
vi.mock('../src/services/mediaCache', () => ({ removeCachedAudioForMusic: vi.fn(async () => {}), cacheResolvedPlaybackMedia: fixture.cacheMedia }));
vi.mock('../src/services/playback/crossSourceFallbackService', () => ({ findTxVariants: vi.fn(async () => []), describeCrossSourceFailure: () => '无候选' }));
vi.mock('../src/stores/historyStore', () => ({ useHistoryStore: { getState: () => ({ add: fixture.history }) } }));
vi.mock('../src/stores/sleepTimerStore', () => ({ useSleepTimerStore: { getState: () => ({ mode: 'off' }) } }));
vi.mock('../src/stores/discoveryStore', () => ({ useDiscoveryStore: { getState: () => ({ fmQueue: [], fmIndex: 0 }) } }));
vi.mock('@lx/tauri-bridge', () => ({ libraryLoad: vi.fn().mockResolvedValue(null), librarySave: vi.fn().mockResolvedValue(undefined), debugLog: vi.fn(), patchSettings: vi.fn() }));
const music = { id: '1', source: 'wy', name: '歌曲', singer: '歌手' } as MusicInfo;
function resolved(backend = 'customSource') {
  return { music, backend, url: `https://audio/${backend}`, quality: '128k', trace: [], resolverName: backend };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
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
  fixture.getEngineState.mockReturnValue({ currentMusic: null });
  fixture.resolve.mockResolvedValue(resolved('builtinNetease'));
  // 媒体缓存默认直通：只有新增的落盘用例会改写返回值
  fixture.cacheMedia.mockImplementation(async (_music: unknown, resolved: { url: string }) => resolved);
  fixture.invalidatePersistent.mockResolvedValue(undefined);
});

it('新鲜地址被播放器拒收后先播放已取得的同曲备用地址', async () => {
  const current = { ...music, source: 'tx' } as MusicInfo;
  const good = { ...resolved('customSource'), music: current, url: 'https://fixture.invalid/good' };
  fixture.resolve.mockResolvedValue({ ...good, url: 'https://fixture.invalid/bad', fallbacks: [good] });
  fixture.play.mockRejectedValueOnce(new Error('codec unsupported')).mockResolvedValue(undefined);
  const { usePlayerStore } = await load();
  await usePlayerStore.getState().play(current);
  expect(fixture.play.mock.calls.map(args => args[1])).toEqual(['https://fixture.invalid/bad', 'https://fixture.invalid/good']);
  expect(fixture.resolve).toHaveBeenCalledTimes(1);
  expect(usePlayerStore.getState().error).toBeNull();
});

it('新鲜地址失败且无备用时，重新解析必须排除已拒绝URL', async () => {
  const current = { ...music, source: 'tx' } as MusicInfo;
  const good = { ...resolved('customSource'), music: current, url: 'https://fixture.invalid/good' };
  fixture.resolve.mockResolvedValueOnce({ ...good, url: 'https://fixture.invalid/bad' }).mockResolvedValue(good);
  fixture.play.mockRejectedValueOnce(new Error('network error')).mockResolvedValue(undefined);
  const { usePlayerStore } = await load();
  await usePlayerStore.getState().play(current);
  expect(fixture.resolve).toHaveBeenCalledTimes(2);
  expect(fixture.resolve.mock.calls[1][3].excludedUrls.has('https://fixture.invalid/bad')).toBe(true);
  expect(fixture.play.mock.calls.map(args => args[1])).toEqual(['https://fixture.invalid/bad', 'https://fixture.invalid/good']);
});

it('播放中错误先恢复同曲备用地址，不直接下一首', async () => {
  const current = { ...music, source: 'tx' } as MusicInfo;
  const good = { ...resolved('customSource'), music: current, url: 'https://fixture.invalid/good' };
  fixture.resolve.mockResolvedValue({ ...good, url: 'https://fixture.invalid/bad', fallbacks: [good] });
  const { usePlayerStore } = await load();
  const next = vi.fn(async () => undefined);
  usePlayerStore.setState({ next });
  await usePlayerStore.getState().play(current);
  const emit = fixture.subscribe.mock.calls[0][0];
  const state = { currentMusic: current, currentUrl: 'https://fixture.invalid/bad', status: 'playing', currentTime: 5, currentTimeSampledAt: Date.now(), duration: 200, volume: .8, playbackRate: 1, error: null };
  emit(state);
  emit({ ...state, status: 'error', error: 'HTTP 522' });
  await vi.waitFor(() => expect(fixture.play).toHaveBeenCalledTimes(2));
  expect(fixture.play.mock.calls[1][1]).toBe('https://fixture.invalid/good');
  expect(fixture.play.mock.calls[1][3]).toBe(5);
  expect(next).not.toHaveBeenCalled();
});

it('没有实际进度推进的恢复不得因已有播放位置而续期', async () => {
  vi.useFakeTimers();
  try {
    const current = { ...music, source: 'tx' } as MusicInfo;
    const good = { ...resolved('customSource'), music: current, url: 'https://fixture.invalid/good' };
    fixture.resolve.mockResolvedValue({ ...good, url: 'https://fixture.invalid/bad', fallbacks: [good] });
    const { usePlayerStore } = await load();
    await usePlayerStore.getState().play(current);
    const emit = fixture.subscribe.mock.calls[0][0];
    const state = { currentMusic: current, currentUrl: 'https://fixture.invalid/bad', status: 'playing', currentTime: 100, currentTimeSampledAt: Date.now(), duration: 200, volume: .8, playbackRate: 1, error: null };
    emit(state);
    await vi.advanceTimersByTimeAsync(31000);
    emit({ ...state, status: 'error', error: 'HTTP 522' });
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.play).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().status).toBe('error');
  } finally { vi.clearAllTimers(); vi.useRealTimers(); }
}, 20000);

it('旧歌恢复仍在等待时，新歌运行期错误也能恢复且旧结果不得接管', async () => {
  const a = { ...music, source: 'tx', id: 'a' } as MusicInfo;
  const b = { ...music, source: 'tx', id: 'b' } as MusicInfo;
  const target = (track: MusicInfo, url: string) => ({ ...resolved('customSource'), music: track, url });
  const stale = deferred<ReturnType<typeof target>>();
  fixture.resolve.mockResolvedValueOnce(target(a, 'https://fixture.invalid/a'))
    .mockImplementationOnce(() => stale.promise)
    .mockResolvedValueOnce({ ...target(b, 'https://fixture.invalid/b'), fallbacks: [target(b, 'https://fixture.invalid/b-good')] });
  const { usePlayerStore } = await load();
  const emit = fixture.subscribe.mock.calls[0][0];
  const engine = (track: MusicInfo, url: string, status: string) => ({ currentMusic: track, currentUrl: url, status, currentTime: 5, currentTimeSampledAt: Date.now(), duration: 200, volume: .8, playbackRate: 1, error: status === 'error' ? 'network failed' : null });
  await usePlayerStore.getState().play(a);
  emit(engine(a, 'https://fixture.invalid/a', 'playing'));
  emit(engine(a, 'https://fixture.invalid/a', 'error'));
  await vi.waitFor(() => expect(fixture.resolve).toHaveBeenCalledTimes(2));
  await usePlayerStore.getState().play(b);
  emit(engine(b, 'https://fixture.invalid/b', 'playing'));
  emit(engine(b, 'https://fixture.invalid/b', 'error'));
  await vi.waitFor(() => expect(fixture.play.mock.calls.map(args => args[1])).toContain('https://fixture.invalid/b-good'));
  stale.resolve(target(a, 'https://fixture.invalid/a-late'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fixture.play.mock.calls.map(args => args[1])).not.toContain('https://fixture.invalid/a-late');
  expect(usePlayerStore.getState().current?.id).toBe('b');
});

it('播放器实际时长发现试听时通过统一错误恢复继续同曲备用地址', async () => {
  const current = { ...music, source: 'tx', interval: 200 } as MusicInfo;
  const good = { ...resolved('customSource'), music: current, url: 'https://fixture.invalid/full' };
  fixture.resolve.mockResolvedValue({ ...good, url: 'https://fixture.invalid/preview', fallbacks: [good] });
  const { usePlayerStore } = await load();
  await usePlayerStore.getState().play(current);
  const emit = fixture.subscribe.mock.calls[0][0];
  const engine = { currentMusic: current, currentUrl: 'https://fixture.invalid/preview', status: 'playing', currentTime: 0, currentTimeSampledAt: Date.now(), duration: 30, volume: .8, playbackRate: 1, error: null };
  emit(engine);
  fixture.rejectPlayback.mockImplementation(message => emit({ ...engine, status: 'error', error: message }));
  fixture.preview.mock.calls[0][0](30);
  await vi.waitFor(() => expect(fixture.play).toHaveBeenCalledTimes(2));
  expect(fixture.play.mock.calls[1][1]).toBe('https://fixture.invalid/full');
});

it('暂停后原地续播保留候选归属，后续错误仍恢复同曲', async () => {
  const current = { ...music, source: 'tx' } as MusicInfo;
  const good = { ...resolved('customSource'), music: current, url: 'https://fixture.invalid/full' };
  fixture.resolve.mockResolvedValue({ ...good, url: 'https://fixture.invalid/first', fallbacks: [good] });
  const { usePlayerStore } = await load();
  await usePlayerStore.getState().play(current);
  fixture.getEngineState.mockReturnValue({ currentMusic: current, currentTime: 10, currentTimeSampledAtMonotonic: 0, playbackRate: 1 });
  const emit = fixture.subscribe.mock.calls[0][0];
  const engine = { currentMusic: current, currentUrl: 'https://fixture.invalid/first', status: 'playing', currentTime: 10, currentTimeSampledAt: Date.now(), duration: 200, volume: .8, playbackRate: 1, error: null };
  emit(engine);
  usePlayerStore.getState().pause();
  usePlayerStore.getState().resume();
  expect(fixture.play).toHaveBeenCalledTimes(1);
  expect(fixture.resume).toHaveBeenCalledTimes(1);
  emit(engine);
  emit({ ...engine, status: 'error', error: 'network failed' });
  await vi.waitFor(() => expect(fixture.play).toHaveBeenCalledTimes(2));
  expect(fixture.play.mock.calls[1][1]).toBe('https://fixture.invalid/full');
  expect(fixture.play.mock.calls[1][3]).toBe(10);
});

it('恢复后健康推进，之后再次故障可开启新恢复窗口', async () => {
  vi.useFakeTimers();
  try {
    const current = { ...music, source: 'tx' } as MusicInfo;
    const target = (url: string) => ({ ...resolved('customSource'), music: current, url });
    fixture.resolve.mockResolvedValue({ ...target('https://fixture.invalid/a'), fallbacks: [target('https://fixture.invalid/b'), target('https://fixture.invalid/c')] });
    const { usePlayerStore } = await load();
    const emit = fixture.subscribe.mock.calls[0][0];
    const engine = (url: string, status: string, position: number) => ({ currentMusic: current, currentUrl: url, status, currentTime: position, currentTimeSampledAt: Date.now(), duration: 200, volume: .8, playbackRate: 1, error: status === 'error' ? 'network failed' : null });
    await usePlayerStore.getState().play(current);
    emit(engine('https://fixture.invalid/a', 'playing', 0));
    emit(engine('https://fixture.invalid/a', 'error', 0));
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.play).toHaveBeenCalledTimes(2);
    for (let position = 0; position <= 6; position++) emit(engine('https://fixture.invalid/b', 'playing', position));
    await vi.advanceTimersByTimeAsync(40000);
    emit(engine('https://fixture.invalid/b', 'error', 6));
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.play).toHaveBeenCalledTimes(3);
    expect(fixture.play.mock.calls[2][1]).toBe('https://fixture.invalid/c');
  } finally { vi.clearAllTimers(); vi.useRealTimers(); }
});

it('失败缓存清理挂起也受当前恢复绝对截止时间约束', async () => {
  vi.useFakeTimers();
  try {
    const current = { ...music, source: 'tx' } as MusicInfo;
    fixture.resolve.mockResolvedValue({ ...resolved('customSource'), music: current });
    fixture.play.mockRejectedValue(new Error('decoder failed'));
    fixture.invalidatePersistent.mockImplementation(() => new Promise(() => {}));
    const { usePlayerStore } = await load();
    let finished = false;
    const playing = usePlayerStore.getState().play(current).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(30001);
    expect(finished).toBe(true);
    expect(usePlayerStore.getState().status).toBe('error');
    await playing;
  } finally { vi.clearAllTimers(); vi.useRealTimers(); }
});
describe('playerStore LX 快路径及在途结果', () => {
  it('切歌立即取消旧解析的工作信号，功能权限令牌不受影响', async () => {
    let firstSignal: AbortSignal | undefined;
    fixture.resolve.mockImplementation((track, _variants, _quality, options) => {
      if (track.id !== music.id) return Promise.resolve({ ...resolved('builtinNetease'), music: track });
      firstSignal = options.signal;
      return new Promise((_resolve, reject) => firstSignal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true }));
    });
    const { usePlayerStore, customSourceAccess } = await load();
    const operation = customSourceAccess.capture();
    const previous = usePlayerStore.getState().play(music);
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    await usePlayerStore.getState().play({ ...music, id: 'new' });
    expect(firstSignal?.aborted).toBe(true);
    expect(operation.isActive()).toBe(true);
    await previous;
    expect(fixture.play.mock.calls).toHaveLength(1);
    expect(fixture.play.mock.calls[0][0].id).toBe('new');
  });
  it('关闭时 wy 的 LX 预取快路径不播放，仍解析内置', async () => {
    fixture.state.featureEnabled = false;
    fixture.cached.mockReturnValue({ ...resolved(), fetchedAt: Date.now() });
    const { usePlayerStore } = await load();
    await usePlayerStore.getState().play(music);
    expect(fixture.resolve).toHaveBeenCalled();
    expect(fixture.play).toHaveBeenCalledWith(music, 'https://audio/builtinNetease', expect.any(Function), undefined);
    expect(fixture.play).not.toHaveBeenCalledWith(music, 'https://audio/customSource', expect.any(Function), undefined);
  });
  it('开启且版本匹配时仍走 LX 快路径', async () => {
    const { usePlayerStore, customSourceAccess } = await load();
    fixture.cached.mockReturnValue({ ...resolved(), fetchedAt: Date.now(), customSourceVersion: customSourceAccess.version } as PlaybackPrefetchEntry);
    await usePlayerStore.getState().play(music);
    expect(fixture.resolve).not.toHaveBeenCalled();
    expect(() => fixture.play.mock.calls[0][2]()).not.toThrow();
    customSourceAccess.invalidate();
    expect(() => fixture.play.mock.calls[0][2]()).toThrow();
    expect(fixture.play).toHaveBeenCalledWith(music, 'https://audio/customSource', expect.any(Function), undefined);
  });
  it('off→on 后旧版本的 LX 快路径不复活', async () => {
    const { usePlayerStore, customSourceAccess, toggle } = await load();
    const version = customSourceAccess.version;
    toggle(false);
    toggle(true);
    fixture.cached.mockReturnValue({ ...resolved(), fetchedAt: Date.now(), customSourceVersion: version });
    await usePlayerStore.getState().play(music);
    expect(fixture.play).not.toHaveBeenCalledWith(music, 'https://audio/customSource', expect.any(Function), undefined);
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
      expect(fixture.play).toHaveBeenCalledWith(music, 'https://audio/builtinNetease', expect.any(Function), undefined);
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
    expect(fixture.play).toHaveBeenCalledWith(music, 'https://audio/customSource', expect.any(Function), undefined);
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
it('解析过程中暂停会作废请求，不在结果回来后自行播放', async () => {
  const pending = deferred<ReturnType<typeof resolved>>();
  fixture.resolve.mockReturnValue(pending.promise);
  const { usePlayerStore } = await load();
  const playing = usePlayerStore.getState().play(music);
  await Promise.resolve();
  usePlayerStore.getState().pause();
  pending.resolve(resolved('builtinNetease'));
  await playing;
  expect(fixture.play).not.toHaveBeenCalled();
  expect(usePlayerStore.getState().status).toBe('paused');
  expect(usePlayerStore.getState().current?.id).toBe(music.id);
});

it('暂停尚未加载的歌曲后恢复，应重新解析目标而不是恢复旧流', async () => {
  const { usePlayerStore } = await load();
  usePlayerStore.setState({ status: 'paused', current: music });
  usePlayerStore.getState().resume();
  await vi.waitFor(() => expect(fixture.play).toHaveBeenCalledTimes(1));
  expect(fixture.resolve).toHaveBeenCalled();
  expect(fixture.resume).not.toHaveBeenCalled();
});


it('本地曲目不再读取 ReplayGain 状态或标签，直接使用普通播放通路', async () => {
  const { usePlayerStore } = await load();
  const local = { ...music, source: 'local' as const, isLocal: true, localPath: 'F:\\music.flac', url: 'asset:music.flac', replayGain: { gainDb: 6 } };
  await usePlayerStore.getState().play(local);
  expect(fixture.play).toHaveBeenCalledWith(local, local.url, undefined, undefined);
  expect(fixture.resolve).not.toHaveBeenCalled();
  expect(usePlayerStore.getState().error).toBeNull();
});


it('静音不覆盖逻辑音量，恢复时使用静音前音量', async () => {
  const { usePlayerStore } = await load();
  const notify = fixture.subscribe.mock.calls[0][0];
  fixture.setVolume.mockImplementation((volume: number) => notify({
    currentMusic: null, currentUrl: null, status: 'idle', currentTime: 0,
    currentTimeSampledAt: 0, duration: 0, playbackRate: 1, volume, error: null,
  }));
  usePlayerStore.getState().setVolume(0.35);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    usePlayerStore.getState().toggleMute();
    expect(fixture.setVolume).toHaveBeenLastCalledWith(0);
    expect(usePlayerStore.getState()).toMatchObject({ isMuted: true, volume: 0.35 });
    usePlayerStore.getState().toggleMute();
    expect(fixture.setVolume).toHaveBeenLastCalledWith(0.35);
    expect(usePlayerStore.getState()).toMatchObject({ isMuted: false, volume: 0.35 });
  }
});

it('引擎的空状态推送不会清掉会话恢复的当前曲与进度', async () => {
  const { usePlayerStore } = await load();
  const onEngineState = fixture.subscribe.mock.calls[0][0] as (state: Record<string, unknown>) => void;
  expect(typeof onEngineState).toBe('function');

  // 模拟启动时从 playback.json 恢复出来的会话（此时引擎还没加载任何音频）
  usePlayerStore.setState({ current: music, queue: [music], currentIndex: 0, progress: 42, duration: 200, status: 'idle' });
  // 恢复音量这一步就会触发引擎推一次状态，而引擎的 currentMusic 仍是 null
  onEngineState({
    currentMusic: null, currentUrl: null, status: 'idle', currentTime: 0,
    currentTimeSampledAt: Date.now(), duration: 0, volume: 0.8, playbackRate: 1, error: null,
  });

  const state = usePlayerStore.getState();
  expect(state.current?.id).toBe(music.id);
  expect(state.progress).toBe(42);
  expect(state.duration).toBe(200);
  expect(state.queue).toHaveLength(1);
});

it('引擎加载了曲目后仍照常同步 current 与进度', async () => {
  const { usePlayerStore } = await load();
  const onEngineState = fixture.subscribe.mock.calls[0][0] as (state: Record<string, unknown>) => void;
  usePlayerStore.setState({ current: null, queue: [], currentIndex: -1, progress: 0, duration: 0, status: 'idle' });
  onEngineState({
    currentMusic: music, currentUrl: 'https://audio/builtinNetease', status: 'playing', currentTime: 12,
    currentTimeSampledAt: Date.now(), duration: 200, volume: 0.8, playbackRate: 1, error: null,
  });

  const state = usePlayerStore.getState();
  expect(state.current?.id).toBe(music.id);
  expect(state.progress).toBe(12);
  expect(state.status).toBe('playing');
});

it('解析全链失败时停止旧音频，不能只报错却继续播上一首', async () => {
  const { usePlayerStore } = await load();
  const onEngineState = fixture.subscribe.mock.calls[0][0] as (state: Record<string, unknown>) => void;

  // 上一首正在播（引擎里装着它），用户点了另一首
  const previous = { ...music, id: 'prev', name: '上一首' } as MusicInfo;
  onEngineState({
    currentMusic: previous, currentUrl: 'https://audio/prev', status: 'playing', currentTime: 30,
    currentTimeSampledAt: Date.now(), duration: 200, volume: 0.8, playbackRate: 1, error: null,
  });
  expect(usePlayerStore.getState().status).toBe('playing');

  const next = { ...music, id: 'next', name: '下一首' } as MusicInfo;
  fixture.resolve.mockRejectedValue(new Error('所有音源均无可用地址'));
  await usePlayerStore.getState().play(next);

  // 必须真的停下旧音频，否则「界面报错 + 声音还是上一首」
  expect(fixture.stop).toHaveBeenCalled();
  const state = usePlayerStore.getState();
  expect(state.status).toBe('error');
  expect(state.error).toContain('所有音源均无可用地址');
  expect(state.current?.id).toBe('next');
});

it('失败后引擎的推送恢复直通，不会把 error 状态钉死', async () => {
  const { usePlayerStore } = await load();
  const onEngineState = fixture.subscribe.mock.calls[0][0] as (state: Record<string, unknown>) => void;

  fixture.resolve.mockRejectedValue(new Error('无可用地址'));
  await usePlayerStore.getState().play(music);
  expect(usePlayerStore.getState().status).toBe('error');

  // 失败收尾已解除目标登记：引擎后续状态必须能正常同步（例如用户重新播放成功）
  onEngineState({
    currentMusic: music, currentUrl: 'https://audio/ok', status: 'playing', currentTime: 5,
    currentTimeSampledAt: Date.now(), duration: 200, volume: 0.8, playbackRate: 1, error: null,
  });
  const state = usePlayerStore.getState();
  expect(state.status).toBe('playing');
  expect(state.progress).toBe(5);
});


// 「下一首播放」：随机抽号与 FM 推荐都会绕过 queue 的插入位置，用户插的歌要等很久
// 才播。锚点必须让 next() 直接播这一首，且消费后清空。
it('「下一首播放」在随机模式下不抽号，直接播插入的那首', async () => {
  const { usePlayerStore } = await load();
  const queue = [
    { ...music, id: 'A', name: 'A' } as MusicInfo,
    { ...music, id: 'B', name: 'B' } as MusicInfo,
    { ...music, id: 'C', name: 'C' } as MusicInfo,
  ];
  usePlayerStore.setState({ queue, currentIndex: 0, isShuffle: true, repeatMode: 'all', playHistory: [] });

  const inserted = { ...music, id: 'X', name: 'X' } as MusicInfo;
  usePlayerStore.getState().playNext(inserted);
  expect(usePlayerStore.getState().queue.map((song) => song.id)).toEqual(['A', 'X', 'B', 'C']);

  await usePlayerStore.getState().next();

  expect(usePlayerStore.getState().current?.id).toBe('X');
  expect(usePlayerStore.getState().currentIndex).toBe(1);
  expect(usePlayerStore.getState().pinnedNextSong).toBeNull();
});

it('「下一首播放」在私人 FM 里也能插播，不被推荐流吞掉', async () => {
  const { usePlayerStore } = await load();
  const queue = [{ ...music, id: 'A', name: 'A' } as MusicInfo];
  usePlayerStore.setState({ queue, currentIndex: 0, fmMode: true, playHistory: [] });

  const inserted = { ...music, id: 'FM-X', name: 'FM-X' } as MusicInfo;
  usePlayerStore.getState().playNext(inserted);
  await usePlayerStore.getState().next();

  expect(usePlayerStore.getState().current?.id).toBe('FM-X');
  expect(usePlayerStore.getState().fmMode).toBe(false);
});

// 预取阶段刻意 cacheMedia:false（不为可能永远不播的邻曲下载整曲），但真正播到
// 预取条目时若不补媒体缓存，顺序播放永远只消费预取快路径，磁盘音频缓存与离线
// 列表再也不会被填充。
it('预取命中时补媒体缓存，并播放补缓存后返回的地址', async () => {
  const { usePlayerStore } = await load();
  fixture.cached.mockReturnValue({ ...resolved('builtinNetease'), fetchedAt: Date.now() });
  fixture.cacheMedia.mockImplementation(async () => ({ music, backend: 'builtinNetease', quality: '128k', url: 'asset://local-audio' }));

  await usePlayerStore.getState().play(music);

  expect(fixture.cacheMedia).toHaveBeenCalledTimes(1);
  expect(fixture.play).toHaveBeenCalledWith(music, 'asset://local-audio', expect.any(Function), undefined);
});

it('被新请求取代的预取失败不再清缓存、不再全链重解析', async () => {
  const { usePlayerStore } = await load();
  fixture.cached.mockReturnValueOnce({ ...resolved('builtinNetease'), fetchedAt: Date.now() });
  const stalled = deferred<void>();
  fixture.play.mockImplementationOnce(() => stalled.promise);
  const first = usePlayerStore.getState().play(music);
  await vi.waitFor(() => expect(fixture.play).toHaveBeenCalledTimes(1));

  // 用户已切到下一首：没有预取条目，走正常解析链路
  const next = { ...music, id: '2' } as MusicInfo;
  fixture.resolve.mockResolvedValue({ ...resolved('builtinNetease'), music: next });
  await usePlayerStore.getState().play(next);
  expect(fixture.play).toHaveBeenCalledTimes(2);

  // 旧引擎调用此时才以「已被更新的操作取消」失败：属于被取代的请求，不得再动缓存
  stalled.reject(new Error('播放加载已被更新的操作取消'));
  await first;

  expect(fixture.resolve).toHaveBeenCalledTimes(1);
  expect(fixture.invalidatePrefetched).not.toHaveBeenCalled();
  expect(fixture.invalidatePersistent).not.toHaveBeenCalled();
});
