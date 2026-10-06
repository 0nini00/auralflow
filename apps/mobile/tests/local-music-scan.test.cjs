const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire, deferred } = require("./helpers/loadTs.cjs");

const MEDIA_SCOPE = "mediaStore:external:music";
const DOWNLOAD_SCOPE = "download:app";
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
  ...(origin === "download" ? { localScan: { scope: DOWNLOAD_SCOPE } } : {}),
  ...patch,
});
const nativeResult = (songs) => ({ scope: MEDIA_SCOPE, complete: true, songs });

function setup(options = {}) {
  const storage = new Map([["auralflow.mobile.localMusic", JSON.stringify(options.existing || [])],
    ["history-playlists", "keep-user-history"]]);
  const writes = [];
  const calls = [];
  let downloadLoaded = false;
  const downloadState = {
    downloads: options.downloads || [], error: null,
    loadDownloads: async () => { downloadLoaded = true; downloadState.error = options.downloadError || null; },
  };
  const load = createLoader({
    zustand: { create: (initializer) => mobileRequire("zustand/vanilla").createStore(initializer) },
    "@react-native-async-storage/async-storage": {
      getItem: async (key) => { if (options.loadError) throw new Error(options.loadError); return storage.get(key) ?? null; },
      setItem: async (key, value) => {
        writes.push(key);
        const index = writes.length;
        if (options.failWrite === index) throw new Error("local persistence failed");
        storage.set(key, value);
        if (index === 1 && options.persistGate) {
          options.persistStarted.resolve();
          await options.persistGate.promise;
        }
      },
      removeItem: async (key) => {
        writes.push(key);
        if (options.failWrite === writes.length) throw new Error("local persistence failed");
        storage.delete(key);
        if (writes.length === 1 && options.persistGate) {
          options.persistStarted.resolve();
          await options.persistGate.promise;
        }
      },
    },
    "react-native": { Platform: { OS: "android", Version: 35 }, NativeModules: { LocalMusicModule: {
      scanLocalMusic: async (...args) => {
        calls.push(args);
        if (options.nativeError) throw new Error(options.nativeError);
        const result = options.scanGate ? await options.scanGate.promise
          : Object.hasOwn(options, "native") ? options.native : nativeResult([]);
        // 同时模拟旧数组桥与新范围桥，让 RED 指向行为缺失而非夹具类型错误。
        return args.length === 0 && result?.complete === true && result.scope === MEDIA_SCOPE
          ? result.songs : result;
      },
      pickLocalAudioFiles: async () => options.picked || [],
      updateAudioMetadata: async () => 1,
    } } },
    "react-native-permissions": {
      PERMISSIONS: { ANDROID: { READ_MEDIA_AUDIO: "audio", READ_EXTERNAL_STORAGE: "storage" } },
      RESULTS: { GRANTED: "granted" },
      check: async () => { if (options.permissionError) throw new Error(options.permissionError); return options.denied ? "denied" : "granted"; },
      request: async () => "denied",
    },
    "react-native-fs": {
      DocumentDirectoryPath: "/app",
      exists: async (path) => { if (options.fsError) throw new Error(options.fsError); return !path.endsWith(".lrc") && !options.missingFiles && !options.missingPaths?.includes(path); },
      readFile: async () => { throw new Error("unexpected read"); },
    },
    "@/stores/downloadStore": { useDownloadStore: { getState: () => downloadState } },
  });
  return {
    store: load("src/stores/localMusicStore.ts").useLocalMusicStore,
    service: load("src/services/localMusicService.ts"), load, storage, writes, calls,
    downloadLoaded: () => downloadLoaded,
  };
}

test("完整扫描更新同键元数据、新增并按范围删除，保留手动及其他范围", async () => {
  const f = setup({ existing: [song("1", "mediaStore"), song("2", "mediaStore"), song("3", "manual"),
    song("4", "mediaStore", { localScan: { scope: "mediaStore:other", signature: "old" } }),
    song("dl-old", "download")], missingPaths: ["/music/dl-old.mp3"],
    native: nativeResult([nativeSong("1", { title: "新标题", lyrics: "新歌词" }), nativeSong("5")]) });
  await f.store.getState().scanMusic();
  const songs = f.store.getState().localSongs;
  assert.deepEqual(songs.map((s) => s.id), ["1", "3", "4", "5"]);
  assert.equal(songs[0].name, "新标题");
  assert.equal(songs[0].localLyrics, "新歌词");
  assert.equal(songs.at(-1).localOrigin, "mediaStore");
  assert.equal(f.storage.get("history-playlists"), "keep-user-history");
  assert.deepEqual(f.writes, ["auralflow.mobile.localMusic"]);
});

