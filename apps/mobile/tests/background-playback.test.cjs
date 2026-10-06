const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");
const events = ["RemotePlay", "RemotePause", "RemoteStop", "RemoteNext", "RemotePrevious", "RemoteSeek", "RemoteDuck", "PlaybackActiveTrackChanged", "PlaybackQueueEnded", "PlaybackProgressUpdated", "PlaybackError"];
const DESTROYED = "auralflow-playback-service-destroyed";

function setup(config = {}) {
  const listeners = new Map();
  const calls = [];
  const queue = ["A", "B", "C", "D", "E", "F"].map(id => ({ source: "tx", id }));
  const state = { currentSong: queue[0], queue, currentIndex: 0, error: null, loading: false,
    playbackContext: { type: "queue" }, playMode: "list", tempPlayList: [], shuffleHistory: [], playedIndices: [], volume: 1 };
  const settings = { autoSkipOnPlaybackError: config.autoSkip !== false };
  const behavior = { next: async () => {}, retry: async () => {}, invalidate: async () => {} };
  const addListener = (event, callback) => {
    const entries = listeners.get(event) ?? new Set(); entries.add(callback); listeners.set(event, entries);
    return { remove: () => entries.delete(callback) };
  };
  const native = { addEventListener: addListener, getPlaybackState: async () => ({ state: "error" }), getPlayWhenReady: async () => true };
  for (const method of ["play", "pause", "stop", "seekTo", "skip", "setVolume"]) native[method] = async () => { calls.push(method); };
  let request;
  const playerService = {
    playNext(auto) {
      calls.push("playNext"); calls.push(["next", auto]);
      request.beginPlaybackRequest();
      state.currentIndex += 1;
      state.currentSong = state.queue[state.currentIndex];
      return behavior.next(state.currentSong);
    },
    playPrevious() { calls.push("playPrevious"); request.beginPlaybackRequest(); return Promise.resolve(); },
    cancelPendingPlayback() { calls.push("cancelPendingPlayback"); return request.beginPlaybackRequest(); },
    prefetchUpcomingSongNearEnd() {},
    invalidatePrefetchForSong() { calls.push("invalidatePrefetchForSong"); },
    playFromQueue() { calls.push("playFromQueue"); request.beginPlaybackRequest(); return behavior.retry(); },
    playSong() { calls.push("playSong"); request.beginPlaybackRequest(); return behavior.retry(); },
  };
  const load = createLoader({
    "react-native-track-player": { __esModule: true, default: native, State: { Error: "error" }, Event: Object.fromEntries(events.map(event => [event, event])) },
    "react-native": { DeviceEventEmitter: { addListener }, Platform: { OS: "android" } },
    "@/services/audioInterruptionPolicy": { getAudioInterruptionAction: () => ({ type: "none" }) },
    "@/services/queueNavigationModel": { getNextQueueNavigationState: () => ({ nextIndex: state.currentIndex + 1 < state.queue.length ? state.currentIndex + 1 : null }) },
    "@/stores/playbackSettingsStore": { usePlaybackSettingsStore: { getState: () => settings } },
    "@/stores/playerStore": { usePlayerStore: { getState: () => state, setState: patch => Object.assign(state, patch) },
      setupPlayerListeners: () => calls.push("setupPlayerListeners"), shouldAttributePlaybackErrorToCurrentSong: () => true, SILENCE_GAP_TRACK_ID: "gap" },
    "@/services/wakeLockService": { acquirePlaybackWakeLock: async () => calls.push("acquire"), releasePlaybackWakeLock: async () => calls.push("release") },
    "@/services/logger": { logger: { info: (...args) => calls.push(["info", ...args]), warn: (...args) => calls.push(["warn", ...args]), error: (...args) => calls.push(["error", ...args]) } },
    "@/services/playbackUrlCache": { invalidateCachedPlaybackUrl: () => { calls.push("invalidateCachedPlaybackUrl"); return behavior.invalidate(); } },
    "../services/playerService": playerService,
  });
  request = load("src/services/playbackRequest.ts");
  for (const [action, method] of [["resume", "play"], ["pause", "pause"], ["stop", "stop"]]) {
    state[action] = () => { playerService.cancelPendingPlayback(); return native[method](); };
  }
  const policy = load("src/services/playbackFailurePolicy.ts");
  const service = load("src/player/playbackService.ts");
  const emit = async (event, payload) => { await Promise.all([...(listeners.get(event) ?? [])].map(callback => callback(payload))); };
  return { service, listeners, calls, emit, playerService, state, settings, behavior, request, native, policy };
}

