const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

const MEDIA_SCOPE = "mediaStore:external:music";
const LOCAL_MUSIC_KEY = "auralflow.mobile.localMusic";
const ORPHAN_KEY = "auralflow.mobile.localLyricsChoiceOrphans";

const nativeSong = (id, patch = {}) => ({
  id, title: "标题", artist: "歌手", album: "专辑", duration: 120000,
  filePath: "/music/" + id + ".mp3", signature: "sig-" + id, tagsUnchanged: false,
  ...patch,
});
const song = (id, origin, patch = {}) => ({
  id, source: "local", name: "旧标题", singer: "歌手", albumName: "专辑",
  url: "file:///music/" + id + ".mp3", interval: 120, isLocal: true,
  ...(origin ? { localOrigin: origin } : {}),
  ...(origin === "mediaStore" ? { localScan: { scope: MEDIA_SCOPE, signature: "sig-" + id } } : {}),
  ...patch,
});
const nativeResult = (songs) => ({ scope: MEDIA_SCOPE, complete: true, songs });
const pickedSong = (id, fingerprint, patch = {}) => song(id, "mediaStore", {
  lyricsMode: "picked", lyricsFingerprint: fingerprint, lyricsSourceLabel: "LRCLIB",
  localLyrics: "选中的那份词",
  localEditedFields: ["lyricsMode", "lyricsFingerprint", "lyricsSourceLabel", "localLyrics"],
  ...patch,
});

/** 曲库 + 原生桥的最小装配；control.failWrite 让第 N 次存储写入失败（0 = 不失败）。 */
function setup(options = {}) {
  const storage = new Map([[LOCAL_MUSIC_KEY, JSON.stringify(options.existing || [])]]);
  if (options.orphans) storage.set(ORPHAN_KEY, JSON.stringify(options.orphans));
  const writes = [];
  const control = { failWrite: 0 };
  const downloadState = { downloads: [], error: null, loadDownloads: async () => {} };
  const write = async (key, value) => {
    writes.push(key);
    if (writes.length === control.failWrite) throw new Error("persist failed");
    if (value === undefined) storage.delete(key); else storage.set(key, value);
  };
  const load = createLoader({
    zustand: { create: (initializer) => mobileRequire("zustand/vanilla").createStore(initializer) },
    "@react-native-async-storage/async-storage": {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: (key, value) => write(key, value),
      removeItem: (key) => write(key, undefined),
    },
    "react-native": {
      Platform: { OS: "android", Version: 35 },
      NativeModules: { LocalMusicModule: {
        scanLocalMusic: async () => (Object.hasOwn(options, "native") ? options.native : nativeResult([])),
        pickLocalAudioFiles: async () => [],
        updateAudioMetadata: async () => 1,
      } },
    },
    "react-native-permissions": {
      PERMISSIONS: { ANDROID: { READ_MEDIA_AUDIO: "audio", READ_EXTERNAL_STORAGE: "storage" } },
      RESULTS: { GRANTED: "granted" },
      check: async () => "granted",
      request: async () => "denied",
    },
    "react-native-fs": {
      DocumentDirectoryPath: "/app",
      exists: async () => false,
      readFile: async () => { throw new Error("unexpected read"); },
    },
    "@/stores/downloadStore": { useDownloadStore: { getState: () => downloadState } },
  });
  return {
    load, control, storage, writes,
    store: load("src/stores/localMusicStore.ts").useLocalMusicStore,
    orphans: () => { const raw = storage.get(ORPHAN_KEY); return raw === undefined ? null : JSON.parse(raw); },
  };
}

