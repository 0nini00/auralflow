const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

const VISIBILITY_EVENT = "auralflow-lyric-overlay-visibility-changed";
const options = { timeout: 15000 };
const flush = () => new Promise(resolve => setImmediate(resolve));
const song = { id: "one", source: "local", name: "Song", singer: "Artist" };

function setup({ visible = false, saved = null } = {}) {
  const { create } = mobileRequire("zustand");
  const calls = [];
  const errors = [];
  const writes = [];
  const events = new Map();
  const appStateEvents = new Map();
  let nativeVisible = visible;
  let nativeState = "Playing";
  const listen = (registry, name, callback) => {
    const listeners = registry.get(name) ?? new Set();
    registry.set(name, listeners);
    listeners.add(callback);
    return { remove: () => listeners.delete(callback) };
  };
  const emit = (registry, name, event) => {
    for (const callback of registry.get(name) ?? []) callback(event);
  };
  const player = create(() => ({
    currentSong: song,
    lyrics: [{ time: 0, text: "first" }, { time: 10, text: "second" }],
    isPlaying: true,
    position: 7,
    playbackRate: 1,
  }));
  const settings = create(() => ({ chineseConversion: "off", manualOffsetMs: 0 }));
  const nativeOverlay = {
    isVisible: async () => nativeVisible,
    setNotificationButtonEnabled: async () => {},
    setLocked: async value => { calls.push(["locked", value]); },
    setLyrics: async (json, fallback) => { calls.push(["lyrics", JSON.parse(json), fallback]); },
    playLyricClock: async position => { calls.push(["play", position]); },
    setLyricClockRate: async rate => { calls.push(["rate", rate]); },
    pauseLyricClock: async position => { calls.push(position == null ? ["pause"] : ["pause", position]); },
    hide: async () => { nativeVisible = false; calls.push(["hide"]); return true; },
  };
  const native = {
    getProgress: async () => ({ position: 42 }),
    getPlaybackState: async () => ({ state: nativeState }),
    registerPlaybackService() {},
  };
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "react-native-gesture-handler": {},
    "react-native": {
      NativeModules: { LyricOverlayModule: nativeOverlay }, Platform: { OS: "android" },
      DeviceEventEmitter: { addListener: (name, callback) => listen(events, name, callback) },
      AppState: { currentState: "background", addEventListener: (name, callback) => listen(appStateEvents, name, callback) },
      AppRegistry: { registerComponent() {} },
    },
    "react-native-track-player": { __esModule: true, default: native, State: { Playing: "Playing", Paused: "Paused", Buffering: "Buffering" } },
    "@react-native-async-storage/async-storage": { getItem: async () => saved, setItem: async (key, value) => writes.push([key, value]) },
    "@/stores/playerStore": { usePlayerStore: player },
    "@/stores/lyricSettingsStore": { useLyricSettingsStore: settings },
    "@/services/lyricOverlayAppearance": { syncLyricOverlayTextAppearance: async () => {} },
    "@/services/chineseConversionService": { convertChineseText: text => text },
    "@/services/logger": { logger: { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) } },
    "./App": {}, "./app.json": { name: "AuralFlow" },
    "./src/services/globalErrorCapture": { installGlobalErrorCapture() {} },
    "./src/services/logger": { initLogger() {} },
  });
  const store = load("src/stores/lyricOverlayStore.ts").useLyricOverlayStore;
  return {
    calls, errors, writes, player, store, nativeOverlay, native, settings, load,
    start: async () => { load("index.js"); await store.getState().loadFromStorage(); await flush(); },
    toggle: value => { nativeVisible = value; emit(events, VISIBILITY_EVENT, { visible: value }); },
    resume: () => emit(appStateEvents, "change", "active"),
    setNativeState: value => { nativeState = value; },
    setNativeVisible: value => { nativeVisible = value; },
  };
}

test("后台媒体卡片开启歌词，无迷你栏挂载也同步可见状态、歌词和原生时钟", options, async () => {
  const h = setup();
  await h.start();
  assert.deepEqual(h.calls, []);
  h.toggle(true);
  await flush();
  assert.equal(h.store.getState().visible, true);
  assert.deepEqual(h.calls.find(call => call[0] === "lyrics"), ["lyrics", h.player.getState().lyrics.map(line => ({ ...line, tr: "" })), "Song - Artist"]);
  assert.ok(h.calls.some(call => call[0] === "play" && call[1] === 42));
  assert.deepEqual(h.errors, []);
});

