const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

// 一首歌的解析结果存在三级里（预读 → 磁盘音频文件 → 持久化 URL），解析链命中即返回。
// invalidateResolvedPlayback 是「播放结果证明它不可用」时的唯一作废入口；这里用真实的
// playerService 锁住：三级各自是否被清、磁盘音频只在点名时删、预读最后清。

const song = (id) => ({ id, source: "wy", name: id, singer: "Artist", interval: 180 });

function setup() {
  const calls = [];
  const behavior = { invalidateUrl: async () => {} };
  const native = {};
  for (const method of ["setupPlayer", "updateOptions", "setRepeatMode", "add", "skip", "remove", "setRate", "setVolume", "play", "stop", "reset", "pause"]) {
    native[method] = async () => {};
  }
  native.getQueue = async () => [];
  const cache = {
    getCachedPlaybackUrl: async (track) => { calls.push(["lookupUrl", track.id]); return { url: `https://fixture.invalid/${track.id}`, quality: "320k" }; },
    saveCachedPlaybackUrl: async () => {},
    invalidateCachedPlaybackUrl: (track, quality) => { calls.push(["invalidateUrl", track.id, quality]); return behavior.invalidateUrl(); },
  };
  const tracker = { startListeningSession() {}, resetListeningSession() {}, onPlaybackProgress() {}, seekListeningSession() {}, flushListeningSession: async () => {} };
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
    "react-native-track-player": { __esModule: true, default: native, State: {}, RepeatMode: { Off: 0 }, Event: {}, AppKilledPlaybackBehavior: {}, Capability: {} },
    "@/services/androidPitchService": {}, "./playbackUrlCache": cache, "@/services/playbackUrlCache": cache,
    "@/services/playbackFailurePolicy": {}, "@/services/lyricOverlayService": { isLyricOverlaySupported: () => false },
    "@/services/listenTrackerService": tracker, "./listenTrackerService": tracker,
    "./musicApi": { getLyrics: async () => [], buildStreamHeaders: () => ({}) },
    "./wyDirectProvider": {}, "./wyPlaylistService": {}, "./customSourceRuntime": {}, "../stores/customSourceStore": {},
    "./streamProbe": {},
    "./hiddenFallbackService": { startHiddenSearch: async () => [], resolveHiddenFromGroups: async () => null, resolveHiddenFallback: async () => null },
    "@/services/crossSourceFallbackService": { findTxVariants: async () => [], describeCrossSourceFailure: () => "无替代歌曲" },
    "@/stores/playbackSettingsStore": { usePlaybackSettingsStore: { getState: () => ({ defaultQuality: "320k" }) } },
    "./cacheService": {
      CACHEABLE_AUDIO_SOURCES: new Set(), getCachedLyrics: async () => [], cacheCover: async () => {}, cacheLyrics: async () => {},
      deleteCachedAudioForMusic: async (track) => { calls.push(["deleteAudio", track.id]); },
    },
    "@/services/logger": { logger: { info() {}, warn() {}, error() {} } },
  });
  load("src/stores/playerStore.ts");
  const service = load("src/services/playerService.ts");
  const named = (name) => calls.filter((call) => call[0] === name);
  return { service, calls, named, behavior };
}

const options = { timeout: 20000 };

test("只清两级 URL 缓存：在线链接出问题时不碰磁盘音频", options, async () => {
  const h = setup();
  await h.service.invalidateResolvedPlayback(song("A"), { includeDiskAudio: false });
  assert.deepEqual(h.named("invalidateUrl"), [["invalidateUrl", "A", undefined]], "该曲全部音质档的持久化 URL 都要作废");
  assert.deepEqual(h.named("deleteAudio"), []);
});

test("磁盘音频有嫌疑时三级一起清", options, async () => {
  const h = setup();
  await h.service.invalidateResolvedPlayback(song("A"), { includeDiskAudio: true });
  assert.deepEqual(h.named("invalidateUrl"), [["invalidateUrl", "A", undefined]]);
  assert.deepEqual(h.named("deleteAudio"), [["deleteAudio", "A"]]);
});

test("作废之后重新播放不再命中预读，而是重新走解析链", options, async () => {
  const h = setup();
  await h.service.playSong(song("A"));
  await h.service.playSong(song("A"));
  assert.equal(h.named("lookupUrl").length, 1, "前提：第二次播放命中的是预读，没有再查持久化 URL");

  await h.service.invalidateResolvedPlayback(song("A"), { includeDiskAudio: false });
  await h.service.playSong(song("A"));
  assert.equal(h.named("lookupUrl").length, 2);
});

test("预读最后清：落盘两级还没清完时，预读仍在", options, async () => {
  const h = setup();
  await h.service.playSong(song("A"));
  const gate = deferred();
  h.behavior.invalidateUrl = () => gate.promise;
  const pending = h.service.invalidateResolvedPlayback(song("A"), { includeDiskAudio: true });

  // 此刻持久化 URL 还没清掉。预读若已先被清，这次解析会从持久化 URL 把同一份结果回填进预读，
  // 等作废完成后预读里仍是那份坏结果。
  await h.service.playSong(song("A"));
  assert.equal(h.named("lookupUrl").length, 1, "作废完成前，预读不应先被清掉");

  gate.resolve();
  await pending;
  await h.service.playSong(song("A"));
  assert.equal(h.named("lookupUrl").length, 2, "作废完成后预读已清");
});

test("持久化 URL 作废失败时错误照常抛出，预读仍然被清", options, async () => {
  const h = setup();
  await h.service.playSong(song("A"));
  h.behavior.invalidateUrl = async () => { throw new Error("storage unavailable"); };
  await assert.rejects(h.service.invalidateResolvedPlayback(song("A"), { includeDiskAudio: false }), /storage unavailable/);
  h.behavior.invalidateUrl = async () => {};
  await h.service.playSong(song("A"));
  assert.equal(h.named("lookupUrl").length, 2);
});

test("isLocalFilePlaybackUrl 只认磁盘缓存文件地址", options, () => {
  const { service } = setup();
  assert.equal(service.isLocalFilePlaybackUrl("file:///cache/audio/wy-A-320k.audio"), true);
  assert.equal(service.isLocalFilePlaybackUrl("https://fixture.invalid/A"), false);
  assert.equal(service.isLocalFilePlaybackUrl(null), false);
});
