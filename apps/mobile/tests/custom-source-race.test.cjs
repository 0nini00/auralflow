const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");
const pure = createLoader({});
const core = { ...pure("../../packages/core/src/switch-step-queue.ts"), ...pure("../../packages/core/src/request-limiter.ts"), ...pure("../../packages/core/src/playback-quality.ts"), ...pure("../../packages/core/src/recommendations/heartbeat-queue.ts"), ...pure("../../packages/core/src/song-variant.ts"), isPreviewDuration: () => false };
const song = (id, source = "tx") => ({ id, source, name: id, singer: "Artist", interval: 180 });
async function flush() { await new Promise(setImmediate); }
// node:test 的 mock timers 同步 tick，回调间的微任务要显式 flush，
// 否则微任务里新建的定时器会落到推进窗口之后。步长取 100ms：
// 本文件的事件边界都是 100 的倍数，计数精确；步长越大 flush 次数越少，
// 全量套件并发跑时对其它计时敏感用例的 CPU 挤占越小。
async function advance(t, ms, step = 100) {
  // 推进前先清一次微任务：取链前会 await 一个异步闸门（@lx/core 的
  // createRequestLimiter），它的微任务如果晚于第一次 tick 落地，t=0 发起的
  // 请求就会被推到下一个步长，整条时间线平移 100ms。
  await flush();
  let remaining = ms;
  while (remaining > 0) {
    const chunk = Math.min(step, remaining);
    t.mock.timers.tick(chunk);
    remaining -= chunk;
    await flush();
  }
}

function setup(sources, runtimeImpl) {
  const native = {};
  for (const method of ["setupPlayer","updateOptions","setRepeatMode","add","skip","remove","setRate","setVolume","play","stop","reset","pause"]) native[method] = async () => {};
  native.getQueue = async () => [];
  const customStore = { sources, applyRuntimeUpdateAlert() {} };
  const cache = { getCachedPlaybackUrl: async () => null, saveCachedPlaybackUrl: async () => {}, invalidateCachedPlaybackUrl: async () => {} };
  const recommendations = { getPersonalFmSongs: async () => ({ songs: [], hasMore: false }), getHeartbeatModeList: async () => [] };
  const cross = { findTxVariants: async () => [], describeCrossSourceFailure: () => "无替代歌曲" };
  const load = createLoader({
    zustand: mobileRequire("zustand"), "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "react-native-track-player": { __esModule: true, default: native, State: {}, RepeatMode: { Off: 0 }, Event: {}, AppKilledPlaybackBehavior: {}, Capability: {} },
    "@lx/core": core, "@/services/androidPitchService": {}, "./playbackUrlCache": cache, "@/services/playbackUrlCache": cache,
    "@/services/playbackFailurePolicy": {}, "@/services/lyricOverlayService": { isLyricOverlaySupported: () => false },
    "@/services/listenTrackerService": { startListeningSession() {}, resetListeningSession() {} }, "./listenTrackerService": { startListeningSession() {}, resetListeningSession() {} },
    "./musicApi": { getLyrics: async () => [], buildStreamHeaders: () => ({}) }, "./wyDirectProvider": {}, "./wyPlaylistService": recommendations,
    "./customSourceRuntime": { requestCustomSourceMusicUrl: runtimeImpl }, "../stores/customSourceStore": { useCustomSourceStore: { getState: () => customStore } }, "./hiddenFallbackService": { startHiddenSearch: async () => [], resolveHiddenFromGroups: async () => null, resolveHiddenFallback: async () => null },
    "./streamProbe": {},
    "@/services/crossSourceFallbackService": cross,
    "@/stores/playbackSettingsStore": { usePlaybackSettingsStore: { getState: () => ({ defaultQuality: "320k" }) } },
    "./cacheService": { CACHEABLE_AUDIO_SOURCES: new Set(), getCachedLyrics: async () => [], cacheCover: async () => {}, cacheLyrics: async () => {} },
    "@/services/logger": { logger: { info() {}, warn() {}, error() {} } },
  });
  return { service: load("src/services/playerService.ts") };
}

function runtimeFromPlans(plans, calls) {
  return (source, _song, quality) => {
    calls.push({ name: source.name, quality });
    const plan = plans[source.name]?.[quality];
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!plan) reject(new Error(`无该档计划 ${source.name}/${quality}`));
        else if (plan.error) reject(new Error(plan.error));
        else resolve({ url: plan.url, quality: plan.quality ?? quality });
      }, plan?.delayMs ?? 0);
    });
  };
}

function track(promise) {
  const state = { settled: false, value: undefined, error: undefined };
  promise.then((value) => { state.settled = true; state.value = value; }, (error) => { state.settled = true; state.error = error; });
  return state;
}

