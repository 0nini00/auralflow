const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

/**
 * 「键不存在」与「键存在但读不懂」必须分开：前者用默认值，后者要么抛错并拒绝写盘
 * （用户数据），要么先把原始值备份再退回默认值（启动必经的配置）。
 * 这里的用例只断言存储读写与 store 状态，不涉及任何界面表现。
 */

const THEME_KEY = "auralflow.mobile.theme";
const PINS_KEY = "auralflow.mobile.variantPins.v1";
const HISTORY_KEY = "auralflow.mobile.playHistory";
const HISTORY_TS_KEY = "auralflow.mobile.playHistoryTimestamps";
const WEBDAV_KEY = "auralflow.mobile.webdavConfig";
const backupKeyOf = key => `${key}.corrupt-backup`;
const CORRUPT = "{not json";

function memoryStorage(initial = {}, options = {}) {
  const memory = new Map(Object.entries(initial));
  const writes = [];
  const storage = {
    getItem: async key => {
      if (options.failRead?.(key)) throw new Error("storage read unavailable");
      return memory.get(key) ?? null;
    },
    setItem: async (key, value) => {
      if (options.failWrite?.(key)) throw new Error("storage write unavailable");
      writes.push(key); memory.set(key, value);
    },
    removeItem: async key => { memory.delete(key); },
    multiGet: async keys => Promise.all(keys.map(async key => [key, await storage.getItem(key)])),
    multiSet: async pairs => { for (const [key, value] of pairs) await storage.setItem(key, value); },
    multiRemove: async keys => { for (const key of keys) memory.delete(key); },
  };
  return { memory, writes, storage };
}

function recordingLogger() {
  const logs = [];
  const logger = Object.fromEntries(["debug", "info", "warn", "error"]
    .map(level => [level, (...args) => logs.push([level, ...args])]));
  return { logs, logger, errors: () => logs.filter(([level]) => level === "error") };
}

function setupTheme(initial, options) {
  const s = memoryStorage(initial, options);
  const log = recordingLogger();
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "@react-native-async-storage/async-storage": s.storage,
    "react-native": { Appearance: { getColorScheme: () => "dark" } },
    "@/services/logger": { logger: log.logger },
  });
  const model = load("src/services/themePaletteModel.ts");
  return { ...s, ...log, model, store: load("src/stores/themeStore.ts").useThemeStore };
}

test("主题：键不存在用默认值，不写备份也不记错误", async () => {
  const h = setupTheme();
  await h.store.getState().loadTheme();
  const state = h.store.getState();
  assert.deepEqual([state.mode, state.accentColor, state.loaded], ["system", h.model.DEFAULT_ACCENT_COLOR, true]);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.logs, []);
});

test("主题：有效配置按原样恢复", async () => {
  const h = setupTheme({ [THEME_KEY]: JSON.stringify({ mode: "light", accentColor: "#123456" }) });
  await h.store.getState().loadTheme();
  assert.equal(h.store.getState().mode, "light");
  assert.equal(h.store.getState().accentColor, h.model.normalizeAccentColor("#123456"));
  assert.deepEqual(h.writes, []);
});

for (const [label, raw] of [["JSON 解析失败", CORRUPT], ["不是对象", "[1,2]"], ["null", "null"], ["空串", ""]]) {
  test(`主题：配置损坏（${label}）先备份原始值并记错误，再用默认主题启动`, async () => {
    const h = setupTheme({ [THEME_KEY]: raw });
    await h.store.getState().loadTheme();
    assert.equal(h.memory.get(backupKeyOf(THEME_KEY)), raw);
    assert.equal(h.memory.get(THEME_KEY), raw, "读盘阶段不得改写原键");
    assert.equal(h.errors().length, 1);
    assert.match(h.errors()[0][1], /auralflow\.mobile\.theme/);
    const state = h.store.getState();
    assert.deepEqual([state.mode, state.accentColor, state.loaded], ["system", h.model.DEFAULT_ACCENT_COLOR, true]);

    // 之后改主题会覆盖原键：原始值必须仍在备份键里
    await h.store.getState().setMode("dark");
    assert.equal(JSON.parse(h.memory.get(THEME_KEY)).mode, "dark");
    assert.equal(h.memory.get(backupKeyOf(THEME_KEY)), raw);
  });
}

test("主题：备份写不进去时不得退回默认值，错误抛给启动流程", async () => {
  const h = setupTheme({ [THEME_KEY]: CORRUPT }, { failWrite: key => key === backupKeyOf(THEME_KEY) });
  await assert.rejects(h.store.getState().loadTheme(), /storage write unavailable/);
  assert.equal(h.store.getState().loaded, false);
  assert.equal(h.memory.get(THEME_KEY), CORRUPT);
  assert.equal(h.errors().length, 1);
});

