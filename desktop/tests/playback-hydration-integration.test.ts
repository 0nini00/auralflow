import { beforeEach, afterEach, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@/stores/libraryStore", () => ({ useLibraryStore: { getState: () => ({ localSongs: [] }), subscribe: vi.fn() } }));
vi.mock("@/stores/customSourceStore", () => ({
  useCustomSourceStore: { getState: () => ({ featureEnabled: false, featureReady: true }) },
  customSourcePersistence: { ready: Promise.resolve() }, customSourceAccess: { version: 0 },
}));
vi.mock("@/services/playback/playbackResolver", () => ({ resolvePlaybackUrl: vi.fn() }));
vi.mock("@/services/playback/prefetchService", () => ({
  getPrefetchedTrack: () => undefined, prefetchNearbyTracks: vi.fn(async () => {}),
  prefetchTracks: vi.fn(async () => {}), invalidatePrefetchedTrack: vi.fn(),
}));
vi.mock("@/services/persistentCache", () => ({ invalidateCachedPlaybackUrl: vi.fn(async () => {}) }));
vi.mock("@/services/mediaCache", () => ({ removeCachedAudioForMusic: vi.fn(async () => {}) }));
vi.mock("@/services/playback/crossSourceFallbackService", () => ({ findTxVariants: vi.fn(), describeCrossSourceFailure: () => "" }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: { getState: () => ({ add: vi.fn() }) } }));
vi.mock("@/stores/sleepTimerStore", () => ({ useSleepTimerStore: { getState: () => ({ mode: "off" }) } }));
vi.mock("@/stores/discoveryStore", () => ({ useDiscoveryStore: { getState: () => ({ fmQueue: [], fmIndex: 0 }) } }));
vi.mock("@lx/tauri-bridge", () => ({ libraryLoad: f.load, librarySave: f.save, debugLog: vi.fn(), patchSettings: vi.fn(async () => {}) }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("Audio", class { volume = .8; playbackRate = 1; addEventListener() {} });
  f.save.mockResolvedValue(undefined);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const song = { id: "A", source: "wy", name: "A", singer: "s" };

it("生产挂载入口校验非法队列、进度和倍速", async () => {
  f.load.mockResolvedValue({ music: song, queue: "broken", progress: -3, playbackRate: 0 });
  const { attachPlaybackPersistence } = await import("@/stores/playerPersistence");
  const { usePlayerStore } = await import("@/stores/playerStore");
  await attachPlaybackPersistence().ready;
  expect(usePlayerStore.getState().queue).toEqual([]);
  expect(usePlayerStore.getState().progress).toBe(0);
  expect(usePlayerStore.getState().playbackRate).toBe(1);
});
it("恢复倍速同时更新引擎，音量事件不覆盖恢复值", async () => {
  f.load.mockResolvedValue({ music: song, queue: [song], currentIndex: 0, progress: 15, duration: 200, playbackRate: 1.5, repeatMode: "all", isShuffle: false });
  const { attachPlaybackPersistence } = await import("@/stores/playerPersistence");
  const { usePlayerStore } = await import("@/stores/playerStore");
  const { playerEngine } = await import("@/services/playerEngine");
  await attachPlaybackPersistence().ready;
  expect(usePlayerStore.getState().playbackRate).toBe(1.5);
  expect(playerEngine.getState().playbackRate).toBe(1.5);
  usePlayerStore.getState().setVolume(.6);
  expect(usePlayerStore.getState().playbackRate).toBe(1.5);
});

it('会话读盘前先恢复音量不能把磁盘倍速覆盖为引擎默认值', async () => {
  let finish!: (value: unknown) => void;
  f.load.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { attachPlaybackPersistence } = await import('@/stores/playerPersistence');
  const { usePlayerStore } = await import('@/stores/playerStore');
  const { playerEngine } = await import('@/services/playerEngine');
  const persistence = attachPlaybackPersistence();
  usePlayerStore.getState().setVolume(.4);
  finish({ music: song, queue: [song], playbackRate: 1.5, progress: 15 });
  await persistence.ready;
  expect(usePlayerStore.getState().volume).toBe(.4);
  expect(usePlayerStore.getState().playbackRate).toBe(1.5);
  expect(playerEngine.getState().playbackRate).toBe(1.5);
});
