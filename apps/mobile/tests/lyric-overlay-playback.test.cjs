const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

const State = Object.fromEntries(["None", "Ready", "Playing", "Paused", "Stopped", "Buffering", "Loading", "Ended", "Error"].map(s => [s, s]));
const options = { timeout: 5000 };

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
    pauseLyricOverlayClock: async () => { calls.push(["pause"]); },
  };
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "react-native": {},
    "react-native-track-player": { __esModule: true, default: native, State, Event: {}, RepeatMode: {} },
    "@react-native-async-storage/async-storage": {},
    "@lx/core": {},
    "@/services/logger": { logger: { warn: (...args) => errors.push(args), error: (...args) => errors.push(args) } },
    "@/services/androidPitchService": {},
    "@/services/playbackUrlCache": {},
    "@/services/playbackFailurePolicy": {},
    "../services/playerService": { cancelPendingPlayback: () => load("src/services/playbackRequest.ts").beginPlaybackRequest() },
    "@/services/lyricOverlayService": overlay,
    "@/services/listenTrackerService": { resetListeningSession() {} },
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
    assert.deepEqual(h.calls, [["pause"]]);
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

function loadMiniLyricStatus(h, store, setLyrics) {
  const fs = require("node:fs");
  const path = require("node:path");
  const { mobileRoot } = require("./helpers/loadTs.cjs");
  const ts = mobileRequire("typescript");
  const effects = [];
  const refs = [];
  let refIndex = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useCallback: callback => callback,
    useRef: current => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
    useEffect: effect => effects.push(effect),
  };
  const mocks = {
    react,
    "react-native": { StyleSheet: { create: styles => styles }, Text: "Text" },
    "lucide-react-native": {},
    "@/components/CachedImage": {}, "@/components/MiniProgressBar": {},
    "@/components/IconButton": {}, "@/components/Touchable": {},
    "@/services/lyricOverlayService": { ...h.overlay, setLyricOverlayLyrics: setLyrics },
    "@/services/lyricOverlayPlayback": h.load("src/services/lyricOverlayPlayback.ts"),
    "@/services/logger": { logger: { warn: (...args) => h.errors.push(args) } },
    "@lx/core": { shouldCalibrateClock: () => true },
    "@/services/playerService": {}, "@/services/playerQueueModel": {},
    "@/services/chineseConversionService": { convertChineseText: text => text },
    "@/components/QueueModal": {}, "@/stores/lyricOverlayStore": {},
    "@/stores/lyricSettingsStore": { useLyricSettingsStore: selector => selector({ manualOffsetMs: 0, chineseConversion: "none" }) },
    "@/hooks/useLyricLineIndex": { useLyricLineIndex: () => 0 },
    "@/stores/playerStore": { usePlayerStore: Object.assign(selector => selector(store.getState()), { getState: store.getState }) },
    "@/services/localMediaPlaybackModel": createLoader({})("src/services/localMediaPlaybackModel.ts"),
    "@/navigation/tabLayout": {}, "@/screens/immersive/immersiveFlySource": {},
    "@/stores/themeStore": {}, "@/services/hapticService": {},
    "@/theme/tokens": { radius: {}, spacing: {}, touch: {}, typography: {} },
  };
  const filename = path.join(mobileRoot, "src/components/PlayerBar.tsx");
  const source = fs.readFileSync(filename, "utf8") + "\nexports.MiniLyricStatus = MiniLyricStatus;";
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(mocks, name), `Unmocked PlayerBar import: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return () => {
    refIndex = 0;
    module.exports.MiniLyricStatus({ overlayVisible: true, color: "#000000" });
    effects.splice(0).forEach(effect => effect());
  };
}

test("真实 PlayerBar 歌词注入在暂停后完成，不得用旧 React 快照重启时钟", options, async () => {
  const h = setup();
  const store = h.load("src/stores/playerStore.ts").usePlayerStore;
  store.setState({
    currentSong: { id: "A", source: "tx", name: "A", singer: "Test" },
    lyrics: [{ time: 0, text: "line one" }, { time: 10, text: "line two" }],
    isPlaying: true, position: 7,
  });
  const injection = deferred();
  loadMiniLyricStatus(h, store, () => injection.promise)();
  await flush();
  assert.equal(h.calls[0][0], "play");
  h.setNativeState(State.Paused);
  await store.getState().pause();
  await flush();
  h.calls.length = 0;
  injection.resolve();
  await flush();
  assert.deepEqual(h.calls, [["pause"]]);
  assert.deepEqual(h.errors, []);
});

test("真实 PlayerBar 在 UI 仍显示播放但原生缓冲时不得校准为走时", options, async () => {
  const h = setup();
  const store = h.load("src/stores/playerStore.ts").usePlayerStore;
  store.setState({ isPlaying: true });
  h.setNativeState(State.Buffering);
  loadMiniLyricStatus(h, store, async () => {})();
  await flush();
  assert.deepEqual(h.calls, [["pause"]]);
  assert.deepEqual(h.errors, []);
});


test("本地资料更新即使歌词行数相同，也重新同步悬浮歌词正文", options, async () => {
  const h = setup();
  const store = h.load("src/stores/playerStore.ts").usePlayerStore;
  store.setState({ currentSong: { id: "A", source: "local", name: "A", singer: "Test" }, lyrics: [{ time: 1, text: "旧记录" }], isPlaying: false });
  h.setNativeState(State.Paused);
  const injections = [];
  const render = loadMiniLyricStatus(h, store, async lines => { injections.push(lines); });
  render(); await flush();
  store.setState({ lyrics: [{ time: 1, text: "文件内新歌词" }] });
  render(); await flush();
  assert.equal(injections.length, 2);
  assert.equal(injections[1][0].text, "文件内新歌词");
});
