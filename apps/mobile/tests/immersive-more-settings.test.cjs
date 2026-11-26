const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

const React = mobileRequire("react");
const { act, create } = mobileRequire("react-test-renderer");
const events = ["RemotePlay", "RemotePause", "RemoteStop", "RemoteNext", "RemotePrevious", "RemoteSeek", "RemoteDuck", "PlaybackState", "PlaybackActiveTrackChanged", "PlaybackQueueEnded", "PlaybackProgressUpdated", "PlaybackError"];
const song = { source: "tx", id: "one", name: "第一首", singer: "歌手", interval: 300 };
const nextSong = { ...song, id: "two", name: "第二首" };
const palette = { surface: "#ffffff", text: "#000000", primaryInk: "#006600", border: "#cccccc" };

function fixture() {
  const calls = [];
  const alerts = [];
  const listeners = new Map();
  const appStateListeners = new Set();
  let nativeQueue = [];
  const nativePlayback = { track: null, position: 0, state: "playing" };
  let playWhenReady = true;
  const emit = async (event, payload) => { for (const listener of listeners.get(event) ?? []) await listener(payload); };
  const addListener = (event, listener) => {
    const entries = listeners.get(event) ?? new Set();
    entries.add(listener); listeners.set(event, entries);
    return { remove: () => entries.delete(listener) };
  };
  const native = { addEventListener: addListener, getQueue: async () => [...nativeQueue], getPlayWhenReady: async () => playWhenReady,
    getState: async () => nativePlayback.state };
  for (const method of ["setupPlayer", "updateOptions", "setRepeatMode", "add", "skip", "remove", "setRate", "setVolume", "play", "pause", "stop", "seekTo", "setPlayWhenReady"]) {
    native[method] = async (...args) => {
      calls.push([method, ...args]);
      if (method === "add") nativeQueue.push(...args[0]);
      if (method === "remove") nativeQueue = nativeQueue.filter((_track, index) => !args[0].includes(index));
      if (method === "skip") {
        const lastTrack = nativePlayback.track;
        nativePlayback.track = nativeQueue[args[0]];
        nativePlayback.position = args[1] ?? 0;
        await emit("PlaybackActiveTrackChanged", { track: nativePlayback.track, lastTrack });
      }
      if (method === "seekTo") nativePlayback.position = args[0];
      if (method === "pause" || method === "stop") { playWhenReady = false; nativePlayback.state = method === "pause" ? "paused" : "stopped"; }
      if (method === "play") { playWhenReady = true; nativePlayback.state = "playing"; }
      if (method === "setPlayWhenReady") playWhenReady = args[0];
    };
  }
  let player;
  let request;
  const navigation = {
    playNext: async () => { calls.push(["resolveNext"]); await player.getState().play(nextSong, "file:two"); },
    playPrevious: async () => {}, resumePlayback: async () => {},
    loadLyricsForRestoredSong: async () => {}, prefetchUpcomingSongNearEnd() {}, notePlaybackCandidateHealthy() {},
  };
  const load = createLoader({
    react: React,
    zustand: mobileRequire("zustand"),
    "zustand/middleware": mobileRequire("zustand/middleware"),
    "opencc-js": mobileRequire("opencc-js"),
    "react-native": {
      ...Object.fromEntries(["View", "Text", "Pressable", "ScrollView", "TextInput"].map(name => [name, name])),
      StyleSheet: { create: styles => styles, hairlineWidth: 1 },
      Alert: { alert: (...args) => alerts.push(args) },
      AppState: { addEventListener: (_event, listener) => { appStateListeners.add(listener); return { remove: () => appStateListeners.delete(listener) }; } }, DeviceEventEmitter: { addListener },
    },
    "react-native-track-player": { __esModule: true, default: native,
      State: { Playing: "playing", Paused: "paused", Stopped: "stopped", Error: "error" },
      Event: Object.fromEntries(events.map(event => [event, event])), RepeatMode: { Off: 0 }, Capability: {}, AppKilledPlaybackBehavior: {} },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24, bottom: 16 }) },
    "lucide-react-native": Object.fromEntries(["Check", "Clock", "Gauge", "Music2", "Volume2", "VolumeX"].map(name => [name, name])),
    "@/services/logger": { logger: { info() {}, warn() {}, error() {} } },
    "@/services/lyricOverlayService": { isLyricOverlaySupported: () => false },
    "@/services/lyricOverlayPlayback": { syncLyricOverlayPlaybackClock: async () => {} },
    "@/services/listenTrackerService": { startListeningSession() {}, resetListeningSession() {}, onPlaybackProgress() {}, seekListeningSession() {}, flushListeningSession: async () => {} },
    "@/services/switchStepSession": { cancelPendingPlayback: () => request.beginPlaybackRequest() },
    "@/services/audioInterruptionPolicy": { getAudioInterruptionAction: () => ({ type: "none" }) },
    "@/stores/playbackSettingsStore": { usePlaybackSettingsStore: { getState: () => ({ autoSkipOnPlaybackError: false }) } },
    "@/services/playerService": navigation, "../services/playerService": navigation,
    "@/hooks/useLyricLineIndex": { useLyricLineIndex: () => 0 },
    "@/services/shareMusicService": {}, "@/services/downloadService": {},
    "@/stores/lyricOverlayStore": { useLyricOverlayStore: selector => selector({ visible: false }) },
    "@/stores/favoritesStore": { useFavoritesStore: selector => selector({ isFavorite: () => false }) },
    "@/stores/downloadStore": { useDownloadStore: selector => selector({}) },
    "@/stores/themeStore": { useThemeStore: selector => selector({ mode: "dark", systemTheme: "dark" }), getResolvedTheme: mode => mode, getThemePalette: () => palette },
    "@/navigation/navigationRef": {}, "@/services/hapticService": { hapticLight() {} }, "@/components/ui/Toast": {},
    "@/components/SheetFrame": { SheetFrame: "SheetFrame" },
    "@/components/QueueModal": { QueueModal: "QueueModal" },
    "@/components/Touchable": { Touchable: "Touchable" },
  });
  request = load("src/services/playbackRequest.ts");
  const storeModule = load("src/stores/playerStore.ts");
  player = storeModule.usePlayerStore;
  player.setState({ currentSong: song, currentUrl: "file:one", isPlaying: true, queue: [song, nextSong], currentIndex: 0, lyrics: [{ time: 0, text: "歌词" }] });
  const finishSong = async () => {
    const lastTrack = nativePlayback.track;
    nativePlayback.track = nativeQueue.find(track => track.id === storeModule.SILENCE_GAP_TRACK_ID);
    nativePlayback.position = 0;
    await emit("PlaybackActiveTrackChanged", { track: nativePlayback.track, lastTrack });
  };
  return { load, player, calls, alerts, native, nativePlayback, finishSong, emit, appState: state => { for (const listener of appStateListeners) listener(state); }, gapId: storeModule.SILENCE_GAP_TRACK_ID };
}

