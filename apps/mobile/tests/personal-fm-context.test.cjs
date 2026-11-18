const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

// 私人 FM 的「当前批次」只有一个持有者：顶层的 queue / currentIndex。
// 以前 playbackContext 里另存一份 currentBatch / currentBatchIndex，队列面板的移除、撤销等
// 只改 queue，两份随即分叉：下一次 FM 切歌用旧批次重建队列，被移除的歌又回来了。
// 这里用真实 store 与真实播放服务锁住「FM 上下文与队列不会不一致」。
const pure = createLoader({});
const core = { ...pure("../../packages/core/src/switch-step-queue.ts"), ...pure("../../packages/core/src/request-limiter.ts"), ...pure("../../packages/core/src/playback-quality.ts"), ...pure("../../packages/core/src/song-variant.ts"), ...pure("../../packages/core/src/playback-budgets.ts"), isPreviewDuration: () => false };
const song = (id) => ({ id, source: "wy", name: id, singer: "Artist", interval: 180 });
const ids = (list) => list.map((item) => item.id).join(",");
const flush = () => new Promise(setImmediate);
async function until(predicate) { for (let i = 0; i < 100; i += 1) { if (predicate()) return; await flush(); } assert.fail("播放链未到达检查点"); }
// 上限只是 runner 的安全网：首个用例要转译整张真实模块图。
const options = { timeout: 20000 };

function setup() {
  const native = {};
  for (const method of ["setupPlayer", "updateOptions", "setRepeatMode", "add", "skip", "remove", "setRate", "setVolume", "play", "stop", "reset", "pause"]) native[method] = async () => {};
  native.getQueue = async () => [];
  const cache = { getCachedPlaybackUrl: async (track) => ({ url: `https://fixture.invalid/${track.id}`, quality: "320k" }), saveCachedPlaybackUrl: async () => {}, invalidateCachedPlaybackUrl: async () => {} };
  const tracker = { startListeningSession() {}, resetListeningSession() {}, onPlaybackProgress() {}, seekListeningSession() {}, flushListeningSession: async () => {} };
  const recommendations = { getPersonalFmSongs: async () => ({ songs: [], hasMore: false }) };
  const written = [];
  const load = createLoader({
    zustand: mobileRequire("zustand"), "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async (key, value) => { written.push([key, JSON.parse(value)]); }, removeItem: async () => {} },
    "react-native-track-player": { __esModule: true, default: native, State: {}, RepeatMode: { Off: 0 }, Event: {}, AppKilledPlaybackBehavior: {}, Capability: {} },
    "@lx/core": core, "@/services/androidPitchService": {}, "./playbackUrlCache": cache, "@/services/playbackUrlCache": cache,
    "@/services/lyricOverlayService": { isLyricOverlaySupported: () => false },
    "@/services/listenTrackerService": tracker, "./listenTrackerService": tracker,
    "./musicApi": { getLyrics: async () => [], buildStreamHeaders: () => ({}) },
    "./wyDirectProvider": {}, "./wyPlaylistService": recommendations, "./customSourceRuntime": {}, "../stores/customSourceStore": {}, "./streamProbe": {},
    "./hiddenFallbackService": { startHiddenSearch: async () => [], resolveHiddenFromGroups: async () => null, resolveHiddenFallback: async () => null },
    "@/services/crossSourceFallbackService": { findTxVariants: async () => [], describeCrossSourceFailure: () => "无替代歌曲" },
    "@/stores/playbackSettingsStore": { usePlaybackSettingsStore: { getState: () => ({ defaultQuality: "320k" }) } },
    "./cacheService": { CACHEABLE_AUDIO_SOURCES: new Set(), getCachedLyrics: async () => [], cacheCover: async () => {}, cacheLyrics: async () => {} },
    "@/services/logger": { logger: { info() {}, warn() {}, error() {} } },
  });
  const store = load("src/stores/playerStore.ts").usePlayerStore;
  const service = load("src/services/playerService.ts");
  return { store, service, recommendations, written, load };
}

/** 启动 FM 并连切到第 played 首；hasMore=false 时不会触发后台补拉。 */
async function startFm(h, songIds, played, hasMore = false) {
  await h.service.startPersonalFmWithSongs(songIds.map(song), hasMore);
  for (let step = 1; step < played; step += 1) await h.service.playNext();
}

test("FM 上下文只存缓冲，批次由 queue / currentIndex 表达", options, async () => {
  const h = setup();
  await startFm(h, ["A", "B", "C", "D"], 2);
  const state = h.store.getState();
  assert.deepEqual(Object.keys(state.playbackContext).sort(), ["buffer", "hasMore", "type"]);
  assert.equal(state.playbackContext.type, "personalFm");
  assert.equal(ids(state.queue), "A,B");
  assert.equal(state.currentIndex, 1);
  assert.equal(state.currentSong.id, "B");
  assert.equal(ids(state.playbackContext.buffer), "C,D");
});