const options = { timeout: 5000 };
test("Headless任务保持到原生服务销毁，后台timer不能因初始化返回而停摆", options, async () => {
  const h = setup();
  let finished = false;
  const lifetime = h.service({ serviceId: "one" }).then(() => { finished = true; });
  await new Promise(setImmediate);
  assert.equal(finished, false);
  assert.ok(h.calls.includes("setupPlayerListeners"));
  await h.emit("RemoteNext");
  assert.ok(h.calls.includes("playNext"));
  await h.emit(DESTROYED, { serviceId: "one" });
  await lifetime;
  assert.equal(finished, true);
  assert.equal([...h.listeners.values()].reduce((sum, entries) => sum + entries.size, 0), 0);
});

test("同一原生实例重复启动不重复注册媒体按键或进度监听", options, async () => {
  const h = setup();
  const first = h.service({ serviceId: "one" });
  const second = h.service({ serviceId: "one" });
  await h.emit("RemoteNext");
  const count = h.calls.filter(call => call === "playNext").length;
  await h.emit(DESTROYED, { serviceId: "one" });
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test("服务重建清理旧监听，旧销毁事件不能终结新服务", options, async () => {
  const h = setup();
  const oldLifetime = h.service({ serviceId: "old" });
  const current = h.service({ serviceId: "new" });
  await oldLifetime;
  let finished = false;
  current.then(() => { finished = true; });
  await h.emit(DESTROYED, { serviceId: "old" });
  await new Promise(setImmediate);
  assert.equal(finished, false);
  await h.emit("RemoteNext");
  assert.equal(h.calls.filter(call => call === "playNext").length, 1);
  await h.emit(DESTROYED, { serviceId: "new" });
  await current;
});


function start(t, config) {
  const h = setup(config);
  const lifetime = h.service({ serviceId: "one" });
  t.after(async () => { await h.emit(DESTROYED, { serviceId: "one" }); await lifetime; });
  return h;
}
const count = (h, method) => h.calls.filter(call => call === method).length;
const flush = () => new Promise(setImmediate);

test("自然曲末解析失败后开启设置会继续下一首", options, async (t) => {
  const h = start(t);
  h.behavior.next = async song => { if (song.id === "B") throw new Error("B解析失败"); };
  await h.emit("PlaybackQueueEnded");
  assert.equal(count(h, "playNext"), 2);
  assert.equal(h.state.currentSong.id, "C");
});

test("关闭自动跳过时解析失败明确停住，通知下一首仍可用", options, async (t) => {
  const h = start(t, { autoSkip: false });
  h.behavior.next = async song => { if (song.id === "B") throw new Error("B解析失败"); };
  await h.emit("PlaybackQueueEnded");
  assert.equal(count(h, "playNext"), 1);
  assert.match(h.state.error, /B解析失败/);
  assert.equal(count(h, "stop"), 1);
  await h.emit("RemoteNext");
  assert.equal(h.state.currentSong.id, "C");
});

test("原生失败即使关闭自动跳过也重解析一次，重试拒绝不依赖第二条事件", options, async (t) => {
  const h = start(t, { autoSkip: false });
  h.behavior.retry = async () => { throw new Error("重解析拒绝"); };
  await h.emit("PlaybackError", { message: "原生403" });
  assert.equal(count(h, "playFromQueue"), 1);
  assert.equal(count(h, "playNext"), 0);
  assert.match(h.state.error, /重解析拒绝/);
  assert.equal(count(h, "stop"), 1);
});

test("重试Promise拒绝后继续有限跳过，连续失败最多跳三首", options, async (t) => {
  const h = start(t);
  h.behavior.retry = async () => { throw new Error("重试坏链"); };
  h.behavior.next = async () => { throw new Error("下一首解析失败"); };
  await h.emit("PlaybackError", { message: "原生坏链" });
  assert.equal(count(h, "playFromQueue"), 1);
  assert.equal(count(h, "playNext"), 3);
  assert.match(h.state.error, /连续.*3/);
  await h.emit("PlaybackError", { message: "迟到的重复错误" });
  assert.equal(count(h, "playNext"), 3);
  assert.equal(count(h, "playFromQueue"), 1);
});

test("同一原生错误连发只启动一次重试", options, async (t) => {
  const h = start(t);
  const gate = deferred(); h.behavior.retry = () => gate.promise;
  const first = h.emit("PlaybackError", { message: "重复403" });
  const duplicate = h.emit("PlaybackError", { message: "重复403" });
  await flush();
  assert.equal(count(h, "playFromQueue"), 1);
  gate.resolve(); await Promise.all([first, duplicate]);
  assert.equal(count(h, "playNext"), 0);
});

test("通知手动接管后旧重试拒绝不能自动跳歌或覆盖状态", options, async (t) => {
  const h = start(t);
  const gate = deferred(); h.behavior.retry = () => gate.promise;
  const pending = h.emit("PlaybackError", { message: "旧错误" });
  await flush();
  await h.emit("RemoteNext");
  h.state.error = null;
  gate.reject(new Error("迟到重试失败")); await pending;
  assert.equal(count(h, "playNext"), 1);
  assert.equal(h.state.error, null);
});

test("同一首歌的新播放意图也能废弃缓存失效中的旧恢复", options, async (t) => {
  const h = start(t);
  const gate = deferred(); h.behavior.invalidate = () => gate.promise;
  const pending = h.emit("PlaybackError", { message: "旧错误" });
  await flush();
  h.request.beginPlaybackRequest();
  gate.resolve(); await pending;
  assert.equal(count(h, "playFromQueue"), 0);
  assert.equal(count(h, "playNext"), 0);
});

test("服务销毁后迟到拒绝不修改新服务，旧finally不解除新恢复锁", options, async (t) => {
  const h = setup();
  const old = h.service({ serviceId: "old" });
  const oldGate = deferred(); h.behavior.retry = () => oldGate.promise;
  const oldError = h.emit("PlaybackError", { message: "旧错误" });
  await flush();
  await h.emit(DESTROYED, { serviceId: "old" }); await old;
  const current = h.service({ serviceId: "new" });
  t.after(async () => { await h.emit(DESTROYED, { serviceId: "new" }); await current; });
  const newGate = deferred(); h.behavior.retry = () => newGate.promise;
  const newError = h.emit("PlaybackError", { message: "新错误" });
  const duplicate = h.emit("PlaybackError", { message: "新错误" });
  await flush();
  oldGate.reject(new Error("旧服务迟到")); await oldError;
  assert.equal(count(h, "playNext"), 0);
  newGate.reject(new Error("新重试失败")); await Promise.all([newError, duplicate]);
  assert.equal(count(h, "playNext"), 1);
  assert.equal(h.state.currentSong.id, "B");
});

test("通知控制命令错误有日志和可见状态，不产生未处理拒绝", options, async (t) => {
  const h = start(t);
  h.native.play = async () => { throw new Error("无法播放"); };
  await assert.doesNotReject(h.emit("RemotePlay"));
  assert.match(h.state.error, /无法播放/);
  assert.ok(h.calls.some(call => Array.isArray(call) && ["warn", "error"].includes(call[0])));
});

test("重试加载中的新原生错误在Promise结束后只收口一次", options, async (t) => {
  const h = start(t);
  const gate = deferred(); h.behavior.retry = () => gate.promise;
  const pending = h.emit("PlaybackError", { message: "首次失败" });
  await flush();
  const nativeFailure = h.emit("PlaybackError", { message: "重试原生失败" });
  const duplicate = h.emit("PlaybackError", { message: "重试原生失败" });
  gate.resolve(); await Promise.all([pending, nativeFailure, duplicate]);
  assert.equal(count(h, "playFromQueue"), 1);
  assert.equal(count(h, "playNext"), 1);
});


test("迟到的原生错误不能重试已经正常播放的新曲", options, async (t) => {
  const h = start(t);
  h.native.getPlaybackState = async () => ({ state: "playing" });
  await h.emit("PlaybackError", { message: "旧管线迟到错误" });
  assert.equal(count(h, "playFromQueue"), 0);
  assert.equal(count(h, "playNext"), 0);
});

test("读取原生错误状态期间手动接管使旧事件失效", options, async (t) => {
  const h = start(t);
  const gate = deferred(); h.native.getPlaybackState = () => gate.promise;
  const pending = h.emit("PlaybackError", { message: "旧管线错误" });
  await h.emit("RemoteNext");
  gate.resolve({ state: "error" }); await pending;
  assert.equal(count(h, "playFromQueue"), 0);
  assert.equal(count(h, "playNext"), 1);
});

test("离开静音占位后重复曲末事件不会多跳", options, async (t) => {
  const h = start(t);
  h.behavior.next = async () => { h.state.onSilenceGap = false; };
  await h.emit("PlaybackActiveTrackChanged", { track: { id: "gap" }, lastTrack: { id: "tx-A" } });
  await h.emit("PlaybackQueueEnded");
  await h.emit("PlaybackActiveTrackChanged", { track: { id: "gap" }, lastTrack: { id: "tx-A" } });
  assert.equal(count(h, "playNext"), 1);
});

test("健康位置归还重试和跳过额度，不靠第二监听器回读处置", options, async (t) => {
  const h = start(t);
  assert.equal(h.policy.decidePlaybackFailureAction("tx:A"), "retry");
  assert.equal(h.policy.decidePlaybackFailureAction("tx:A"), "skip");
  for (let i = 0; i < 3; i += 1) h.policy.noteAutomaticSkip();
  assert.equal(h.policy.hasReachedAutoSkipLimit(), true);
  h.policy.notePlaybackHealthy("tx:A");
  assert.equal(h.policy.hasReachedAutoSkipLimit(), false);
  assert.equal(h.policy.decidePlaybackFailureAction("tx:A"), "retry");
});


for (const command of ["RemoteNext", "RemotePrevious"]) {
  test(command + "把解析抢占交给导航入口，不无条件取消原生提交", options, async (t) => {
    const h = start(t);
    await h.emit(command);
    assert.equal(count(h, "cancelPendingPlayback"), 0);
  });
}

function nativeNavigationSetup(blockAt, { autoSkip = false } = {}) {
  const gate = deferred();
  const entered = deferred();
  const calls = [];
  const listeners = new Map();
  const addListener = (event, callback) => {
    const entries = listeners.get(event) ?? new Set(); entries.add(callback); listeners.set(event, entries);
    return { remove: () => entries.delete(callback) };
  };
  let playWhenReady = true;
  let nativeState = "playing";
  const addedTracks = [];
  const native = {
    addEventListener: addListener,
    getPlayWhenReady: async () => playWhenReady,
    setPlayWhenReady: async value => { playWhenReady = value; },
    getPlaybackState: async () => ({ state: nativeState }),
    getState: async () => nativeState,
  };
  for (const method of ["setupPlayer", "updateOptions", "setRepeatMode", "getQueue", "add", "skip", "remove", "setRate", "setVolume", "play", "pause", "stop", "reset"]) {
    native[method] = async (...args) => {
      calls.push(method);
      if (method === blockAt) { entered.resolve(); await gate.promise; }
      if (method === "add") addedTracks.push(...args[0]);
      if (method === "pause") { playWhenReady = false; nativeState = "paused"; }
      if (method === "play") { playWhenReady = true; nativeState = "playing"; }
      // ExoPlayer stop 不承诺清除 playWhenReady；由调用方明确设置停止意图。
      if (method === "stop") nativeState = "stopped";
      if (method === "getQueue") return [];
    };
  }
  const coreLoad = createLoader({});
  const cache = { getCachedPlaybackUrl: async () => ({ url: "https://fixture.invalid/audio", quality: "320k" }),
    saveCachedPlaybackUrl: async () => {}, invalidateCachedPlaybackUrl: async () => {} };
  const tracker = { startListeningSession() {}, resetListeningSession() {} };
  const playlistApi = {};
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "react-native": { DeviceEventEmitter: { addListener }, AppState: { addEventListener: () => ({ remove() {} }) } },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "react-native-track-player": { __esModule: true, default: native, State: { Playing: "playing", Paused: "paused", Stopped: "stopped", Buffering: "buffering", Error: "error" }, RepeatMode: { Off: 0 },
      Event: Object.fromEntries(events.map(event => [event, event])), AppKilledPlaybackBehavior: {}, Capability: {} },
    "@lx/core": { ...coreLoad("../../packages/core/src/switch-step-queue.ts"), ...coreLoad("../../packages/core/src/playback-quality.ts"), ...coreLoad("../../packages/core/src/recommendations/heartbeat-queue.ts"), isPreviewDuration: () => false },
    "@/services/logger": { logger: { info() {}, warn() {}, error() {} } },
    "@/services/androidPitchService": { syncPlaybackParameters() {} },
    "@/services/playbackUrlCache": cache, "./playbackUrlCache": cache,
    "@/services/lyricOverlayService": { isLyricOverlaySupported: () => false },
    "@/services/listenTrackerService": tracker, "./listenTrackerService": tracker,
    "./musicApi": { getLyrics: async () => [], buildStreamHeaders: () => ({}) },
    "./wyDirectProvider": {}, "./wyPlaylistService": playlistApi, "./customSourceRuntime": {},
    "../stores/customSourceStore": {}, "./streamProbe": {}, "@/services/crossSourceFallbackService": {},
    "@/stores/playbackSettingsStore": { usePlaybackSettingsStore: { getState: () => ({ defaultQuality: "320k", autoSkipOnPlaybackError: autoSkip }) } },
    "./cacheService": { CACHEABLE_AUDIO_SOURCES: new Set(), getCachedLyrics: async () => [], cacheCover: async () => {}, cacheLyrics: async () => {} },
  });
  // 真实 service、store、播放意图和切换模型，仅替换平台/网络边界。
  const store = load("src/stores/playerStore.ts").usePlayerStore;
  const navigation = load("src/services/playerService.ts");
  const service = load("src/player/playbackService.ts");
  const tracks = ["A", "B", "C", "D"].map(id => ({ id, source: "tx", name: id, singer: "Test", interval: 100 }));
  store.getState().setQueue(tracks);
  store.setState({ currentSong: tracks[0] });
  const emit = (event, payload) => Promise.all([...(listeners.get(event) ?? [])].map(callback => callback(payload)));
  return { gate, entered, calls, navigation, service, emit, store, cache, playlistApi, native, addedTracks };
}

