const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

// 用户可感知的回归：切歌时「第一下没反应 → 用户再点一下 → 最终多跳过一首」。
//
// 成因有两条：
// 1. 点下去到新曲起播之间有一段解析 + 原生装车，这段时间里上一首还在响，
//    耳朵上就是「没切」。用户会再点一下，于是最终又多跳一首。
//    → 现在切歌起步就把上一首静音（playSongCore 里的 silenceCurrentTrack）。
// 2. 「切换中合并」只该服务 next/prev 的原生串行化（add/skip 未返回时并发切歌
//    会打乱原生队列顺序）。但这个状态机曾经被塞进 playFromQueue：
//    队列内直选会被降级成「当前曲的下一首」，next/prev 自己的调用还会重入状态机
//    而提前返回（点了没反应 + 完成后无限补跳）。
//    → 现在只有 next/prev 参与合并，队列内直选立刻生效，合并期间用户重新点歌
//      会丢弃未消费的补跳，而不是把用户的选择覆盖成「下一首」。

const song = (id) => ({ id, source: "tx", name: id, singer: "Test", interval: 100 });
const trackKey = (id) => `tx-${id}`;

const coreLoader = createLoader({});
const core = {
  ...coreLoader("../../packages/core/src/switch-step-queue.ts"),
  ...coreLoader("../../packages/core/src/request-limiter.ts"),
  ...coreLoader("../../packages/core/src/playback-quality.ts"),
  ...coreLoader("../../packages/core/src/song-variant.ts"),
  isPreviewDuration: () => false,
};

const settle = async (rounds = 40) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