test("同签名只复用昂贵标签，不复用过期基础元数据", async () => {
  const cached = song("1", "mediaStore", { localLyrics: "缓存歌词", picUrl: "file:///cover.jpg", img: "file:///cover.jpg" });
  const f = setup({ existing: [cached], native: nativeResult([nativeSong("1", { title: "MediaStore 新标题", tagsUnchanged: true })]) });
  await f.store.getState().scanMusic();
  assert.deepEqual(f.calls, [[{ "1": "sig-1" }]]);
  assert.equal(f.store.getState().localSongs[0].localLyrics, "缓存歌词");
  assert.equal(f.store.getState().localSongs[0].picUrl, "file:///cover.jpg");
  assert.equal(f.store.getState().localSongs[0].name, "MediaStore 新标题");
});

test("签名变化会替换并清除已移除的歌词和封面", async () => {
  const f = setup({ existing: [song("1", "mediaStore", { localLyrics: "旧歌词", picUrl: "old", img: "old" })],
    native: nativeResult([nativeSong("1", { signature: "changed" })]) });
  await f.store.getState().scanMusic();
  const actual = f.store.getState().localSongs[0];
  assert.equal(actual.localLyrics, undefined);
  assert.equal(actual.picUrl, undefined);
  assert.equal(actual.localScan.signature, "changed");
});

test("手动导入与扫描同键时保留手动所有权，后续空扫描不删除", async () => {
  const f = setup({ existing: [song("1", "mediaStore")], picked: [nativeSong("1")] });
  assert.deepEqual(await f.store.getState().importLocalFiles(), { added: 0, total: 1 });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs[0].localOrigin, "manual");
});

test("既有无来源持久化数据不按数字或 dl 前缀猜测并删除", async () => {
  const f = setup({ existing: [song("1"), song("dl-kg-2"), song("content://document/3")],
    native: nativeResult([nativeSong("1")]) });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 3);
  assert.ok(f.store.getState().localSongs.every((s) => s.localOrigin === "legacy"));
  assert.equal(f.store.getState().localSongs[0].name, "标题");
  const restored = setup({ existing: JSON.parse(f.storage.get("auralflow.mobile.localMusic")) });
  await restored.store.getState().scanMusic();
  assert.equal(restored.store.getState().localSongs.length, 3);
});

for (const [name, options, message] of [
  ["权限拒绝", { denied: true }, /权限/],
  ["权限检查异常", { permissionError: "permission backend failed" }, /permission backend failed/],
  ["原生查询失败", { nativeError: "query failed" }, /query failed/],
  ["原生 null", { native: null }, /扫描结果/],
  ["原生不完整结果", { native: { scope: MEDIA_SCOPE, complete: false, songs: [] } }, /扫描结果/],
  ["原生未知范围", { native: { scope: "other", complete: true, songs: [] } }, /扫描结果/],
  ["原生损坏条目", { native: nativeResult([{}]) }, /扫描结果/],
  ["下载文件检查失败", { downloads: [{ localPath: "/app/1.mp3", song: { id: "1", source: "kg", name: "下载" } }], fsError: "filesystem denied" }, /filesystem denied/],
  ["下载记录加载失败", { downloadError: "downloads unavailable" }, /downloads unavailable/],
]) {
  test(name + "不写入或删除本地曲库", async () => {
    const f = setup({ existing: [song("1", "mediaStore"), song("dl-old", "download")], ...options });
    const before = f.storage.get("auralflow.mobile.localMusic");
    await assert.rejects(f.store.getState().scanMusic(), message);
    assert.equal(f.store.getState().localSongs.length, 2);
    assert.equal(f.storage.get("auralflow.mobile.localMusic"), before);
    assert.deepEqual(f.writes, []);
    assert.equal(f.store.getState().loading, false);
    assert.match(f.store.getState().error, message);
  });
}

test("曲库加载失败不能在空内存态继续扫描写坏历史", async () => {
  const f = setup({ existing: [song("old")], loadError: "storage unavailable", native: nativeResult([]) });
  await assert.rejects(f.store.getState().scanMusic(), /storage unavailable/);
  await assert.rejects(f.store.getState().scanMusic(), /storage unavailable/);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.calls, []);
});

test("下载先完成持久化加载，来源独立且不存在文件可安全移除", async () => {
  const f = setup({ downloads: [{ localPath: "/app/new.mp3", song: { id: "8", source: "kg", name: "下载" } }] });
  await f.store.getState().scanMusic();
  assert.equal(f.downloadLoaded(), true);
  assert.equal(f.store.getState().localSongs[0].localOrigin, "download");
  const missing = setup({ existing: f.store.getState().localSongs, missingFiles: true,
    downloads: [{ localPath: "/app/new.mp3", song: { id: "8", source: "kg", name: "下载" } }] });
  await missing.store.getState().scanMusic();
  assert.deepEqual(missing.store.getState().localSongs, []);
});