for (const nativeMethod of ["add", "skip"]) {
  test("真实导航在原生" + nativeMethod + "未返回时合并通知下一首，不并发改队列", options, async () => {
    const h = nativeNavigationSetup(nativeMethod);
    const lifetime = h.service({ serviceId: "native-commit" });
    const first = h.navigation.playNext();
    let command;
    try {
      await h.entered.promise;
      command = h.emit("RemoteNext");
      await flush();
      assert.equal(count(h, nativeMethod), 1);
    } finally {
      h.gate.resolve();
      await Promise.all([first, command]);
      await h.emit(DESTROYED, { serviceId: "native-commit" });
      await lifetime;
    }
    assert.equal(h.store.getState().currentSong.id, "C");
  });
}


for (const mode of ["personalFm", "heartbeat"]) {
  for (const autoSkip of [true, false]) {
    test(mode + "续批成功后B解析失败，" + (autoSkip ? "开启跳过继续C" : "关闭跳过明确停在B"), options, async (t) => {
      const h = nativeNavigationSetup("never", { autoSkip });
      const tracks = ["B", "C"].map(id => ({ id, source: "tx", name: id, singer: "Test", interval: 100 }));
      let refillCount = 0;
      const refill = async () => { refillCount += 1; return refillCount === 1 ? tracks : []; };
      h.playlistApi.getPersonalFmSongs = async () => ({ songs: await refill(), hasMore: false });
      h.playlistApi.getHeartbeatModeList = refill;
      const parsed = [];
      h.cache.getCachedPlaybackUrl = async song => {
        parsed.push(song.id);
        if (song.id === "B") throw new Error("B解析失败");
        return { url: "https://fixture.invalid/audio", quality: "320k" };
      };
      const a = h.store.getState().currentSong;
      const context = { currentBatch: [a], currentBatchIndex: 0, buffer: [], hasMore: true };
      if (mode === "personalFm") h.store.getState().setPersonalFmContext(context);
      else h.store.getState().setHeartbeatContext({ ...context, seedSongId: "A", playlistId: "fixture-list" });
      h.store.setState({ onSilenceGap: true });
      const lifetime = h.service({ serviceId: "refill-recovery" });
      t.after(async () => { await h.emit(DESTROYED, { serviceId: "refill-recovery" }); await lifetime; });
      await h.emit("PlaybackQueueEnded");
      assert.ok(refillCount >= 1);
      assert.ok(parsed.includes("B"));
      assert.equal(h.store.getState().playbackContext.type, mode);
      if (autoSkip) {
        assert.equal(h.store.getState().currentSong.id, "C");
        assert.ok(parsed.includes("C"));
        assert.equal(count(h, "play"), 1);
        assert.equal(count(h, "stop"), 0);
      } else {
        assert.equal(h.store.getState().currentSong.id, "B");
        assert.equal(parsed.includes("C"), false);
        assert.match(h.store.getState().error, /B解析失败.*自动跳过已关闭/);
        assert.equal(count(h, "stop"), 1);
      }
    });
  }
}