async function setupPins(initial, options) {
  const s = memoryStorage(initial, options);
  const log = recordingLogger();
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "@react-native-async-storage/async-storage": s.storage,
    "@/services/logger": { logger: log.logger },
  });
  const store = load("src/stores/variantPinStore.ts").useVariantPinStore;
  // 模块加载时已自动水合一次（失败被模块自己接住），这里等它落定并拿到结果
  const loadError = await store.getState().loadFromStorage().then(() => null, error => error);
  return { ...s, ...log, store, loadError };
}

test("首选版本：键不存在是空表，可正常写入", async () => {
  const h = await setupPins();
  assert.equal(h.loadError, null);
  await h.store.getState().togglePinnedVariant("wy:1", "tx:9");
  assert.deepEqual(JSON.parse(h.memory.get(PINS_KEY)), { "wy:1": "tx:9" });
  assert.deepEqual(h.errors(), []);
});

test("首选版本：有效数据恢复后，新增不丢已有项", async () => {
  const h = await setupPins({ [PINS_KEY]: JSON.stringify({ "wy:1": "tx:9" }) });
  assert.equal(h.store.getState().getPinnedVariantKey("wy:1"), "tx:9");
  await h.store.getState().togglePinnedVariant("wy:2", "tx:8");
  assert.deepEqual(JSON.parse(h.memory.get(PINS_KEY)), { "wy:1": "tx:9", "wy:2": "tx:8" });
});

for (const [label, raw] of [["JSON 解析失败", CORRUPT], ["不是对象", "[1,2]"], ["null", "null"]]) {
  test(`首选版本：数据损坏（${label}）时读盘抛错并记错误，写入被拒，原数据不被覆盖`, async () => {
    const h = await setupPins({ [PINS_KEY]: raw });
    assert.ok(h.loadError instanceof Error);
    assert.ok(h.errors().length >= 1);
    assert.match(h.errors()[0][1], /首选版本读盘失败/);
    assert.equal(h.store.getState().getPinnedVariantKey("wy:1"), null);

    await assert.rejects(h.store.getState().togglePinnedVariant("wy:1", "tx:9"));
    assert.deepEqual(h.store.getState().pins, {});
    assert.equal(h.memory.get(PINS_KEY), raw);
    assert.deepEqual(h.writes, []);
  });
}

test("首选版本：读盘失败期间拒绝写入，存储恢复后重新水合再写，不丢已有项", async () => {
  let failing = true;
  const h = await setupPins({ [PINS_KEY]: JSON.stringify({ "wy:1": "tx:9" }) }, { failRead: () => failing });
  assert.match(h.loadError.message, /storage read unavailable/);
  await assert.rejects(h.store.getState().togglePinnedVariant("wy:2", "tx:8"), /storage read unavailable/);
  assert.deepEqual(h.writes, []);

  failing = false;
  await h.store.getState().togglePinnedVariant("wy:2", "tx:8");
  assert.deepEqual(JSON.parse(h.memory.get(PINS_KEY)), { "wy:1": "tx:9", "wy:2": "tx:8" });
});

function setupHistory(initial) {
  const s = memoryStorage(initial);
  const log = recordingLogger();
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "@react-native-async-storage/async-storage": s.storage,
    "@/services/logger": { logger: log.logger },
  });
  return { ...s, ...log, store: load("src/stores/historyStore.ts").useHistoryStore };
}

const historySong = id => ({ id, source: "wy", name: `song-${id}`, singer: "fixture", albumName: "", interval: 200 });
const recently = offset => Date.now() - offset * 60_000;

test("播放历史：新格式不依赖时间戳副本，副本损坏不拦读盘", async () => {
  const entries = [{ key: "wy:a", song: historySong("a"), playedAt: recently(1) }];
  const h = setupHistory({ [HISTORY_KEY]: JSON.stringify(entries), [HISTORY_TS_KEY]: CORRUPT });
  await h.store.getState().loadHistory();
  assert.deepEqual(h.store.getState().entries.map(entry => [entry.key, entry.playedAt]), [["wy:a", entries[0].playedAt]]);
  assert.equal(h.store.getState().error, null);
});

test("播放历史：旧格式迁移时时间戳缺失是正常情况，补占位时间并标为合成", async () => {
  const h = setupHistory({ [HISTORY_KEY]: JSON.stringify([historySong("a")]) });
  await h.store.getState().loadHistory();
  assert.deepEqual(h.store.getState().entries.map(entry => [entry.key, entry.playedAtSynthetic]), [["wy:a", true]]);
});

test("播放历史：旧格式迁移用得上的真实播放时间被保留", async () => {
  const playedAt = recently(5);
  const h = setupHistory({
    [HISTORY_KEY]: JSON.stringify([historySong("a")]),
    [HISTORY_TS_KEY]: JSON.stringify({ "wy:a": playedAt }),
  });
  await h.store.getState().loadHistory();
  assert.deepEqual(h.store.getState().entries.map(entry => [entry.key, entry.playedAt, entry.playedAtSynthetic]),
    [["wy:a", playedAt, undefined]]);
});