function setup() {
  const events = [];
  const addBlocks = new Map(); // trackKey -> { entered, gate }
  const urlBlocks = new Map(); // songId -> { entered, gate }

  const native = {};
  for (const name of ["setupPlayer", "updateOptions", "setRepeatMode", "getQueue", "skip", "remove", "setRate", "setVolume", "play", "stop", "reset"]) {
    native[name] = async (...args) => {
      events.push(name === "setVolume" ? `${name}:${args[0]}` : name);
      if (name === "getQueue") return [];
    };
  }
  native.add = async (tracks) => {
    const key = tracks[0].id;
    events.push(`add:${key}`);
    const blocked = addBlocks.get(key);
    if (blocked) {
      blocked.entered.resolve();
      await blocked.gate.promise;
    }
  };

  const cache = {
    getCachedPlaybackUrl: async (track) => {
      const blocked = urlBlocks.get(track.id);
      if (blocked) {
        blocked.entered.resolve();
        await blocked.gate.promise;
      }
      return { url: `https://fixture.invalid/${track.id}`, quality: "320k" };
    },
    saveCachedPlaybackUrl: async () => {},
    invalidateCachedPlaybackUrl: async () => {},
  };
  const tracker = { startListeningSession() {}, resetListeningSession() {}, onPlaybackProgress() {}, seekListeningSession() {}, flushListeningSession: async () => {} };

  const mocks = {
    zustand: mobileRequire("zustand"),
    "@/services/logger": { logger: { info() {}, warn() {}, error() {} } },
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
    "./hiddenFallbackService": {},
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

  return {
    store, service, events, native,
    blockAdd(songId) {
      const entry = { entered: deferred(), gate: deferred() };
      addBlocks.set(trackKey(songId), entry);
      return entry;
    },
    blockUrl(songId) {
      const entry = { entered: deferred(), gate: deferred() };
      urlBlocks.set(songId, entry);
      return entry;
    },
  };
}

const current = (h) => h.store.getState().currentSong?.id ?? "-";
const adds = (h) => h.events.filter((event) => event.startsWith("add:"));

test("装车中再点下一首：不并发改原生队列，补跳后停在下一首（连点两下 = 前进两首）", { timeout: 15000 }, async () => {
  const h = setup();
  await h.service.playQueue([song("A"), song("B"), song("C"), song("D")]);
  assert.equal(current(h), "A");

  // B 的解析已完成，卡在原生装车（真实设备上就是 add→skip→play 那几百毫秒）
  const bAdd = h.blockAdd("B");
  const first = h.service.playNext();
  await bAdd.entered.promise;
  assert.equal(current(h), "B", "第一次点击必须立刻切到 B");

  const second = h.service.playNext();
  await settle();
  assert.equal(current(h), "B", "装车中的第二次点击不并发改原生队列（会打乱队列顺序）");
  assert.equal(adds(h).includes("add:tx-C"), false, "切换在途期间不得发起第二次原生 add");

  bAdd.gate.resolve();
  await Promise.all([first, second]);
  await settle();

  assert.equal(current(h), "C", "补跳消费后应前进一首：两下点击 = 前进两首，不多不少");
  assert.equal(h.store.getState().currentIndex, 2);
});

test("解析在途时再点下一首：取消旧解析，立刻改目标", { timeout: 15000 }, async () => {
  const h = setup();
  await h.service.playQueue([song("A"), song("B"), song("C"), song("D")]);

  const bUrl = h.blockUrl("B");
  const first = h.service.playNext();
  await bUrl.entered.promise;
  assert.equal(current(h), "B");

  const second = h.service.playNext();
  await settle();
  assert.equal(current(h), "C", "解析期间再点必须立刻改目标，而不是排队等");

  bUrl.gate.resolve();
  await Promise.all([first, second]);
  await settle();
  assert.equal(current(h), "C");
});

test("队列内直选不参与合并：点的就是播的，不会被降级成「下一首」", { timeout: 15000 }, async () => {
  const h = setup();
  await h.service.playQueue([song("A"), song("B"), song("C"), song("D")]);

  const bAdd = h.blockAdd("B");
  const next = h.service.playNext();
  await bAdd.entered.promise;
  assert.equal(current(h), "B");

  // 用户在装车窗口内直接点了列表第 4 首
  await h.service.playFromQueue(3);
  assert.equal(current(h), "D", "直选必须立刻生效");

  bAdd.gate.resolve();
  await next;
  await settle();
  assert.equal(current(h), "D", "直选之后不能被未消费的补跳改成「下一首」");
});

test("切歌起步就静音：解析还没完成时上一首已不再出声", { timeout: 15000 }, async () => {
  const h = setup();
  await h.service.playQueue([song("A"), song("B")]);
  assert.equal(current(h), "A");

  h.events.length = 0;
  const bUrl = h.blockUrl("B");
  const pending = h.service.playNext();
  await bUrl.entered.promise;

  assert.ok(
    h.events.includes("setVolume:0"),
    "解析阶段就该先把上一首压掉，否则「耳朵里还在放上一首」会让人以为没点上",
  );

  bUrl.gate.resolve();
  await pending;
  await settle();

  const volumes = h.events.filter((event) => event.startsWith("setVolume:"));
  assert.notEqual(volumes.at(-1), "setVolume:0", "新曲起播必须把音量恢复成目标值");
  assert.equal(current(h), "B");
});

test("越界点击不会留下在途假象，后续切歌照常工作", { timeout: 15000 }, async () => {
  const h = setup();
  await h.service.playQueue([song("A"), song("B")]);

  await h.service.playFromQueue(9);
  await settle();
  assert.equal(current(h), "A", "越界点击不应改变当前曲");

  await h.service.playFromQueue(1);
  assert.equal(current(h), "B", "越界点击之后仍能正常切歌");
});

test("空列表播放不会卡住后续切歌", { timeout: 15000 }, async () => {
  const h = setup();
  await h.service.playQueue([]);
  await h.service.playQueue([song("X")]);
  assert.equal(current(h), "X");

  await h.service.playNext();
  await settle();
  assert.equal(current(h), "X", "队尾没有下一首，保持当前曲");
});

test("自动跳过（auto）不插队到手动切换里", { timeout: 15000 }, async () => {
  const h = setup();
  await h.service.playQueue([song("A"), song("B"), song("C")]);

  const bAdd = h.blockAdd("B");
  const manual = h.service.playNext();
  await bAdd.entered.promise;
  assert.equal(current(h), "B");

  // PlaybackError 兜底触发的自动跳过：切换在途时必须放弃，否则用户会「点 B 播 C」
  await h.service.playNext(true);
  await settle();
  assert.equal(current(h), "B");

  bAdd.gate.resolve();
  await manual;
  await settle();
  assert.equal(current(h), "B");
});