async function startTransportFixture(t) {
  const h = nativeNavigationSetup("never");
  const lifetime = h.service({ serviceId: "transport-intent" });
  t.after(async () => { await h.emit(DESTROYED, { serviceId: "transport-intent" }); await lifetime; });
  await h.navigation.playFromQueue(0);
  return h;
}

async function holdNextResolution(t, h) {
  const gate = deferred();
  const entered = deferred();
  const get = h.cache.getCachedPlaybackUrl;
  h.cache.getCachedPlaybackUrl = song => {
    if (song.id !== "B") return get(song);
    entered.resolve();
    return gate.promise;
  };
  const pending = h.emit("PlaybackActiveTrackChanged", {
    track: { id: "__auralflow_silence_gap__" }, lastTrack: { id: "tx-A" },
  });
  t.after(async () => { gate.resolve({ url: "https://fixture.invalid/late-B", quality: "320k" }); await pending; });
  await entered.promise;
  return { pending };
}

for (const transport of ["RemotePause", "RemoteStop", "pause", "stop"]) {
  test(transport + "取消解析后迟到曲末不能重新开播，加载态必须收口", options, async t => {
    const h = await startTransportFixture(t);
    await holdNextResolution(t, h);
    assert.equal(h.store.getState().currentSong.id, "B");
    if (transport.startsWith("Remote")) await h.emit(transport);
    else await h.store.getState()[transport]();
    await flush();
    const plays = count(h, "play");
    await h.emit("PlaybackQueueEnded");
    assert.equal(count(h, "play"), plays);
    assert.equal(h.store.getState().currentSong.id, "B");
    assert.equal(h.store.getState().loading, false);
    assert.equal(h.store.getState().currentUrl, null);
    assert.equal(await h.native.getPlayWhenReady(), false);
  });
}