test("FM 中从队列移除已播曲目后切下一首，被移除的歌不会回到队列", options, async () => {
  const h = setup();
  await startFm(h, ["A", "B", "C", "D"], 3);
  h.store.getState().removeFromQueue(0);
  assert.equal(ids(h.store.getState().queue), "B,C");
  assert.equal(h.store.getState().currentIndex, 1);

  await h.service.playNext();
  const state = h.store.getState();
  assert.equal(state.currentSong.id, "D");
  assert.equal(ids(state.queue), "B,C,D", "FM 续批必须接在当前队列后面，而不是用移除前的批次重建");
  assert.equal(state.currentIndex, 2);
  assert.equal(state.playbackContext.type, "personalFm");
});

test("FM 中移除队列曲目后仍可拖拽重排，不再因批次分叉被拒绝", options, async () => {
  const h = setup();
  await startFm(h, ["A", "B", "C", "D"], 3);
  h.store.getState().removeFromQueue(0);
  const queue = h.store.getState().queue;
  assert.equal(h.store.getState().reorderQueue(queue, 1, 0), "reordered");
  const state = h.store.getState();
  assert.equal(ids(state.queue), "C,B");
  assert.equal(state.currentIndex, 0);
  assert.equal(state.queue[state.currentIndex].id, state.currentSong.id);
});

test("FM 中点播队列里的历史曲目后，下一首沿队列往后走", options, async () => {
  const h = setup();
  await startFm(h, ["A", "B", "C", "D"], 3);
  await h.service.playFromQueue(0);
  assert.equal(h.store.getState().currentSong.id, "A");
  assert.equal(h.store.getState().playbackContext.type, "personalFm");

  await h.service.playNext();
  const state = h.store.getState();
  assert.equal(state.currentSong.id, "B");
  assert.equal(state.currentIndex, 1);
  assert.equal(ids(state.queue), "A,B,C", "批次内前进不消耗推荐缓冲");
  assert.equal(ids(state.playbackContext.buffer), "D");
});

test("FM 中标记不喜欢：当前曲移出队列，指针与队列保持一致", options, async () => {
  const h = setup();
  await startFm(h, ["A", "B", "C"], 2);
  h.store.getState().markCurrentPersonalFmSongSkipped();
  const state = h.store.getState();
  assert.equal(ids(state.queue), "A");
  assert.equal(state.currentIndex, 0);
  assert.equal(ids(state.playbackContext.buffer), "C");
});

for (const moved of [true, false]) {
  test("FM 后台补拉" + (moved ? "在批次指针变化后作废" : "在上下文未变时写入缓冲"), options, async () => {
    const h = setup();
    const gate = deferred();
    let requests = 0;
    h.recommendations.getPersonalFmSongs = async () => { requests += 1; return gate.promise; };
    await h.service.startPersonalFmWithSongs([song("A"), song("B")], true);
    await h.service.playNext();
    await until(() => requests === 1);
    assert.equal(h.store.getState().currentSong.id, "B");
    if (moved) h.store.getState().setPersonalFmBatchIndex(0);
    gate.resolve({ songs: [song("late")], hasMore: false });
    await flush(); await flush();
    const context = h.store.getState().playbackContext;
    assert.equal(ids(context.buffer), moved ? "" : "late");
    assert.equal(context.hasMore, moved);
    assert.equal(h.store.getState().currentIndex, moved ? 0 : 1);
  });
}

test("FM 播放时落盘的快照格式不变：批次字段由 queue / currentIndex 派生", options, async () => {
  const h = setup();
  const snapshot = h.load("src/services/playbackSnapshot.ts");
  await startFm(h, ["A", "B", "C"], 2);
  await snapshot.savePlaybackSnapshot();
  const [key, saved] = h.written.at(-1);
  assert.equal(key, "auralflow:playback-snapshot:v1");
  assert.deepEqual(Object.keys(saved).sort(), ["currentIndex", "currentSong", "duration", "isMuted", "playMode", "playbackContext", "playbackRate", "position", "previousVolume", "queue", "savedAt", "shuffleHistory", "volume"]);
  assert.deepEqual(saved.playbackContext, { type: "personalFm", currentBatch: [song("A"), song("B")], currentBatchIndex: 1, buffer: [song("C")], hasMore: false });

  // 队列面板改过队列后，落盘的批次跟着队列走，不会写出一份过期副本。
  h.store.getState().removeFromQueue(0);
  await snapshot.savePlaybackSnapshot();
  const latest = h.written.at(-1)[1];
  assert.deepEqual(latest.queue, [song("B")]);
  assert.deepEqual(latest.playbackContext, { type: "personalFm", currentBatch: [song("B")], currentBatchIndex: 0, buffer: [song("C")], hasMore: false });

  // 普通队列的上下文原样写出。
  await h.service.playQueue([song("X"), song("Y")]);
  await snapshot.savePlaybackSnapshot();
  assert.deepEqual(h.written.at(-1)[1].playbackContext, { type: "queue" });
});