test("原生声称命中未提供的缓存或签名不一致时显式拒绝", async () => {
  const f = setup({ native: nativeResult([nativeSong("1", { tagsUnchanged: true })]) });
  await assert.rejects(f.store.getState().scanMusic(), /缓存/);
  assert.deepEqual(f.writes, []);
});

test("扫描等待期间新手动导入不被旧快照覆盖", async () => {
  const gate = deferred();
  const f = setup({ scanGate: gate, picked: [nativeSong("manual")] });
  const scanning = f.store.getState().scanMusic();
  await f.store.getState().importLocalFiles();
  gate.resolve(nativeResult([]));
  await scanning;
  assert.equal(f.store.getState().localSongs[0].localOrigin, "manual");
});

test("原生扫描桥使用文件签名控制昂贵解析，null 查询拒绝而非成功空库", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const java = fs.readFileSync(path.resolve(__dirname, "../android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicModule.java"), "utf8");
  const scan = java.slice(java.indexOf("public void scanLocalMusic("), java.indexOf("public void updateAudioMetadata("));
  assert.match(scan, /scanLocalMusic\(ReadableMap knownSignatures, Promise promise\)/);
  assert.match(scan, /MediaStore\.Audio\.Media\.DATE_MODIFIED/);
  assert.match(scan, /MediaStore\.Audio\.Media\.SIZE/);
  assert.match(scan, /if \(cursor == null\)\s*\{\s*throw new/);
  assert.match(scan, /if \(!tagsUnchanged\)\s*\{/);
  assert.ok(scan.indexOf("if (!tagsUnchanged)") < scan.indexOf("resolveLyrics("));
  assert.match(scan, /putBoolean\("complete", true\)/);
  assert.match(java, /lastModified\(\)/);
  assert.match(java, /length\(\)/);
});

test("下载索引为空不证明文件消失，已有下载文件仍在时保留记录", async () => {
  const f = setup({ existing: [song("dl-existing", "download")] });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 1);
  assert.equal(f.store.getState().localSongs[0].localOrigin, "download");
});

test("下载索引为空时检查既有下载文件仍须传播文件系统异常", async () => {
  const f = setup({ existing: [song("dl-existing", "download")], fsError: "existing download unreadable" });
  await assert.rejects(f.store.getState().scanMusic(), /existing download unreadable/);
  assert.deepEqual(f.writes, []);
});

function storedSongs(f) {
  return JSON.parse(f.storage.get("auralflow.mobile.localMusic") || "[]");
}

for (const action of ["import", "remove", "edit", "clear", "load"]) {
  test("扫描持久化暂停时并发 " + action + "，所有变更经过唯一提交边界", async () => {
    const persistGate = deferred();
    const persistStarted = deferred();
    const f = setup({ existing: [song("dl-1", "download")], persistGate, persistStarted,
      native: nativeResult([nativeSong("1")]), picked: [nativeSong("manual")] });
    const scanning = f.store.getState().scanMusic();
    await persistStarted.promise;
    const actions = {
      import: () => f.store.getState().importLocalFiles(),
      remove: () => f.store.getState().removeLocalSong(song("dl-1", "download")),
      edit: () => f.store.getState().updateLocalSongMetadata(song("dl-1", "download"), { name: "用户改名", singer: "用户歌手", albumName: "用户专辑" }),
      clear: () => f.store.getState().clearLocalMusic(),
      load: () => f.store.getState().loadLocalSongs(),
    };
    let finished = false;
    const changing = actions[action]().then(() => { finished = true; });
    await new Promise(setImmediate);
    const completedWhilePersistPending = finished;
    persistGate.resolve();
    await Promise.all([scanning, changing]);
    assert.equal(completedWhilePersistPending, false, "不能在先前提交未完成时交错发布曲库");
    assert.deepEqual(JSON.parse(JSON.stringify(f.store.getState().localSongs)), storedSongs(f));
    if (action === "import") assert.deepEqual(storedSongs(f).map((s) => s.id), ["dl-1", "1", "manual"]);
    if (action === "remove") assert.deepEqual(storedSongs(f).map((s) => s.id), ["1"]);
    if (action === "edit") assert.equal(storedSongs(f)[0].name, "用户改名");
    if (action === "clear") assert.deepEqual(storedSongs(f), []);
  });
}