for (const transport of ["RemotePlay", "resume"]) {
  test(transport + "恢复取消的B时重新装载B而非续播旧A", options, async t => {
    const h = await startTransportFixture(t);
    await holdNextResolution(t, h);
    await h.emit("RemotePause");
    h.cache.getCachedPlaybackUrl = async song => ({ url: "https://fixture.invalid/" + song.id, quality: "320k" });
    if (transport === "RemotePlay") await h.emit(transport);
    else await h.store.getState().resume();
    assert.equal(h.addedTracks.filter(track => track.id === "tx-B").length, 1);
    assert.equal(h.store.getState().currentUrl, "https://fixture.invalid/B");
    assert.equal(h.store.getState().isPlaying, true);
  });

  test(transport + "正常暂停续播保留当前原生曲目和进度", options, async t => {
    const h = await startTransportFixture(t);
    h.store.setState({ position: 37 });
    await h.emit("RemotePause");
    const url = h.store.getState().currentUrl;
    if (transport === "RemotePlay") await h.emit(transport);
    else await h.store.getState().resume();
    assert.equal(count(h, "add"), 1);
    assert.equal(count(h, "skip"), 1);
    assert.equal(h.store.getState().position, 37);
    assert.equal(h.store.getState().currentUrl, url);
    assert.equal(h.store.getState().isPlaying, true);
  });
}