/** 本地资料解析器：默认把认领接到真实曲库上（重绑整条链），也可换成桩。 */
function mediaResolver(load, behavior = {}) {
  const calls = [];
  const deps = {
    readLocal: async () => behavior.native || { signature: "sig-1", warnings: [] },
    readCache: async () => null,
    writeCache: async () => {},
    parse: async (raw) => (raw ? raw.split("\n").filter(Boolean).map((text, index) => ({ time: index + 1, text })) : []),
    search: async () => {
      calls.push("search");
      return behavior.search || { status: "matched", lyrics: [{ time: 1, text: "网络歌词" }], issues: [] };
    },
    now: () => 1000,
  };
  if (behavior.claim !== null) deps.claimOrphanedLyricsChoice = behavior.claim || behavior.storeRebind;
  const resolver = load("src/services/localMediaAssetsService.ts").createLocalMediaResolver(deps);
  return { resolve: (target) => resolver.resolve(target, () => {}, () => true), calls, deps };
}

test("改名后解析时按内容指纹重绑：picked 选择与文本搬回新记录，孤儿被清掉", async () => {
  const f = setup({
    existing: [pickedSong("1", "sig-1")],
    // 改名后 MediaStore 换了 _id（旧记录消失），内容指纹不变；文件自带的词证明重绑要显示选中的那份。
    native: nativeResult([nativeSong("renamed", { signature: "sig-1", lyrics: "文件自带歌词" })]),
  });
  await f.store.getState().scanMusic();
  const renamed = f.store.getState().localSongs[0];
  assert.equal(renamed.id, "renamed");
  assert.equal(renamed.lyricsMode, undefined);
  assert.deepEqual(f.orphans().map((item) => [item.mode, item.fingerprint, item.localLyrics]),
    [["picked", "sig-1", "选中的那份词"]]);

  const h = mediaResolver(f.load, { storeRebind: (target, fingerprint) => f.store.getState().claimOrphanedLyricsChoice(target, fingerprint) });
  const result = await h.resolve(renamed);
  assert.equal(result.status, "local");
  assert.equal(result.lyrics[0].text, "选中的那份词");
  assert.deepEqual(h.calls, []);            // picked 永不联网，重绑后的这一刻也不联网
  const restored = f.store.getState().localSongs[0];
  assert.equal(restored.lyricsMode, "picked");
  assert.equal(restored.lyricsFingerprint, "sig-1");
  assert.equal(restored.lyricsSourceLabel, "LRCLIB");
  assert.equal(restored.localLyrics, "选中的那份词");
  assert.equal(f.storage.get(ORPHAN_KEY), undefined);  // 命中搬回即删除，不留垃圾键

  // 已经搬回记录：下一次解析直接命中记录字段，不再经过孤儿表
  await f.store.getState().loadLocalSongs();
  const again = await h.resolve(f.store.getState().localSongs[0]);
  assert.equal(again.lyrics[0].text, "选中的那份词");
  assert.deepEqual(h.calls, []);
});

test("内容变了不重绑：指纹不同的文件不吃孤儿，选择静默失效回自动匹配", async () => {
  const f = setup({
    existing: [pickedSong("1", "sig-1")],
    native: nativeResult([nativeSong("renamed", { signature: "sig-1" })]),
  });
  await f.store.getState().scanMusic();
  assert.equal(f.orphans().length, 1);
  const renamed = f.store.getState().localSongs[0];

  // 文件内容被替换（signature 变了）：孤儿是给旧内容留的，不能被这份新内容吃掉
  const h = mediaResolver(f.load, {
    native: { signature: "sig-2", warnings: [] },
    storeRebind: (target, fingerprint) => f.store.getState().claimOrphanedLyricsChoice(target, fingerprint),
  });
  const result = await h.resolve(renamed);
  assert.equal(result.status, "matched");
  assert.equal(result.lyrics[0].text, "网络歌词");
  assert.deepEqual(h.calls, ["search"]);
  assert.equal(f.store.getState().localSongs[0].lyricsMode, undefined);
  assert.equal(f.orphans().length, 1);       // 孤儿原地等着真正的那份内容
});