async function startService(t, mode = "single") {
  const h = fixture();
  await h.player.getState().play(song, "file:one");
  h.player.setState({ playMode: mode });
  const service = h.load("src/player/playbackService.ts");
  const lifetime = service({ serviceId: "sleep-test" });
  t.after(async () => {
    h.player.getState().cancelSleepTimer();
    await h.emit("auralflow-playback-service-destroyed", { serviceId: "sleep-test" });
    await lifetime;
  });
  h.calls.length = 0;
  return h;
}

for (const mode of ["single", "list", "sequence", "shuffle"]) {
  test(`${mode} 模式听完一首后直接暂停，不能解析或播放下一首`, async t => {
    const h = await startService(t, mode);
    h.player.getState().startSongSleepTimer(1);
    await h.finishSong();
    assert.equal(h.player.getState().sleepTimerSongActive, false);
    assert.equal(h.player.getState().sleepTimerSongCount, 0);
    assert.equal(h.player.getState().isPlaying, false);
    assert.equal(h.player.getState().currentSong.id, "one");
    assert.equal(h.calls.some(([name]) => ["resolveNext", "play", "skip", "add"].includes(name)), false);
    assert.equal(h.calls.filter(([name]) => name === "pause").length, 1);
    await h.emit("PlaybackQueueEnded", {});
    assert.equal(h.calls.filter(([name]) => name === "pause").length, 1);
  });
}

test("单曲循环每次播完消耗一首，第二次播完停止", async t => {
  const h = await startService(t);
  h.player.getState().startSongSleepTimer(2);
  await h.finishSong();
  assert.equal(h.player.getState().sleepTimerSongCount, 1);
  assert.equal(h.player.getState().isPlaying, true);
  await h.emit("PlaybackQueueEnded", {});
  assert.equal(h.player.getState().sleepTimerSongCount, 1);
  await h.finishSong();
  assert.equal(h.player.getState().sleepTimerSongCount, 0);
  assert.equal(h.player.getState().isPlaying, false);
});

test("歌曲定时暂停后重新播放真实歌曲，不续播静音占位轨", async t => {
  const h = await startService(t);
  h.player.getState().startSongSleepTimer(1);
  await h.finishSong();
  assert.equal(h.nativePlayback.track.id, h.gapId);
  h.calls.length = 0;
  await h.player.getState().resumeTransport();
  assert.equal(h.nativePlayback.track.id, "tx-one");
  assert.equal(h.nativePlayback.position, 0);
  assert.equal(h.nativePlayback.state, "playing");
  assert.equal(h.player.getState().position, 0);
  assert.equal(h.player.getState().onSilenceGap, false);
  assert.equal(h.calls.some(([name]) => name === "add"), false);
});

