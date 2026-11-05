import { beforeEach, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({
  play: vi.fn(), stop: vi.fn(), pause: vi.fn(), resolve: vi.fn(), find: vi.fn(), ended: vi.fn(), started: false, subscription: undefined as any,
}));
vi.mock("@/stores/libraryStore", () => ({ useLibraryStore: { getState: () => ({ localSongs: [] }), subscribe: vi.fn() } }));
vi.mock("@/stores/customSourceStore", () => ({
  useCustomSourceStore: { getState: () => ({ featureEnabled: false, featureReady: true }) },
  customSourcePersistence: { ready: Promise.resolve() },
  customSourceAccess: { version: 0 },
}));
vi.mock("@/services/playerEngine", () => ({ playerEngine: {
  play: f.play, stop: f.stop, pause: f.pause, subscribe: vi.fn(cb => { f.subscription = cb; }),
  onEnded: f.ended, onPreviewDetected: vi.fn(), getState: () => ({ currentMusic: null }),
} }));
vi.mock("@/services/playback/playbackResolver", () => ({ resolvePlaybackUrl: f.resolve }));
vi.mock("@/services/playback/prefetchService", () => ({
  getPrefetchedTrack: () => undefined, prefetchNearbyTracks: vi.fn(async () => {}),
  prefetchTracks: vi.fn(async () => {}), invalidatePrefetchedTrack: vi.fn(),
}));
vi.mock("@/services/persistentCache", () => ({ invalidateCachedPlaybackUrl: vi.fn(async () => {}) }));
vi.mock("@/services/mediaCache", () => ({ removeCachedAudioForMusic: vi.fn(async () => {}) }));
vi.mock("@/services/playback/crossSourceFallbackService", () => ({ findTxVariants: f.find, describeCrossSourceFailure: () => "no candidates" }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: { getState: () => ({ add: vi.fn() }) } }));
vi.mock("@/stores/discoveryStore", () => ({ useDiscoveryStore: { getState: () => ({ fmQueue: [], fmIndex: 0 }) } }));
vi.mock("@lx/tauri-bridge", () => ({ debugLog: vi.fn(), patchSettings: vi.fn(), libraryLoad: vi.fn(async () => null), librarySave: vi.fn(async () => {}) }));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); f.started = false; });

it.each(['one', 'all'] as const)('按歌曲关闭在单首队列 %s 循环也按实际结束次数倒数', async (repeatMode) => {
  const { usePlayerStore } = await import('@/stores/playerStore');
  const { useSleepTimerStore } = await import('@/stores/sleepTimerStore');
  const song = { id: 'one', source: 'tx', name: 'One', singer: 'Singer' } as any;
  const play = vi.fn(async () => {});
  const next = vi.fn(async () => {});
  usePlayerStore.setState({ current: song, queue: [song], currentIndex: 0, status: 'playing', repeatMode, play, next });
  useSleepTimerStore.getState().startSongs(2);
  f.ended.mock.calls[0][0]();
  expect(useSleepTimerStore.getState().remainingSongs).toBe(1);
  f.ended.mock.calls[0][0]();
  expect(useSleepTimerStore.getState().mode).toBe('off');
  expect(f.pause).toHaveBeenCalledTimes(1);
  expect(play.mock.calls.length + next.mock.calls.length).toBe(1);
});

it("旧曲最后一个兜底候选迟到失败不能停止已经播放的新曲", async () => {
  const a = { id: "A", source: "wy", name: "A", singer: "s" } as any;
  const b = { id: "B", source: "tx", name: "B", singer: "s" } as any;
  const candidate = { id: "A-candidate", source: "tx", name: "A", singer: "s" } as any;
  let rejectCandidate!: (error: Error) => void;
  f.find.mockResolvedValue([candidate]);
  f.resolve.mockImplementation(async music => {
    if (music.id === "A") throw new Error("A resolve failed");
    if (music.id === "A-candidate") {
      f.started = true;
      return new Promise((_, reject) => { rejectCandidate = reject; });
    }
    return { music, url: "https://invalid.test/B", backend: "builtinProvider" };
  });
  const { usePlayerStore } = await import("@/stores/playerStore");
  f.play.mockImplementation(async music => {
    f.subscription({ currentMusic: music, status: "playing", volume: .8, playbackRate: 1, currentTime: 0, duration: 100, currentTimeSampledAt: Date.now(), error: null });
  });
  const pendingA = usePlayerStore.getState().play(a);
  await vi.waitFor(() => expect(f.started).toBe(true));
  await usePlayerStore.getState().play(b);
  expect(usePlayerStore.getState().status).toBe("playing");
  expect(usePlayerStore.getState().current?.id).toBe("B");
  rejectCandidate(new Error("old A fallback candidate resolve failed"));
  await pendingA;
  expect(f.stop).not.toHaveBeenCalled();
  expect(usePlayerStore.getState().current?.id).toBe("B");
  expect(usePlayerStore.getState().status).toBe("playing");
  expect(usePlayerStore.getState().error).toBeNull();
});