test("慢源响应 3.3s 不被 2.5s 预算击杀，低档达标结果被接受", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const { service } = setup(
    [{ id: "hyw", name: "HYWmusic_公益版", enabled: true }],
    runtimeFromPlans({ HYWmusic_公益版: { flac24bit: { delayMs: 100, error: "无 flac24bit" }, flac: { delayMs: 3300, url: "https://cdn/flac", quality: "flac" } } }, calls),
  );
  const state = track(service.resolveUrlWithCustomSource(song("1"), ["flac24bit", "flac"]));
  await advance(t, 3300);
  assert.equal(state.settled, false);
  await advance(t, 100);
  assert.equal(state.value?.url, "https://cdn/flac");
  assert.equal(state.value?.quality, "flac");
});

test("最高档慢回退(实测 18.7s)不再阻塞降档，可用的 flac 在窗口到期后定稿", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const { service } = setup(
    [{ id: "hyw", name: "HYWmusic_公益版", enabled: true }],
    runtimeFromPlans({ HYWmusic_公益版: { flac24bit: { delayMs: 18000, url: "https://cdn/late24bit", quality: "flac24bit" }, flac: { delayMs: 2100, url: "https://cdn/flac", quality: "flac" } } }, calls),
  );
  const state = track(service.resolveUrlWithCustomSource(song("1"), ["flac24bit", "flac"]));
  await advance(t, 800);
  assert.deepEqual(calls, [
    { name: "HYWmusic_公益版", quality: "flac24bit" },
    { name: "HYWmusic_公益版", quality: "flac" },
  ]);
  await advance(t, 2899);
  assert.equal(state.settled, false);
  await advance(t, 1);
  assert.equal(state.value?.url, "https://cdn/flac");
  assert.equal(state.value?.quality, "flac");
});

test("快源命中最高档即定稿，后续源零唤醒", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const { service } = setup(
    [{ id: "main", name: "主力源", enabled: true }, { id: "backup", name: "备用源", enabled: true }],
    runtimeFromPlans({ 主力源: { flac24bit: { delayMs: 200, url: "https://cdn/main", quality: "flac24bit" } } }, calls),
  );
  const state = track(service.resolveUrlWithCustomSource(song("1"), ["flac24bit"]));
  await advance(t, 200);
  assert.equal(state.value?.url, "https://cdn/main");
  await advance(t, 5000);
  assert.deepEqual(calls, [{ name: "主力源", quality: "flac24bit" }]);
});

test("慢主源在窗口内返回同档结果时优先权归更靠前的源", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const { service } = setup(
    [{ id: "main", name: "主力源", enabled: true }, { id: "backup", name: "备用源", enabled: true }],
    runtimeFromPlans({
      主力源: { flac24bit: { delayMs: 1500, url: "https://cdn/main", quality: "flac24bit" } },
      备用源: { flac24bit: { delayMs: 100, url: "https://cdn/backup", quality: "flac24bit" } },
    }, calls),
  );
  const state = track(service.resolveUrlWithCustomSource(song("1"), ["flac24bit"]));
  await advance(t, 900);
  assert.equal(state.settled, false);
  await advance(t, 600);
  assert.equal(state.value?.url, "https://cdn/main");
});

test("慢主源超出窗口时用后源定稿，迟到结果不覆盖", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const { service } = setup(
    [{ id: "main", name: "主力源", enabled: true }, { id: "backup", name: "备用源", enabled: true }],
    runtimeFromPlans({
      主力源: { flac24bit: { delayMs: 3000, url: "https://cdn/main", quality: "flac24bit" } },
      备用源: { flac24bit: { delayMs: 100, url: "https://cdn/backup", quality: "flac24bit" } },
    }, calls),
  );
  const state = track(service.resolveUrlWithCustomSource(song("1"), ["flac24bit"]));
  await advance(t, 1700);
  assert.equal(state.value?.url, "https://cdn/backup");
  await advance(t, 3000);
  assert.equal(state.value?.url, "https://cdn/backup");
});

test("全部源失败时错误包含每个源名与原因", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const { service } = setup(
    [{ id: "a", name: "甲源", enabled: true }, { id: "b", name: "乙源", enabled: true }],
    runtimeFromPlans({ 甲源: { flac24bit: { delayMs: 30, error: "甲挂了" } }, 乙源: { flac24bit: { delayMs: 30, error: "乙挂了" } } }, calls),
  );
  const state = track(service.resolveUrlWithCustomSource(song("1"), ["flac24bit"]));
  await advance(t, 300);
  assert.equal(state.settled, true);
  const message = state.error instanceof Error ? state.error.message : String(state.error);
  assert.match(message, /甲源/);
  assert.match(message, /甲挂了/);
  assert.match(message, /乙源/);
  assert.match(message, /乙挂了/);
});
