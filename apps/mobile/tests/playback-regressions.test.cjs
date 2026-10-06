const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

const song = (id) => ({ id, source: "tx", name: id, singer: "Test", interval: 100 });
const coreLoader = createLoader({});
const core = {
  ...coreLoader("../../packages/core/src/switch-step-queue.ts"),
  ...coreLoader("../../packages/core/src/playback-quality.ts"),
  isPreviewDuration: () => false,
};

function setup(blockAt) {
  const gate = deferred();
  const entered = deferred();
  const events = [];
  const native = {};
  for (const name of ["setupPlayer", "updateOptions", "setRepeatMode", "getQueue", "add", "skip", "remove", "setRate", "setVolume", "play", "stop", "reset"]) {
    native[name] = async () => {
      events.push(name);
      if (name === blockAt) { entered.resolve(); await gate.promise; }
      if (name === "getQueue") return [];
    };
  }
  const cache = {
    getCachedPlaybackUrl: async () => {
      if (blockAt === "url") { entered.resolve(); return gate.promise; }
      return { url: "https://fixture.invalid/audio", quality: "320k" };
    },
    saveCachedPlaybackUrl: async () => {}, invalidateCachedPlaybackUrl: async () => {},
  };
  const tracker = { startListeningSession: () => {}, resetListeningSession: () => {} };
  const mocks = {
    zustand: mobileRequire("zustand"),
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "react-native-track-player": { __esModule: true, default: native, State: {}, RepeatMode: { Off: 0 }, Event: {}, AppKilledPlaybackBehavior: {}, Capability: {} },
    "@lx/core": core,
    "@/services/androidPitchService": { syncPlaybackParameters: () => {} },
    "@/services/playbackUrlCache": cache, "./playbackUrlCache": cache,
    "@/services/playbackFailurePolicy": {},
    "@/services/lyricOverlayService": { isLyricOverlaySupported: () => false },
    "@/services/listenTrackerService": tracker, "./listenTrackerService": tracker,
    "./musicApi": { getLyrics: async () => [], buildStreamHeaders: () => ({}) },
    "./wyDirectProvider": {}, "./wyPlaylistService": {}, "./customSourceRuntime": {},
    "../stores/customSourceStore": {}, "./streamProbe": {},
    "@/services/crossSourceFallbackService": {},
    "@/stores/playbackSettingsStore": { usePlaybackSettingsStore: { getState: () => ({ defaultQuality: "320k" }) } },
    "./cacheService": {
      CACHEABLE_AUDIO_SOURCES: new Set(), getCachedLyrics: async () => [],
      cacheCover: async () => {}, cacheLyrics: async () => {},
    },
  };
  const load = createLoader(mocks);
  const store = load("src/stores/playerStore.ts").usePlayerStore;
  const service = load("src/services/playerService.ts");
  return { store, service, gate, entered, events, native, cache };
}

function assertCleared(store) {
  const state = store.getState();
  assert.equal(state.currentSong, null);
  assert.deepEqual(state.queue, []);
  assert.equal(state.isPlaying, false);
  assert.equal(state.loading, false);
  assert.equal(state.error, null);
}

for (const stage of ["setupPlayer", "getQueue", "add", "skip", "setRate", "setVolume"]) {
  test(`clearQueue cancels play waiting at ${stage}`, { timeout: 5000 }, async () => {
    const h = setup(stage);
    const track = song("A");
    h.store.getState().setQueue([track]);
    const pending = h.store.getState().play(track, "https://fixture.invalid/A");
    await h.entered.promise;
    const clearing = h.store.getState().clearQueue();
    h.gate.resolve();
    await Promise.all([pending, clearing]);
    assertCleared(h.store);
    assert.equal(h.events.includes("play"), false);
  });
}

test("clearQueue cancels the URL resolution stage before native play starts", { timeout: 5000 }, async () => {
  const h = setup("url");
  const pending = h.service.playQueue([song("A")]);
  await h.entered.promise;
  await h.store.getState().clearQueue();
  h.gate.resolve({ url: "https://fixture.invalid/A", quality: "320k" });
  await pending;
  assertCleared(h.store);
  assert.equal(h.events.includes("play"), false);
});