test("记录自己的选择优先：指纹命中也不搬回，孤儿留给真正无主的记录", async () => {
  const f = setup({
    existing: [song("2", "mediaStore", { lyricsMode: "local-only", lyricsFingerprint: "sig-2" })],
    orphans: [{ fingerprint: "sig-2", mode: "picked", savedAt: 1, lyricsSourceLabel: "LRCLIB", localLyrics: "别人的词" }],
    native: nativeResult([nativeSong("2", { signature: "sig-2", lyrics: "旁挂 .lrc 歌词" })]),
  });
  await f.store.getState().scanMusic();
  const h = mediaResolver(f.load, {
    native: { signature: "sig-2", lyrics: "旁挂 .lrc 歌词", warnings: [] },
    storeRebind: (target, fingerprint) => f.store.getState().claimOrphanedLyricsChoice(target, fingerprint),
  });
  const result = await h.resolve(f.store.getState().localSongs[0]);
  assert.equal(result.status, "local");
  assert.equal(result.lyrics[0].text, "旁挂 .lrc 歌词");
  assert.deepEqual(h.calls, []);
  assert.equal(f.store.getState().localSongs[0].lyricsMode, "local-only");
  assert.equal(f.orphans().length, 1);
});

test("解析路径的认领卡口：记录有选择 / 没有指纹都不问，认领抛错不影响解析", async () => {
  const f = setup({});
  const asked = [];
  const claim = async (target, fingerprint) => { asked.push(fingerprint); return null; };

  const owned = mediaResolver(f.load, { claim, native: { signature: "sig-1", warnings: [] } });
  await owned.resolve({ ...song("1", "mediaStore"), lyricsMode: "local-only", lyricsFingerprint: "sig-1" });
  assert.deepEqual(asked, []);

  const unsigned = mediaResolver(f.load, { claim, native: { signature: "  ", warnings: [] } });
  await unsigned.resolve(song("1", "mediaStore"));
  assert.deepEqual(asked, []);

  const throwing = mediaResolver(f.load, {
    claim: async (target, fingerprint) => { asked.push(fingerprint); throw new Error("曲库不可用"); },
    native: { signature: "sig-9", warnings: [] },
  });
  const result = await throwing.resolve(song("1", "mediaStore"));
  assert.deepEqual(asked, ["sig-9"]);
  assert.equal(result.status, "matched");
  assert.equal(result.lyrics[0].text, "网络歌词");
  assert.deepEqual(result.issues, []);      // 重绑失败不得变成用户可见的问题
});

test("没有孤儿的认领是空操作：不写曲库也不写孤儿表", async () => {
  const f = setup({ existing: [song("1", "mediaStore")], native: nativeResult([nativeSong("1")]) });
  await f.store.getState().scanMusic();
  f.writes.length = 0;
  const before = f.storage.get(LOCAL_MUSIC_KEY);
  const patch = await f.store.getState().claimOrphanedLyricsChoice(f.store.getState().localSongs[0], "sig-1");
  assert.equal(patch, null);
  assert.deepEqual(f.writes, []);
  assert.equal(f.storage.get(LOCAL_MUSIC_KEY), before);
});

test("认领写盘失败时孤儿放回：一次存储故障不把用户的选择丢掉", async () => {
  const f = setup({
    existing: [pickedSong("1", "sig-1")],
    native: nativeResult([nativeSong("renamed", { signature: "sig-1" })]),
  });
  await f.store.getState().scanMusic();
  const renamed = f.store.getState().localSongs[0];
  f.writes.length = 0;
  // 第 1 次写入是取走孤儿，第 2 次是写回曲库：让它失败
  f.control.failWrite = 2;
  await assert.rejects(f.store.getState().claimOrphanedLyricsChoice(renamed, "sig-1"), /persist failed/);
  assert.equal(f.store.getState().localSongs[0].lyricsMode, undefined);
  assert.match(f.store.getState().error, /persist failed/);
  assert.deepEqual(f.orphans().map((item) => [item.mode, item.fingerprint, item.localLyrics]),
    [["picked", "sig-1", "选中的那份词"]]);

  f.control.failWrite = 0;
  const patch = await f.store.getState().claimOrphanedLyricsChoice(renamed, "sig-1");
  assert.equal(patch.lyricsMode, "picked");
  assert.equal(patch.localLyrics, "选中的那份词");
  assert.equal(f.storage.get(ORPHAN_KEY), undefined);
});