test("歌曲定时暂停后拖动映射到真实歌曲，随后续播保留目标位置", async t => {
  const h = await startService(t);
  h.player.getState().startSongSleepTimer(1);
  await h.finishSong();
  await h.player.getState().seekTo(42);
  assert.equal(h.nativePlayback.track.id, "tx-one");
  assert.equal(h.nativePlayback.position, 42);
  assert.equal(h.nativePlayback.state, "paused");
  assert.equal(h.player.getState().position, 42);
  assert.equal(h.player.getState().onSilenceGap, false);
  await h.player.getState().resumeTransport();
  assert.equal(h.nativePlayback.position, 42);
  assert.equal(h.nativePlayback.state, "playing");
});

for (const method of ["skip", "seekTo"]) {
  test(`定时后恢复在 ${method} 等待期间再次暂停，迟到操作不能开播`, async t => {
    const h = await startService(t);
    h.player.getState().startSongSleepTimer(1);
    await h.finishSong();
    const gate = deferred();
    const entered = deferred();
    const original = h.native[method];
    h.native[method] = async (...args) => { entered.resolve(); await gate.promise; return original(...args); };
    h.calls.length = 0;
    const pending = h.player.getState().resumeTransport();
    try {
      const reached = await Promise.race([entered.promise.then(() => true), pending.then(() => false)]);
      assert.equal(reached, true, "恢复必须先切回真实轨并定位");
      await h.player.getState().pause();
    } finally {
      gate.resolve();
      await pending;
    }
    assert.equal(h.calls.some(([name]) => name === "play"), false);
    assert.equal(h.nativePlayback.state, "paused");
    assert.equal(h.player.getState().isPlaying, false);
  });
}

test("手动切歌和同曲重新加载不消耗听完首数", async t => {
  const h = await startService(t, "list");
  h.player.getState().startSongSleepTimer(2);
  await h.player.getState().play(nextSong, "file:two");
  await h.player.getState().play(nextSong, "file:retry-two");
  assert.equal(h.player.getState().sleepTimerSongCount, 2);
  await h.finishSong();
  assert.equal(h.player.getState().sleepTimerSongCount, 1);
});

test("单曲循环切回原曲期间与完成后的迟到 QueueEnded 不重复扣首数", async t => {
  const h = await startService(t);
  const gate = deferred();
  const entered = deferred();
  const originalSkip = h.native.skip;
  h.native.skip = async (...args) => { entered.resolve(); await gate.promise; return originalSkip(...args); };
  h.player.getState().startSongSleepTimer(2);
  const finished = h.finishSong();
  try {
    await entered.promise;
    await h.emit("PlaybackQueueEnded", {});
    assert.equal(h.player.getState().sleepTimerSongCount, 1);
  } finally {
    gate.resolve();
    await finished;
  }
  await h.emit("PlaybackQueueEnded", {});
  assert.equal(h.player.getState().sleepTimerSongCount, 1);
});

test("睡眠到期原生暂停失败必须保留明确错误，不能转入下一首恢复", async t => {
  const h = await startService(t, "list");
  h.player.getState().startSongSleepTimer(1);
  h.native.pause = async () => { throw new Error("native pause rejected"); };
  await h.finishSong();
  assert.match(h.player.getState().error ?? "", /native pause rejected/);
  assert.equal(h.calls.some(([name]) => name === "resolveNext"), false);
  await h.emit("PlaybackQueueEnded", {});
  await h.finishSong();
  assert.equal(h.calls.some(([name]) => name === "resolveNext"), false);
});

test("分钟定时按播放时长到点暂停，暂停时间不计入并可取消", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const h = await startService(t);
  h.player.getState().startSleepTimer(1);
  t.mock.timers.tick(20_000);
  h.appState("active");
  await h.player.getState().pause();
  t.mock.timers.tick(120_000);
  assert.equal(h.player.getState().sleepTimerActive, true);
  h.player.getState().syncPlayerState("playing");
  t.mock.timers.tick(39_000);
  h.appState("active");
  assert.equal(h.player.getState().sleepTimerActive, true);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.player.getState().sleepTimerActive, false);
  assert.equal(h.player.getState().isPlaying, false);
  h.player.getState().startSleepTimer(1);
  h.player.getState().cancelSleepTimer();
  h.calls.length = 0;
  t.mock.timers.tick(60_000);
  assert.equal(h.calls.some(([name]) => name === "pause"), false);
});