for (const hasLyrics of [true, false]) {
  test(`覆盖安装后保留开启状态，先恢复原生窗口再锁定，歌词存在=${hasLyrics}`, options, async () => {
    const h = setup({ visible: true });
    let attached = false;
    if (!hasLyrics) h.player.setState({ lyrics: [] });
    const setLyrics = h.nativeOverlay.setLyrics;
    h.nativeOverlay.setLyrics = async (...args) => {
      await setLyrics(...args);
      attached = true;
    };
    h.nativeOverlay.setLocked = async value => {
      if (!attached) throw new Error("悬浮歌词窗口尚未创建");
      h.calls.push(["locked", value]);
    };
    await h.start();
    assert.equal(attached, true);
    assert.equal(h.calls.filter(call => call[0] === "lyrics").length, 1);
    assert.equal(h.calls.filter(call => call[0] === "locked").length, 1);
    assert.deepEqual(h.errors, []);
  });
}

test("后台关闭再开启必须重新注入已被原生服务销毁的歌词", options, async () => {
  const h = setup({ visible: true });
  await h.start();
  assert.ok(h.calls.some(call => call[0] === "lyrics"));
  h.calls.length = 0;
  h.toggle(false);
  await flush();
  assert.equal(h.store.getState().visible, false);
  h.toggle(true);
  await flush();
  assert.equal(h.calls.filter(call => call[0] === "lyrics").length, 1);
  assert.ok(h.calls.some(call => call[0] === "play" && call[1] === 42));
});

test("原生快速关开被合并为同值可见快照时仍重新注入", options, async () => {
  const h = setup({ visible: true });
  await h.start();
  h.calls.length = 0;
  h.toggle(true);
  await flush();
  assert.equal(h.calls.filter(call => call[0] === "lyrics").length, 1);
});

test("回到前台回读原生状态，并通过同一个入口恢复歌词", options, async () => {
  const h = setup();
  await h.start();
  h.setNativeVisible(true);
  h.resume();
  await flush();
  assert.equal(h.store.getState().visible, true);
  assert.equal(h.calls.filter(call => call[0] === "lyrics").length, 1);
});

test("旧 AsyncStorage 可见标记不再覆盖原生，也不随设置继续持久化", options, async () => {
  const h = setup({ saved: JSON.stringify({ visible: true, locked: true }) });
  await h.start();
  assert.equal(h.store.getState().visible, false);
  assert.equal(h.store.getState().locked, true);
  assert.deepEqual(h.calls, []);
  await h.store.getState().setLocked(false);
  assert.equal(Object.hasOwn(JSON.parse(h.writes.at(-1)[1]), "visible"), false);
});

test("迟到的原生可见读取不能覆盖更新的通知事件", options, async () => {
  const h = setup();
  await h.start();
  const gate = deferred();
  h.nativeOverlay.isVisible = () => gate.promise;
  const reading = h.store.getState().syncVisibleFromNative();
  h.toggle(true);
  gate.resolve(false);
  await reading;
  await flush();
  assert.equal(h.store.getState().visible, true);
});

test("没有迷你栏时更换同数量歌词仍同步，切歌在途不把旧词归给新歌", options, async () => {
  const h = setup({ visible: true });
  await h.start();
  h.calls.length = 0;
  h.player.setState({ currentSong: { ...song, id: "two", name: "Next" } });
  await flush();
  assert.deepEqual(h.calls.find(call => call[0] === "lyrics"), ["lyrics", [], "Next - Artist"]);
  h.calls.length = 0;
  h.player.setState({ lyrics: [{ time: 0, text: "changed" }, { time: 10, text: "second" }] });
  await flush();
  assert.equal(h.calls.find(call => call[0] === "lyrics")[1][0].text, "changed");
});

test("歌词注入迟到完成时按原生暂停状态校准，不恢复走时", options, async () => {
  const h = setup();
  await h.start();
  const gate = deferred();
  h.nativeOverlay.setLyrics = () => gate.promise;
  h.toggle(true);
  await flush();
  h.setNativeState("Paused");
  gate.resolve();
  await flush();
  assert.equal(h.calls.some(call => call[0] === "play"), false);
  assert.ok(h.calls.some(call => call[0] === "pause"));
});

test("后台歌词注入失败显式记录并呈现给应用状态", options, async () => {
  const h = setup();
  await h.start();
  h.nativeOverlay.setLyrics = async () => { throw new Error("overlay injection failure"); };
  h.toggle(true);
  await flush();
  assert.match(h.store.getState().error, /overlay injection failure/);
  assert.equal(h.errors.length, 1);
});

test("UI 仍显示播放但原生处于缓冲时，歌词注入只冻结时钟", options, async () => {
  const h = setup();
  await h.start();
  h.setNativeState("Buffering");
  h.toggle(true);
  await flush();
  assert.equal(h.calls.some(call => call[0] === "play"), false);
  assert.ok(h.calls.some(call => call[0] === "pause"));
});