for (const [label, raw] of [["JSON 解析失败", CORRUPT], ["不是对象", "[1,2]"], ["null", "null"]]) {
  test(`播放历史：旧格式迁移遇到损坏的时间戳（${label}）必须中止，后续写入不得覆盖原数据`, async () => {
    const legacy = JSON.stringify([historySong("a"), historySong("b")]);
    const h = setupHistory({ [HISTORY_KEY]: legacy, [HISTORY_TS_KEY]: raw });
    await assert.rejects(h.store.getState().loadHistory());
    assert.ok(h.store.getState().error);
    assert.deepEqual(h.store.getState().entries, []);

    // 播放时写历史：不抛（不能打断播放），但必须留痕且不落盘
    await h.store.getState().addToHistory(historySong("c"));
    await h.store.getState().removeFromHistory("a", "wy");
    assert.equal(h.memory.get(HISTORY_KEY), legacy);
    assert.equal(h.memory.get(HISTORY_TS_KEY), raw);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.logs.map(([level, message]) => [level, message]),
      [["warn", "[历史] 写入播放记录失败"], ["warn", "[历史] 删除历史记录失败"]]);

    // 同步合并必须把失败抛给调用方（WebDAV 据此停在上传之前）
    await assert.rejects(h.store.getState().mergeHistory([{ key: "wy:z", song: historySong("z"), playedAt: recently(2) }]));
    assert.equal(h.memory.get(HISTORY_KEY), legacy);
  });
}

function setupWebdav(initial, options) {
  const s = memoryStorage(initial, options);
  const log = recordingLogger();
  const secureWrites = [];
  const emptyStore = { getState: () => ({}), subscribe: () => () => undefined };
  const load = createLoader({
    "@react-native-async-storage/async-storage": s.storage,
    "@/services/logger": { logger: log.logger },
    // 本组只测配置读取：其余 store、网络与自定义源运行时一律不参与
    "../stores/playlistStore": { usePlaylistStore: emptyStore },
    "../stores/favoritesStore": { useFavoritesStore: emptyStore },
    "../stores/historyStore": { useHistoryStore: emptyStore },
    "../stores/customSourceStore": { useCustomSourceStore: emptyStore },
    "./customSourceRuntime": {},
    pako: mobileRequire("pako"),
    "@/utils/fetchWithTimeout": { fetchWithTimeout: async () => assert.fail("禁止网络请求") },
    "@/services/secureStorageService": {
      getSecureItem: async () => "fixture-only-not-a-real-secret",
      setSecureItem: async (...args) => { secureWrites.push(args); },
      removeSecureItem: async (...args) => { secureWrites.push(args); },
    },
  });
  return { ...s, ...log, secureWrites, service: load("src/services/webdavSyncService.ts") };
}

test("WebDAV 配置：键不存在按未配置处理，不写备份也不记错误", async () => {
  const h = setupWebdav();
  const config = await h.service.loadWebdavConfig();
  assert.deepEqual(config, { url: "", username: "", password: "fixture-only-not-a-real-secret", autoSyncPlaylists: false });
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.errors(), []);
});

test("WebDAV 配置：有效配置按原样读出", async () => {
  const stored = { url: "https://dav.invalid/root", username: "fixture", autoSyncPlaylists: true };
  const h = setupWebdav({ [WEBDAV_KEY]: JSON.stringify(stored) });
  const config = await h.service.loadWebdavConfig();
  assert.deepEqual(config, { ...stored, password: "fixture-only-not-a-real-secret" });
  assert.deepEqual(h.writes, []);
});

for (const [label, raw] of [["JSON 解析失败", CORRUPT], ["不是对象", "[1,2]"], ["null", "null"], ["空串", ""]]) {
  test(`WebDAV 配置：配置损坏（${label}）先备份原始值并记错误，再按未配置处理`, async () => {
    const h = setupWebdav({ [WEBDAV_KEY]: raw });
    const config = await h.service.loadWebdavConfig();
    assert.deepEqual([config.url, config.username, config.autoSyncPlaylists], ["", "", false]);
    assert.equal(h.memory.get(backupKeyOf(WEBDAV_KEY)), raw);
    assert.equal(h.memory.get(WEBDAV_KEY), raw, "读盘阶段不得改写原键");
    assert.deepEqual(h.writes, [backupKeyOf(WEBDAV_KEY)]);
    assert.equal(h.errors().length, 1);
    assert.match(h.errors()[0][1], /auralflow\.mobile\.webdavConfig/);
    assert.deepEqual(h.secureWrites, []);
  });
}

test("WebDAV 配置：备份写不进去时不得当成未配置，错误继续抛出", async () => {
  const h = setupWebdav({ [WEBDAV_KEY]: CORRUPT }, { failWrite: key => key === backupKeyOf(WEBDAV_KEY) });
  await assert.rejects(h.service.loadWebdavConfig(), /storage write unavailable/);
  assert.equal(h.memory.get(WEBDAV_KEY), CORRUPT);
});