for (const event of ["PlaybackQueueEnded", "PlaybackError"]) {
  test(event + "尊重原生关闭的playWhenReady而不自动恢复", options, async t => {
    const h = start(t);
    h.native.getPlayWhenReady = async () => false;
    await h.emit(event, { message: "迟到错误" });
    assert.equal(count(h, "playNext"), 0);
    assert.equal(count(h, "playFromQueue"), 0);
    assert.equal(count(h, "invalidateCachedPlaybackUrl"), 0);
  });

  test(event + "异步读取播放意图期间暂停使旧事件失效", options, async t => {
    const h = start(t);
    const gate = deferred();
    h.native.getPlayWhenReady = () => gate.promise;
    const pending = h.emit(event, { message: "旧错误" });
    await flush();
    await h.emit("RemotePause");
    gate.resolve(true);
    await pending;
    assert.equal(count(h, "playNext"), 0);
    assert.equal(count(h, "playFromQueue"), 0);
  });
}

test("缓存失效等待期间原生停止播放意图，不再启动重解析", options, async t => {
  const h = start(t);
  const gate = deferred();
  h.behavior.invalidate = () => gate.promise;
  const pending = h.emit("PlaybackError", { message: "原生错误" });
  await flush();
  h.native.getPlayWhenReady = async () => false;
  gate.resolve();
  await pending;
  assert.equal(count(h, "playFromQueue"), 0);
});


test("暂停后恢复未完成装载时等待旧native提交，不交错add", options, async () => {
  const h = nativeNavigationSetup("add");
  const lifetime = h.service({ serviceId: "resume-native-commit" });
  const first = h.navigation.playNext();
  let resumed;
  let addsBeforeRelease;
  try {
    await h.entered.promise;
    await h.emit("RemotePause");
    resumed = h.emit("RemotePlay");
    await flush();
    addsBeforeRelease = count(h, "add");
  } finally {
    h.gate.resolve();
    await Promise.all([first, resumed]);
    await h.emit(DESTROYED, { serviceId: "resume-native-commit" });
    await lifetime;
  }
  assert.equal(addsBeforeRelease, 1);
  assert.equal(h.store.getState().currentSong.id, "B");
  assert.equal(count(h, "play"), 1);
});
