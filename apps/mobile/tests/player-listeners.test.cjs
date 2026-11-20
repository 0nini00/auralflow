const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

// 前台播放器监听分两层：playerStore 的状态同步，与 player/playerListeners 的进度处置
// （曲末预读、健康记账、试听兜底）。这里用真实 store 与真实监听模块锁住两层的先后与职责。
const song = { id: "one", source: "tx", name: "Song", singer: "Artist", albumName: "", interval: 300 };
const options = { timeout: 20000 };

function setup(options = {}) {
  const listeners = new Map();
  const calls = [];
  const native = {
    addEventListener: (event, callback) => {
      const entries = listeners.get(event) ?? []; entries.push(callback); listeners.set(event, entries);
      return { remove() {} };
    },
    getQueue: async () => [], getState: async () => "playing",
  };
  for (const name of ["setupPlayer", "updateOptions", "setRepeatMode", "add", "skip", "remove", "setRate", "setVolume", "play", "pause", "stop", "seekTo"]) {
    native[name] = async () => { calls.push(["native", name]); };
  }
  const prefetchSeen = [];
  let store;
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    "react-native-track-player": { __esModule: true, default: native, State: { Playing: "playing", Paused: "paused", Stopped: "stopped", Buffering: "buffering" },
      Event: Object.fromEntries(["PlaybackProgressUpdated", "PlaybackState", "PlaybackActiveTrackChanged", "PlaybackError"].map(name => [name, name])),
      RepeatMode: { Off: 0 }, AppKilledPlaybackBehavior: {}, Capability: {} },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "@/services/logger": { logger: { info() {}, warn() {}, error() {} } },
    "@/services/androidPitchService": {},
    "@/services/lyricOverlayService": { isLyricOverlaySupported: () => false },
    "@/services/lyricOverlayPlayback": { syncLyricOverlayPlaybackClock: async () => {} },
    "@/services/listenTrackerService": { startListeningSession() {}, resetListeningSession() {}, onPlaybackProgress() {}, seekListeningSession() {}, flushListeningSession: async () => {} },
    "@/services/playbackFailurePolicy": { notePlaybackHealthy: (key) => { calls.push(["healthy", key]); } },
    "../services/playerService": {
      notePlaybackCandidateHealthy() {},
      recoverCurrentSongPlayback: async (...args) => { calls.push(["recover", ...args]); if (options.recoveryError) throw new Error(options.recoveryError); },
      // 记录预读被调用那一刻 store 里的进度：证明状态同步层先于处置层。
      prefetchUpcomingSongNearEnd: (position, duration) => { prefetchSeen.push({ position, duration, storePosition: store.getState().position }); },
      invalidateResolvedPlayback: async (track, options) => { calls.push(["invalidate", track.id, options]); },
    },
  });
  store = load("src/stores/playerStore.ts").usePlayerStore;
  const { setupPlayerListeners } = load("src/player/playerListeners.ts");
  const emit = (event, payload) => { for (const listener of listeners.get(event) ?? []) listener(payload); };
  const named = (name) => calls.filter(call => call[0] === name);
  return { store, setupPlayerListeners, listeners, emit, calls, named, prefetchSeen, load };
}

test("重复注册不叠加监听", options, () => {
  const h = setup();
  h.setupPlayerListeners();
  const registered = [...h.listeners.values()].reduce((sum, entries) => sum + entries.length, 0);
  h.setupPlayerListeners();
  assert.equal([...h.listeners.values()].reduce((sum, entries) => sum + entries.length, 0), registered);
  assert.equal(h.listeners.get("PlaybackProgressUpdated").length, 2, "进度事件：状态同步一条 + 处置一条");
});

test("进度事件先写入 store，再做曲末预读与健康记账", options, async () => {
  const h = setup();
  h.setupPlayerListeners();
  await h.store.getState().play(song, "https://fixture.invalid/one");
  h.emit("PlaybackProgressUpdated", { position: 295, duration: 300, buffered: 300 });
  assert.equal(h.store.getState().position, 295);
  assert.deepEqual(h.prefetchSeen, [{ position: 295, duration: 300, storePosition: 295 }]);
  assert.deepEqual(h.named("healthy"), [["healthy", "tx:one"]]);
  assert.equal(h.store.getState().error, null);
});

test("静音占位轨期间的进度既不写 store 也不触发处置", options, async () => {
  const h = setup();
  h.setupPlayerListeners();
  await h.store.getState().play(song, "https://fixture.invalid/one");
  h.store.setState({ position: 120, onSilenceGap: true });
  // 占位轨时长远短于歌曲时长：若不忽略，会被当成试听片段处置。
  h.emit("PlaybackProgressUpdated", { position: 6, duration: 15, buffered: 15 });
  assert.equal(h.store.getState().position, 120);
  assert.deepEqual(h.prefetchSeen, []);
  assert.deepEqual(h.named("healthy"), []);
  assert.deepEqual(h.named("deleteAudio"), []);
  assert.equal(h.store.getState().error, null);
});

test("原生时长显示试听时只发起一次同歌曲换源，不先暂停播放意图", options, async () => {
  const h = setup();
  h.setupPlayerListeners();
  await h.store.getState().play(song, "https://fixture.invalid/one");
  const pausesBefore = h.calls.filter(call => call[0] === "native" && call[1] === "pause").length;
  for (const position of [1, 1.25, 1.5]) h.emit("PlaybackProgressUpdated", { position, duration: 30, buffered: 30 });
  assert.equal(h.calls.filter(call => call[0] === "native" && call[1] === "pause").length, pausesBefore);
  assert.equal(h.named("recover").length, 1);
  assert.deepEqual(h.named("recover")[0][2], { rejectPreview: true });

  // 用户手动重试：新的播放会话重新允许检测（防缓存命中后漏网）。
  h.load("src/services/playbackRequest.ts").beginPlaybackRequest();
  await h.store.getState().play(song, "https://fixture.invalid/one-again");
  h.emit("PlaybackProgressUpdated", { position: 1, duration: 30, buffered: 30 });
  assert.equal(h.named("recover").length, 2);
});

test("试听换源预算已经耗尽时必须真实暂停原生播放", options, async () => {
  const h = setup({ recoveryError: "同歌曲换源预算耗尽" });
  h.setupPlayerListeners();
  await h.store.getState().play(song, "https://fixture.invalid/expired-preview");
  h.emit("PlaybackProgressUpdated", { position: 1, duration: 30, buffered: 30 });
  await new Promise(setImmediate);
  assert.ok(h.calls.some(call => call[0] === "native" && call[1] === "pause"));
  assert.equal(h.store.getState().isPlaying, false);
  assert.match(h.store.getState().error, /换源预算耗尽/);
});

test("首个原生进度已超过五秒的试听也不能归还健康额度", options, async () => {
  const h = setup();
  h.setupPlayerListeners();
  await h.store.getState().play(song, "https://fixture.invalid/preview");
  h.emit("PlaybackProgressUpdated", { position: 6, duration: 30, buffered: 30 });
  assert.equal(h.named("healthy").length, 0);
  assert.equal(h.named("recover").length, 1);
});