test("分钟定时到期暂停失败记录原因，不能吞掉原生错误", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const h = await startService(t);
  h.player.getState().startSleepTimer(1);
  h.native.pause = async () => { throw new Error("minute pause rejected"); };
  t.mock.timers.tick(60_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.match(h.player.getState().error ?? "", /minute pause rejected/);
});

function mountController(t, h) {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const warn = console.error;
  console.error = (...args) => { if (!String(args[0]).includes("react-test-renderer is deprecated")) warn(...args); };
  const { useImmersiveController } = h.load("src/screens/immersive/useImmersiveController.ts");
  const { ImmersiveModals } = h.load("src/screens/immersive/ImmersiveModals.tsx");
  let controller;
  let renderer;
  const Host = ({ visible }) => {
    controller = useImmersiveController({ visible, onClose() {} });
    return React.createElement(ImmersiveModals, { ...controller, palette, management: {} });
  };
  act(() => { renderer = create(React.createElement(Host, { visible: true })); });
  t.after(() => { act(() => renderer.unmount()); h.player.getState().cancelSleepTimer(); console.error = warn; delete global.IS_REACT_ACT_ENVIRONMENT; });
  return {
    get state() { return controller; },
    get root() { return renderer.root; },
    visibility: visible => act(() => renderer.update(React.createElement(Host, { visible }))),
    setInput: (kind, value) => act(() => {
      controller.setSleepModalVisible(true);
      if (kind === "minutes") controller.setCustomMinutes(value); else controller.setCustomSongCount(value);
    }),
    button: kind => {
      const input = renderer.root.findAllByType("TextInput")[kind === "minutes" ? 0 : 1];
      return input.parent.findByType("Touchable");
    },
  };
}

for (const kind of ["minutes", "songs"]) {
  test(`自定义${kind}小于半单位时禁用开启，不能关闭抽屉伪装成功`, t => {
    const h = fixture();
    const ui = mountController(t, h);
    ui.setInput(kind, "0.1");
    assert.equal(ui.button(kind).props.disabled, true);
    act(() => ui.button(kind).props.onPress());
    assert.equal(ui.state.sleepModalVisible, true);
    assert.equal(h.player.getState().sleepTimerActive || h.player.getState().sleepTimerSongActive, false);
  });
  test(`自定义${kind}有效小数四舍五入后启动并关闭抽屉`, t => {
    const h = fixture();
    const ui = mountController(t, h);
    ui.setInput(kind, "1.5");
    act(() => ui.button(kind).props.onPress());
    assert.equal(ui.state.sleepModalVisible, false);
    assert.equal(kind === "minutes" ? h.player.getState().sleepTimerMinutes : h.player.getState().sleepTimerSongCount, 2);
  });
}

test("超过歌曲数上限时不能静默改成50首", t => {
  const h = fixture();
  const ui = mountController(t, h);
  ui.setInput("songs", "51");
  assert.equal(ui.button("songs").props.disabled, true);
  assert.throws(() => h.player.getState().startSongSleepTimer(51), /50/);
});

test("返回播放器时保持离开前的歌词页面", t => {
  const h = fixture();
  const ui = mountController(t, h);
  act(() => ui.state.setCurrentPage(1));
  ui.visibility(false);
  ui.visibility(true);
  assert.equal(ui.state.currentPage, 1);
});

test("倍速设置失败展示原生错误且保留原倍速，其他即时设置仍生效", async t => {
  const h = fixture();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { ImmersivePlaySettingSheet } = h.load("src/screens/immersive/ImmersivePlaySettingSheet.tsx");
  let renderer;
  act(() => { renderer = create(React.createElement(ImmersivePlaySettingSheet, { visible: true, onClose() {}, palette })); });
  t.after(() => { act(() => renderer.unmount()); delete global.IS_REACT_ACT_ENVIRONMENT; });
  h.native.setRate = async () => { throw new Error("native rate rejected"); };
  await act(async () => renderer.root.findByProps({ accessibilityLabel: "倍速增大" }).props.onPress());
  assert.equal(h.player.getState().playbackRate, 1);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0][1], /native rate rejected/);
  const lyrics = h.load("src/stores/lyricSettingsStore.ts").useLyricSettingsStore;
  act(() => {
    renderer.root.findByProps({ accessibilityLabel: "字号增大" }).props.onPress();
    renderer.root.findByProps({ accessibilityLabel: "行距增大" }).props.onPress();
    renderer.root.findByProps({ accessibilityLabel: "歌词偏移增大" }).props.onPress();
  });
  assert.equal(lyrics.getState().fontSize, 17);
  assert.equal(lyrics.getState().lineGap, 10);
  assert.equal(lyrics.getState().manualOffsetMs, 50);
});
