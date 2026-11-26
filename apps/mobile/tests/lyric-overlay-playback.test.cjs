const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

// 歌曲身份键使用 core 的真实实现。
const { buildSongKey } = createLoader({})("../../packages/core/src/song-variant.ts");
const State = Object.fromEntries(["None", "Ready", "Playing", "Paused", "Stopped", "Buffering", "Loading", "Ended", "Error"].map(s => [s, s]));
// 上限只是 runner 的安全网，不是断言：本文件的用例回读原生状态并推进挂钟，墙钟时间只反映机器
// 速度。5000ms 在并发跑整个套件时会把它判成超时（实测 8.6s），断言本身与耗时无关。
const options = { timeout: 15000 };

function setup() {
  const calls = [];
  const errors = [];
  let nativeState = State.Playing;
  const native = {
    getProgress: async () => ({ position: 42, duration: 100, buffered: 80 }),
    getPlaybackState: async () => ({ state: nativeState }),
  };
  const overlay = {
    isLyricOverlaySupported: () => true,
    playLyricOverlayClock: async position => { calls.push(["play", position]); },
    pauseLyricOverlayClock: async position => { calls.push(position == null ? ["pause"] : ["pause", position]); },
  };
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "react-native": {},
    "react-native-track-player": { __esModule: true, default: native, State, Event: {}, RepeatMode: {} },
    "@react-native-async-storage/async-storage": {},
    "@lx/core": { buildSongKey },
    "@/services/logger": { logger: { warn: (...args) => errors.push(args), error: (...args) => errors.push(args) } },
    "@/services/androidPitchService": {},
    "@/services/playbackUrlCache": {},
    "@/services/playbackFailurePolicy": {},
    "@/services/switchStepSession": { cancelPendingPlayback: () => load("src/services/playbackRequest.ts").beginPlaybackRequest() },
    "@/services/lyricOverlayService": overlay,
    "@/services/listenTrackerService": { startListeningSession() {}, resetListeningSession() {}, onPlaybackProgress() {}, seekListeningSession() {}, flushListeningSession: async () => {} },
  });
  return { load, native, overlay, calls, errors, setNativeState: state => { nativeState = state; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const state of [State.Paused, State.Stopped, State.Buffering, State.Loading, State.Ended, State.Error, State.Ready, State.None]) {
  test(`原生 ${state} 事件始终冻结悬浮歌词，不依赖 UI isPlaying 是否变化`, options, async () => {
    const h = setup();
    const store = h.load("src/stores/playerStore.ts").usePlayerStore;
    store.setState({ isPlaying: state === State.Buffering, position: 7 });
    h.setNativeState(state);
    store.getState().syncPlayerState(state);
    await flush();
    assert.deepEqual(h.calls, [["pause"]]);
    assert.deepEqual(h.errors, []);
  });
}

test("缓冲恢复或重复 Playing 事件仍校准，使用原生进度而非过期 UI 位置", options, async () => {
  const h = setup();
  const store = h.load("src/stores/playerStore.ts").usePlayerStore;
  store.setState({ isPlaying: true, position: 7 });
  store.getState().syncPlayerState(State.Playing);
  await flush();
  assert.deepEqual(h.calls, [["play", 42]]);
});

test("暂停操作在迟到原生事件到达前就冻结时钟", options, async () => {
  const h = setup();
  const store = h.load("src/stores/playerStore.ts").usePlayerStore;
  store.setState({ isPlaying: true });
  await store.getState().pause();
  await flush();
  assert.equal(store.getState().isPlaying, false);
  assert.deepEqual(h.calls, [["pause"]]);
});

for (const state of [State.Paused, State.Buffering, State.Ended]) {
  test(`歌词注入或前台校准迟到时回读原生 ${state}，不得重启`, options, async () => {
    const h = setup();
    h.setNativeState(state);
    await h.load("src/services/lyricOverlayPlayback.ts").syncLyricOverlayPlaybackClock();
    assert.deepEqual(h.calls, [["pause", 42]]);
  });
}

for (const stage of ["getProgress", "getPlaybackState"]) {
  test(`等待 ${stage} 时暂停使旧校准失效`, options, async () => {
    const h = setup();
    const gate = deferred();
    const entered = deferred();
    h.native[stage] = () => { entered.resolve(); return gate.promise; };
    const { syncLyricOverlayPlaybackClock: sync } = h.load("src/services/lyricOverlayPlayback.ts");
    const pending = sync();
    await entered.promise;
    await sync(State.Paused);
    gate.resolve(stage === "getProgress" ? { position: 42 } : { state: State.Playing });
    await pending;
    assert.deepEqual(h.calls, [["pause"]]);
  });
}

test("原生时钟错误可见，不能吞掉桥接拒绝", options, async () => {
  const h = setup();
  h.overlay.pauseLyricOverlayClock = async () => { throw new Error("overlay bridge failure"); };
  const sync = h.load("src/services/lyricOverlayPlayback.ts").syncLyricOverlayPlaybackClock;
  await assert.rejects(sync(State.Paused), /overlay bridge failure/);
  const store = h.load("src/stores/playerStore.ts").usePlayerStore;
  store.getState().syncPlayerState(State.Paused);
  await flush();
  assert.equal(h.errors.length, 1);
});
