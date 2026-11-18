const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

// 心动模式已整体移除，但带它的旧版本会把 { type: "heartbeat", ... } 原样写进播放快照。
// 这里锁住两件事：这样的快照恢复后是一条可以正常续播、切歌的普通队列；恢复时留下日志，不静默。

const SNAPSHOT_KEY = "auralflow:playback-snapshot:v1";
const song = (id) => ({ id, source: "wy", name: id, singer: "Artist", interval: 180 });

// 形状取自移除前的 playerStore.setHeartbeatContext + playbackSnapshot.savePlaybackSnapshot 的真实输出：
// queue / currentIndex 与推荐批次同步，playbackContext 里另存一份批次和尚未播到的推荐缓冲。
function legacyHeartbeatSnapshot() {
  const batch = [song("seed"), song("B"), song("C")];
  return {
    currentSong: batch[2], queue: batch, currentIndex: 2, shuffleHistory: [], position: 37.5, duration: 180,
    playMode: "list", playbackRate: 1, volume: 0.8, previousVolume: 0.8, isMuted: false,
    playbackContext: {
      type: "heartbeat", seedSongId: "seed", playlistId: "liked-playlist",
      currentBatch: batch, currentBatchIndex: 2, buffer: [song("D"), song("E")], hasMore: true,
    },
    savedAt: 1758153600000,
  };
}

// 真实 store、播放服务与快照模块，仅替换原生、存储和网络边界。
function setup(persisted) {
  const logs = [];
  const calls = [];
  const native = {};
  for (const method of ["setupPlayer", "updateOptions", "setRepeatMode", "add", "skip", "remove", "setRate", "setVolume", "play", "stop", "reset", "pause"]) {
    native[method] = async (...args) => { calls.push([method, ...args]); };
  }
  native.getQueue = async () => [];
  const cache = {
    getCachedPlaybackUrl: async (track) => ({ url: `https://fixture.invalid/${track.id}`, quality: "320k" }),
    saveCachedPlaybackUrl: async () => {}, invalidateCachedPlaybackUrl: async () => {},
  };
  const tracker = { startListeningSession() {}, resetListeningSession() {}, onPlaybackProgress() {}, seekListeningSession() {}, flushListeningSession: async () => {} };
  // 恢复出来的是普通队列：谁再去拉推荐流，用例直接失败。
  const recommendations = { getPersonalFmSongs: async () => { throw new Error("普通队列不应请求推荐接口"); } };
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    "@react-native-async-storage/async-storage": {
      getItem: async (key) => (key === SNAPSHOT_KEY ? persisted : null), setItem: async () => {}, removeItem: async () => {},
    },
    "react-native-track-player": { __esModule: true, default: native, State: {}, RepeatMode: { Off: 0 }, Event: {}, AppKilledPlaybackBehavior: {}, Capability: {} },
    "@/services/androidPitchService": {}, "./playbackUrlCache": cache, "@/services/playbackUrlCache": cache,
    "@/services/playbackFailurePolicy": {}, "@/services/lyricOverlayService": { isLyricOverlaySupported: () => false },
    "@/services/listenTrackerService": tracker, "./listenTrackerService": tracker,
    "./musicApi": { getLyrics: async () => [], buildStreamHeaders: () => ({}) },
    "./wyDirectProvider": {}, "./wyPlaylistService": recommendations, "./customSourceRuntime": {}, "../stores/customSourceStore": {},
    "./streamProbe": {},
    "./hiddenFallbackService": { startHiddenSearch: async () => [], resolveHiddenFromGroups: async () => null, resolveHiddenFallback: async () => null },
    "@/services/crossSourceFallbackService": { findTxVariants: async () => [], describeCrossSourceFailure: () => "无替代歌曲" },
    "@/stores/playbackSettingsStore": { usePlaybackSettingsStore: { getState: () => ({ defaultQuality: "320k" }) } },
    "./cacheService": { CACHEABLE_AUDIO_SOURCES: new Set(), getCachedLyrics: async () => [], cacheCover: async () => {}, cacheLyrics: async () => {} },
    "@/services/logger": { logger: { info(...args) { logs.push(["info", ...args]); }, warn(...args) { logs.push(["warn", ...args]); }, error(...args) { logs.push(["error", ...args]); } } },
  });
  const store = load("src/stores/playerStore.ts").usePlayerStore;
  const service = load("src/services/playerService.ts");
  const snapshot = load("src/services/playbackSnapshot.ts");
  return { store, service, snapshot, logs, calls };
}

const retiredContextWarnings = (h) => h.logs.filter(([level, message]) => level === "warn" && /心动模式/.test(message));
// 上限只是 runner 的安全网：首个用例要转译整张真实模块图。
const options = { timeout: 20000 };

test("旧版本留下的心动模式快照按普通队列恢复，并留下日志", options, async () => {
  const h = setup(JSON.stringify(legacyHeartbeatSnapshot()));
  const restored = await h.snapshot.loadPlaybackSnapshot();
  assert.ok(restored, "快照不能因为带着已下线的上下文被整份丢弃");
  const state = h.store.getState();
  assert.deepEqual(state.playbackContext, { type: "queue" });
  assert.deepEqual(state.queue.map((item) => item.id), ["seed", "B", "C"]);
  assert.equal(state.currentIndex, 2);
  assert.equal(state.currentSong.id, "C");
  assert.equal(state.position, 37.5);
  assert.equal(state.isPlaying, false);
  assert.equal(retiredContextWarnings(h).length, 1);
});

test("心动模式快照恢复后可以续播和切歌，不停在已下线的上下文里", options, async () => {
  const h = setup(JSON.stringify(legacyHeartbeatSnapshot()));
  await h.snapshot.loadPlaybackSnapshot();

  // 续播：恢复的那首从快照位置起播
  await h.service.resumePlayback();
  assert.equal(h.store.getState().currentSong.id, "C");
  assert.equal(h.store.getState().currentUrl, "https://fixture.invalid/C");
  assert.equal(h.store.getState().position, 37.5);
  assert.equal(h.store.getState().isPlaying, true);

  // 下一首：按列表循环回到队首，而不是去拉推荐（推荐接口一被调用就抛错）
  await h.service.playNext();
  assert.equal(h.store.getState().currentSong.id, "seed");
  assert.equal(h.store.getState().currentIndex, 0);

  // 上一首：按普通队列回到队尾
  await h.service.playPrevious();
  assert.equal(h.store.getState().currentSong.id, "C");
  assert.equal(h.store.getState().currentIndex, 2);

  assert.deepEqual(h.store.getState().playbackContext, { type: "queue" });
  assert.equal(h.calls.filter((call) => call[0] === "play").length, 3);
  assert.equal(h.store.getState().error, null);
});

for (const [label, playbackContext] of [
  ["queue", { type: "queue" }],
  ["personalFm", { type: "personalFm", currentBatch: [song("seed"), song("B"), song("C")], currentBatchIndex: 2, buffer: [song("D")], hasMore: true }],
  ["缺失", undefined],
  ["null", null],
]) {
  test(`${label} 上下文的快照照旧恢复成普通队列，不记心动模式日志`, options, async () => {
    const h = setup(JSON.stringify({ ...legacyHeartbeatSnapshot(), playbackContext }));
    const restored = await h.snapshot.loadPlaybackSnapshot();
    assert.ok(restored);
    assert.deepEqual(h.store.getState().playbackContext, { type: "queue" });
    assert.equal(h.store.getState().currentSong.id, "C");
    assert.equal(retiredContextWarnings(h).length, 0);
  });
}