test("a late cancelled URL failure cannot restore an error after clearQueue", { timeout: 5000 }, async () => {
  const h = setup("url");
  const pending = h.service.playQueue([song("A")]);
  await h.entered.promise;
  await h.store.getState().clearQueue();
  h.gate.reject(new Error("late URL failure"));
  await assert.doesNotReject(pending);
  assertCleared(h.store);
});

test("the same song can start a fresh play after its previous request was cleared", { timeout: 5000 }, async () => {
  const h = setup("setupPlayer");
  const track = song("A");
  h.store.getState().setQueue([track]);
  const oldPlay = h.store.getState().play(track, "https://fixture.invalid/old");
  await h.entered.promise;
  const clearing = h.store.getState().clearQueue();
  h.store.getState().setQueue([track]);
  const newPlay = h.store.getState().play(track, "https://fixture.invalid/new");
  h.gate.resolve();
  await Promise.all([oldPlay, newPlay, clearing]);
  assert.equal(h.store.getState().currentUrl, "https://fixture.invalid/new");
  assert.equal(h.store.getState().isPlaying, true);
  assert.equal(h.events.filter(e => e === "play").length, 1);
});

test("a cancelled native failure cannot overwrite a new request", { timeout: 5000 }, async () => {
  const h = setup("add");
  const oldPlay = h.store.getState().play(song("A"), "https://fixture.invalid/old");
  await h.entered.promise;
  const clearing = h.store.getState().clearQueue();
  h.native.add = async () => {};
  const next = song("B");
  h.store.getState().setQueue([next]);
  const newPlay = h.store.getState().play(next, "https://fixture.invalid/new");
  h.gate.reject(new Error("late native failure"));
  await assert.doesNotReject(Promise.all([oldPlay, newPlay, clearing]));
  assert.equal(h.store.getState().currentSong.id, "B");
  assert.equal(h.store.getState().error, null);
});


test("clearQueue drains a pending native play before resetting the native queue", { timeout: 5000 }, async () => {
  const h = setup("play");
  const pending = h.store.getState().play(song("A"), "https://fixture.invalid/A");
  await h.entered.promise;
  const clearing = h.store.getState().clearQueue();
  h.gate.resolve();
  await Promise.all([pending, clearing]);
  assertCleared(h.store);
  assert.equal(h.events.at(-1), "reset");
});

test("clearQueue discards queued next clicks from the old playlist", { timeout: 5000 }, async () => {
  const h = setup();
  const late = deferred();
  const entered = deferred();
  await h.service.playQueue([song("A"), song("B"), song("C")]);
  h.cache.getCachedPlaybackUrl = async track => {
    if (track.id === "B") { entered.resolve(); return late.promise; }
    return { url: "https://fixture.invalid/" + track.id, quality: "320k" };
  };
  const oldNext = h.service.playNext();
  await entered.promise;
  await h.service.playNext();
  await h.store.getState().clearQueue();
  await h.service.playQueue([song("X"), song("Y")]);
  late.resolve({ url: "https://fixture.invalid/B", quality: "320k" });
  await oldNext;
  // 补跳在旧 finally 中异步派发，排空它涉及的微任务后检查新队列没有被推进。
  for (let i = 0; i < 80; i++) await Promise.resolve();
  assert.equal(h.store.getState().currentSong.id, "X");
  assert.equal(h.store.getState().currentIndex, 0);
});

for (const replaySameKey of [false, true]) {
  test(`clearQueue waits for superseded native requests${replaySameKey ? " including a reused song key" : ""}`, { timeout: 5000 }, async () => {
    const h = setup();
    const late = deferred();
    const entered = deferred();
    let queue = [];
    let first = true;
    h.native.add = async tracks => {
      if (first) { first = false; entered.resolve(); await late.promise; }
      queue.push(...tracks);
    };
    h.native.reset = async () => { h.events.push("reset"); queue = []; };
    const oldPlay = h.store.getState().play(song("A"), "https://fixture.invalid/old-A");
    await entered.promise;
    await h.store.getState().play(song("B"), "https://fixture.invalid/B");
    if (replaySameKey) await h.store.getState().play(song("A"), "https://fixture.invalid/new-A");
    const clearing = h.store.getState().clearQueue();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const resetBeforeOldAddFinished = h.events.includes("reset");
    late.resolve();
    await Promise.all([oldPlay, clearing]);
    assert.equal(resetBeforeOldAddFinished, false);
    assert.deepEqual(queue, []);
    assertCleared(h.store);
  });
}