for (const action of ["import", "remove", "edit", "clear"]) {
  test(action + "持久化失败显式拒绝且内存不先行发布，队列随后可继续", async () => {
    const f = setup({ existing: [song("dl-1", "download")], failWrite: 1, picked: [nativeSong("manual")] });
    await f.store.getState().loadLocalSongs();
    const before = f.store.getState().localSongs;
    const actions = {
      import: () => f.store.getState().importLocalFiles(),
      remove: () => f.store.getState().removeLocalSong(song("dl-1", "download")),
      edit: () => f.store.getState().updateLocalSongMetadata(song("dl-1", "download"), { name: "用户改名", singer: "歌手", albumName: "专辑" }),
      clear: () => f.store.getState().clearLocalMusic(),
    };
    await assert.rejects(actions[action](), /local persistence failed/);
    assert.deepEqual(f.store.getState().localSongs, before);
    assert.equal(typeof f.store.getState().error, "string");
    assert.match(f.store.getState().error, /local persistence failed/);
    await f.store.getState().importLocalFiles();
    assert.deepEqual(JSON.parse(JSON.stringify(f.store.getState().localSongs)), storedSongs(f));
    assert.deepEqual(storedSongs(f).map((s) => s.id), ["dl-1", "manual"]);
  });
}

test("下载入库后用户编辑字段刷新及重新加载后保留，未编辑字段继续更新", async () => {
  const item = { localPath: "/app/8.mp3", song: { id: "8", source: "kg", name: "下载原名", singer: "原歌手", albumName: "原专辑", interval: 100, picUrl: "original-cover" } };
  const f = setup({ downloads: [item] });
  await f.store.getState().scanMusic();
  const downloaded = f.store.getState().localSongs[0];
  await f.store.getState().updateLocalSongMetadata(downloaded, {
    name: "用户改名", singer: "用户歌手", albumName: "用户专辑", coverUrl: "user-cover", localLyrics: "用户歌词",
  });
  item.song.interval = 200;
  await f.store.getState().scanMusic();
  const edited = f.store.getState().localSongs[0];
  assert.equal(edited.name, "用户改名");
  assert.equal(edited.singer, "用户歌手");
  assert.equal(edited.albumName, "用户专辑");
  assert.equal(edited.picUrl, "user-cover");
  assert.equal(edited.localLyrics, "用户歌词");
  assert.equal(edited.interval, 200);
  const restored = setup({ existing: storedSongs(f), downloads: [item] });
  await restored.store.getState().scanMusic();
  assert.equal(restored.store.getState().localSongs[0].name, "用户改名");
  assert.equal(restored.store.getState().localSongs[0].localLyrics, "用户歌词");
});

test("下载扫描等待期间完成的用户编辑按提交时当前态保留", async () => {
  const scanGate = deferred();
  const f = setup({ scanGate, existing: [song("dl-kg-8", "download")],
    downloads: [{ localPath: "/app/8.mp3", song: { id: "8", source: "kg", name: "原下载名" } }] });
  const scanning = f.store.getState().scanMusic();
  await f.store.getState().updateLocalSongMetadata(song("dl-kg-8", "download"), { name: "并发改名", singer: "歌手", albumName: "专辑" });
  scanGate.resolve(nativeResult([]));
  await scanning;
  assert.equal(f.store.getState().localSongs[0].name, "并发改名");
  assert.equal(storedSongs(f)[0].name, "并发改名");
});

test("下载改名只锁定实际修改字段，未修改的歌手专辑封面继续刷新", async () => {
  const item = { localPath: "/app/8.mp3", song: { id: "8", source: "kg", name: "原名", singer: "原歌手", albumName: "原专辑", picUrl: "old-cover" } };
  const f = setup({ downloads: [item] });
  await f.store.getState().scanMusic();
  await f.store.getState().updateLocalSongMetadata(f.store.getState().localSongs[0], { name: "改名", singer: "原歌手", albumName: "原专辑" });
  Object.assign(item.song, { singer: "新歌手", albumName: "新专辑", picUrl: "new-cover" });
  await f.store.getState().scanMusic();
  const actual = f.store.getState().localSongs[0];
  assert.equal(actual.name, "改名");
  assert.equal(actual.singer, "新歌手");
  assert.equal(actual.albumName, "新专辑");
  assert.equal(actual.picUrl, "new-cover");
  assert.deepEqual(actual.localEditedFields, ["name"]);
});

test("下载用户清空封面在重载刷新后仍保持为空", async () => {
  const item = { localPath: "/app/8.mp3", song: { id: "8", source: "kg", name: "原名", singer: "歌手", albumName: "专辑", picUrl: "old-cover" } };
  const f = setup({ downloads: [item] });
  await f.store.getState().scanMusic();
  await f.store.getState().updateLocalSongMetadata(f.store.getState().localSongs[0], { name: "原名", singer: "歌手", albumName: "专辑", coverUrl: "" });
  const restored = setup({ existing: storedSongs(f), downloads: [item] });
  await restored.store.getState().scanMusic();
  assert.equal(restored.store.getState().localSongs[0].picUrl, undefined);
  assert.equal(restored.store.getState().localSongs[0].img, undefined);
});