test("同一歌曲的本地歌词更新即使行数不变也重新注入", options, async () => {
  const h = setup({ visible: true });
  await h.start();
  h.calls.length = 0;
  h.player.setState({ lyrics: [{ time: 0, text: "updated" }, { time: 10, text: "second" }] });
  await flush();
  assert.equal(h.calls.find(call => call[0] === "lyrics")[1][0].text, "updated");
});

test("关闭期间迟到的注入不得重启时钟，重新开启只使用当前歌词", options, async () => {
  const h = setup();
  await h.start();
  const gate = deferred();
  h.nativeOverlay.setLyrics = () => gate.promise;
  h.toggle(true);
  await flush();
  h.toggle(false);
  gate.resolve();
  await flush();
  assert.equal(h.calls.some(call => call[0] === "play"), false);
  h.nativeOverlay.setLyrics = async (json) => { h.calls.push(["lyrics", JSON.parse(json)]); };
  h.player.setState({ lyrics: [{ time: 0, text: "latest" }] });
  h.toggle(true);
  await flush();
  assert.equal(h.calls.find(call => call[0] === "lyrics")[1][0].text, "latest");
});

test("同步服务重复初始化不叠加监听，停止后移除所有订阅", options, async () => {
  const h = setup();
  await h.start();
  const { startLyricOverlaySync } = h.load("src/services/lyricOverlaySync.ts");
  const stop = startLyricOverlaySync();
  assert.equal(startLyricOverlaySync(), stop);
  h.toggle(true);
  await flush();
  assert.equal(h.calls.filter(call => call[0] === "lyrics").length, 1);
  stop();
  h.calls.length = 0;
  h.toggle(false);
  h.player.setState({ lyrics: [{ time: 0, text: "after stop" }] });
  h.resume();
  await flush();
  assert.equal(h.store.getState().visible, true);
  assert.deepEqual(h.calls, []);
});

test("修改歌词偏移立即更新原生行时间并按真实播放位置校准", options, async () => {
  const h = setup({ visible: true });
  await h.start();
  h.calls.length = 0;
  h.settings.setState({ manualOffsetMs: 250 });
  await flush();
  assert.equal(h.calls.find(call => call[0] === "lyrics")[1][0].time, -0.25);
  assert.ok(h.calls.some(call => call[0] === "play" && call[1] === 42));
});

test("旧注入的迟到错误保留日志，但不覆盖新窗口的状态", options, async () => {
  const h = setup();
  await h.start();
  const gate = deferred();
  h.nativeOverlay.setLyrics = () => gate.promise;
  h.toggle(true);
  await flush();
  h.toggle(false);
  h.nativeOverlay.setLyrics = async () => {};
  h.toggle(true);
  await flush();
  gate.reject(new Error("old window failure"));
  await flush();
  assert.equal(h.store.getState().visible, true);
  assert.equal(h.store.getState().error, null);
  assert.equal(h.errors.length, 1);
});

test("权限拒绝的原生关闭快照立即取消应用内可见标记", options, async () => {
  const h = setup({ visible: true });
  await h.start();
  h.calls.length = 0;
  h.toggle(false);
  await flush();
  assert.equal(h.store.getState().visible, false);
  assert.deepEqual(h.calls, []);
});

test("暂停在42秒时首次开启悬浮歌词，以暂停命令定位42秒且从未提前播放", options, async () => {
  const h = setup();
  await h.start();
  h.setNativeState("Paused");
  h.toggle(true);
  await flush();
  assert.ok(h.calls.some(call => call[0] === "lyrics"));
  assert.deepEqual(h.calls.filter(call => call[0] === "play" || call[0] === "pause"), [["pause", 42]]);
});

test("直接暂停桥接显式传null保留原生当前位置", options, async () => {
  const h = setup();
  const positions = [];
  h.nativeOverlay.pauseLyricClock = async position => { positions.push(position); };
  await h.load("src/services/lyricOverlayService.ts").pauseLyricOverlayClock();
  assert.deepEqual(positions, [null]);
});

test("后台倍速播放关闭再开启歌词，先恢复最新倍速再校准时钟", options, async () => {
  const h = setup({ visible: true });
  await h.start();
  h.toggle(false);
  await flush();
  h.player.setState({ playbackRate: 1.5 });
  h.calls.length = 0;
  h.toggle(true);
  await flush();
  assert.deepEqual(h.calls.filter(call => call[0] === "rate" || call[0] === "play"), [["rate", 1.5], ["play", 42]]);
});