test("孤儿表只保留最近 200 条：超限淘汰入表最早的条目，同一指纹不重复占位", () => {
  const model = createLoader({})("src/services/localLyricsChoiceOrphanModel.ts");
  assert.equal(model.LOCAL_LYRICS_CHOICE_ORPHAN_LIMIT, 200);
  const incoming = Array.from({ length: 205 }, (_, index) => ({
    fingerprint: "sig-" + index, mode: "local-only", savedAt: index,
  }));
  const merged = model.mergeLyricsChoiceOrphans([], incoming);
  assert.equal(merged.length, 200);
  assert.equal(merged[0].fingerprint, "sig-5");
  assert.equal(merged.at(-1).fingerprint, "sig-204");

  const replayed = model.mergeLyricsChoiceOrphans(merged, [
    { fingerprint: "sig-100", mode: "picked", savedAt: 999, lyricsSourceLabel: "QQ音乐", localLyrics: "新词" },
  ]);
  assert.equal(replayed.length, 200);
  assert.equal(replayed.at(-1).fingerprint, "sig-100");
  assert.equal(replayed.at(-1).localLyrics, "新词");
  assert.equal(replayed.filter((item) => item.fingerprint === "sig-100").length, 1);
});

test("只有明确选择且带指纹的记录才进孤儿表", () => {
  const model = createLoader({})("src/services/localLyricsChoiceOrphanModel.ts");
  const build = (patch) => model.buildLyricsChoiceOrphan({ source: "local", id: "1", ...patch }, 7);
  assert.equal(build({}), null);
  assert.equal(build({ lyricsMode: "auto", lyricsFingerprint: "sig-1", localLyrics: "残留文本" }), null);
  assert.equal(build({ lyricsMode: "picked", localLyrics: "选中的词" }), null);        // 没有指纹
  assert.equal(build({ lyricsMode: "picked", lyricsFingerprint: "sig-1" }), null);     // picked 却没有文本
  assert.deepEqual(build({ lyricsMode: "picked", lyricsFingerprint: " sig-1 ", lyricsSourceLabel: " LRCLIB ", localLyrics: "选中的词" }),
    { fingerprint: "sig-1", mode: "picked", savedAt: 7, lyricsSourceLabel: "LRCLIB", localLyrics: "选中的词" });
  assert.deepEqual(build({ lyricsMode: "local-only", lyricsFingerprint: "sig-2", localLyrics: "不该带走" }),
    { fingerprint: "sig-2", mode: "local-only", savedAt: 7 });
});

test("孤儿表读盘容错：坏数据当空表、坏条目丢弃、同指纹后到覆盖先到", () => {
  const model = createLoader({})("src/services/localLyricsChoiceOrphanModel.ts");
  assert.deepEqual(model.parseLyricsChoiceOrphans(null), []);
  assert.deepEqual(model.parseLyricsChoiceOrphans("{broken"), []);
  assert.deepEqual(model.parseLyricsChoiceOrphans('{"not":"array"}'), []);
  const parsed = model.parseLyricsChoiceOrphans(JSON.stringify([
    { fingerprint: "sig-1", mode: "picked", savedAt: 1, localLyrics: "一份词" },
    { fingerprint: "", mode: "picked", savedAt: 2, localLyrics: "无指纹" },
    { fingerprint: "sig-2", mode: "unknown", savedAt: 3 },
    { fingerprint: "sig-3", mode: "picked", savedAt: 4 },                      // picked 缺文本
    { fingerprint: "sig-1", mode: "local-only", savedAt: 5, localLyrics: "后到覆盖先到" },
    "not-an-object",
  ]));
  assert.deepEqual(parsed, [{ fingerprint: "sig-1", mode: "local-only", savedAt: 5 }]);
  // 上面那条被丢弃的 picked 缺文本条目不应出现，最后一条同指纹条目覆盖了先到的 picked
  assert.equal(parsed.some((item) => item.localLyrics === "一份词"), false);
});

test("认领是原子的：命中即取走并删除，取走后不会再认回", async () => {
  const storage = new Map();
  const writes = [];
  const orphanStore = createLoader({
    "@react-native-async-storage/async-storage": {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { writes.push(key); storage.set(key, value); },
      removeItem: async (key) => { writes.push(key); storage.delete(key); },
    },
  })("src/services/localLyricsChoiceOrphanStore.ts");

  // 空表登记：连磁盘都不碰（重新扫描是常态操作）
  await orphanStore.rememberLyricsChoiceOrphans([]);
  assert.deepEqual(writes, []);

  const many = Array.from({ length: 201 }, (_, index) => ({
    fingerprint: "sig-" + index, mode: "local-only", savedAt: index,
  }));
  await orphanStore.rememberLyricsChoiceOrphans(many);
  const persisted = JSON.parse(storage.get(ORPHAN_KEY));
  assert.equal(persisted.length, 200);
  assert.equal(persisted[0].fingerprint, "sig-1");       // 最旧的一条被淘汰
  assert.equal(persisted.at(-1).fingerprint, "sig-200");

  const claimed = await orphanStore.claimLyricsChoiceOrphan("sig-100");
  assert.equal(claimed.fingerprint, "sig-100");
  assert.equal(JSON.parse(storage.get(ORPHAN_KEY)).some((item) => item.fingerprint === "sig-100"), false);
  assert.equal(await orphanStore.claimLyricsChoiceOrphan("sig-100"), null);
  assert.equal(await orphanStore.claimLyricsChoiceOrphan("   "), null);

  for (const orphan of JSON.parse(storage.get(ORPHAN_KEY))) {
    await orphanStore.claimLyricsChoiceOrphan(orphan.fingerprint);
  }
  assert.equal(storage.has(ORPHAN_KEY), false);          // 清空后不留「[]」垃圾键
});

test("运行时把认领接在真实曲库上：播放改名后的文件就走一次重绑", async () => {
  const f = setup({
    existing: [pickedSong("1", "sig-1")],
    native: nativeResult([nativeSong("renamed", { signature: "sig-1" })]),
  });
  await f.store.getState().scanMusic();
  assert.equal(f.orphans().length, 1);

  // 与 App 里同构：原生读取给出同一份内容的 SHA-256，本地曲库就是那个单例 store。
  const runtime = createLoader({
    "react-native-fs": { CachesDirectoryPath: "/app/cache" },
    "crypto-js": mobileRequire("crypto-js"),
    "react-native": { NativeModules: { LocalMusicModule: {
      readAudioAssets: async () => ({ signature: "sig-1", warnings: [] }),
    } } },
    "./musicApi": { getLyrics: async (target) => (target.localLyrics ? [{ time: 1, text: target.localLyrics }] : []) },
    "./localMediaSearchService": { findLocalMediaAssets: async () => { throw new Error("重绑后的 picked 不得联网"); } },
    "./cacheService": { enforceCacheSizeLimit: async () => {} },
    "./fileDownloadCommit": {
      createPartialDownloadPath: (key) => key + ".part",
      commitDownloadedFile: async () => {},
      discardPartialDownload: async () => {},
    },
    "@/stores/localMusicStore": { useLocalMusicStore: f.store },
  })("src/services/localMediaRuntime.ts");

  const result = await runtime.resolveLocalMediaAssets(f.store.getState().localSongs[0], () => {}, () => true);
  assert.equal(result.status, "local");
  assert.equal(result.lyrics[0].text, "选中的那份词");
  const restored = f.store.getState().localSongs[0];
  assert.equal(restored.lyricsMode, "picked");
  assert.equal(restored.localLyrics, "选中的那份词");
  assert.equal(f.storage.get(ORPHAN_KEY), undefined);
});
