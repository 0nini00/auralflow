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
  const recoveryCalls = [];
  const progressListeners = new Set();
  const metadataCalls = [];
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
    "react-native": {
      Platform: { OS: "android", Version: 35 },
      DeviceEventEmitter: { addListener: (_name, listener) => {
        progressListeners.add(listener);
        return { remove: () => progressListeners.delete(listener) };
      } },
      NativeModules: { LocalMusicModule: {
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
      updateAudioMetadata: async (...args) => { metadataCalls.push(args); return 1; },
    } } },
    "react-native-permissions": {
      PERMISSIONS: { ANDROID: { READ_MEDIA_AUDIO: "audio", READ_EXTERNAL_STORAGE: "storage" } },
      RESULTS: { GRANTED: "granted" },
      check: async () => { if (options.permissionError) throw new Error(options.permissionError); return options.denied ? "denied" : "granted"; },
      request: async () => "denied",
    },
    "react-native-fs": {
      DocumentDirectoryPath: "/app",
      ExternalStorageDirectoryPath: "/storage/emulated/0",
      exists: async (path) => { if (options.fsError) throw new Error(options.fsError); return !path.endsWith(".lrc") && !options.missingFiles && !options.missingPaths?.includes(path); },
      readFile: async () => { throw new Error("unexpected read"); },
    },
    "@/stores/downloadStore": { useDownloadStore: { getState: () => downloadState } },
    "@/services/downloadDirectoryService": {
      findDownloadDirectoryFile: async (prefix) => {
        recoveryCalls.push(prefix);
        return options.recoveredUri ?? null;
      },
    },
  });
  return {
    store: load("src/stores/localMusicStore.ts").useLocalMusicStore,
    service: load("src/services/localMusicService.ts"), load, storage, writes, calls, recoveryCalls,
    downloadLoaded: () => downloadLoaded, metadataCalls,
    progress: value => progressListeners.forEach(listener => listener(value)),
    progressListeners,
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

// 同一音频被下载记录与 MediaStore 同时发现时只能保留一个播放条目。
for (const localPath of [
  '/storage/emulated/0/Music/wy-8-320k.mp3',
  'content://com.android.externalstorage.documents/document/primary%3AMusic%2Fwy-8-320k.mp3',
  'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2Fwy-8-320k.mp3',
]) {
  test('按文件身份合并下载和系统扫描：' + localPath, async () => {
    const f = setup({
      native: nativeResult([nativeSong('42', { filePath: '/storage/emulated/0/Music/wy-8-320k.mp3' })]),
      downloads: [{ localPath, song: { id: '8', source: 'wy', name: '同一文件' } }],
    });
    await f.store.getState().scanMusic();
    assert.equal(f.store.getState().localSongs.length, 1);
    assert.equal(f.store.getState().localSongs[0].id, '42');
    assert.equal(f.store.getState().localSongs[0].localOrigin, 'download');
  });
}

// 去重不能按歌名或大小写猜测不同文件的身份。
test('同名但不同路径、仅文件名大小写不同的歌曲都保留', async () => {
  const f = setup({ native: nativeResult([
    nativeSong('1', { filePath: '/music/Song.mp3' }),
    nativeSong('2', { filePath: '/music/song.mp3' }),
    nativeSong('3', { filePath: '/other/Song.mp3' }),
  ]) });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 3);
});

// 历史重复条目合并后保留已有引用及用户编辑，但写回仍使用真正的 MediaStore ID。
test('消除历史重复保留原ID和用户编辑，缓存使用系统ID、下载编辑仍只写曲库', async () => {
  const filePath = '/storage/emulated/0/Music/wy-8-320k.mp3';
  const old = song('dl-wy-8', 'download', {
    url: `file://${filePath}`, name: '用户改名', localEditedFields: ['name'],
  });
  const options = {
    existing: [old, song('42', 'mediaStore', { url: `file://${filePath}` })],
    native: nativeResult([nativeSong('42', { filePath, lyrics: '文件歌词' })]),
    downloads: [{ localPath: filePath, song: { id: '8', source: 'wy', name: '下载标题' } }],
  };
  const f = setup(options);
  await f.store.getState().scanMusic();
  const [actual] = f.store.getState().localSongs;
  assert.equal(f.store.getState().localSongs.length, 1);
  assert.equal(actual.id, old.id);
  assert.equal(actual.name, '用户改名');
  assert.equal(actual.localLyrics, '文件歌词');
  const restored = setup({ ...options, existing: storedSongs(f), native: nativeResult([nativeSong('42', { filePath, tagsUnchanged: true })]) });
  await restored.store.getState().scanMusic();
  assert.deepEqual(restored.calls, [[{ '42': 'sig-42' }]]);
  await restored.store.getState().updateLocalSongMetadata(actual, { name: '再次改名', singer: '歌手', albumName: '专辑' });
  assert.equal(restored.metadataCalls.length, 0);
  assert.equal(restored.store.getState().localSongs[0].name, '再次改名');
});

// 手动导入与扫描共用文件身份规则，不能在导入入口重新制造重复。
test('已扫描文件再次手动导入只更新一条并保留手动所有权', async () => {
  const f = setup({ existing: [song('42', 'mediaStore')], picked: [nativeSong('manual-uri', { filePath: '/music/42.mp3' })] });
  const result = await f.store.getState().importLocalFiles();
  assert.deepEqual(result, { added: 0, total: 1 });
  assert.equal(f.store.getState().localSongs[0].id, '42');
  assert.equal(f.store.getState().localSongs[0].localOrigin, 'manual');
});

// 部分标签失败不等于曲目扫描失败，诊断必须交给调用方且下次重扫不能假命中缓存。
test('逐曲标签警告保留已有歌词并返回诊断，不缓存失败的标签签名', async () => {
  const warning = 'EMBEDDED_LYRICS_FAILED: CannotReadException: unsupported';
  const f = setup({ existing: [song('1', 'mediaStore', { localLyrics: '已有歌词' })],
    native: nativeResult([nativeSong('1', { signature: 'new', warnings: [warning] }), nativeSong('2')]) });
  const result = await f.store.getState().scanMusic();
  assert.equal(result.total, 2);
  assert.deepEqual(result.warnings, [{ id: '1', name: '标题', message: warning }]);
  assert.equal(f.store.getState().localSongs[0].localLyrics, '已有歌词');
  assert.equal(f.store.getState().localSongs[0].localScan.signature, undefined);
  await f.store.getState().scanMusic();
  assert.deepEqual(f.calls[1], [{ '2': 'sig-2' }]);
});

// 原生警告属于外部输入，畸形结果必须阻止提交。
test('原生返回非法warning数组时拒绝整批提交', async () => {
  const f = setup({ native: nativeResult([nativeSong('1', { warnings: [null] })]) });
  await assert.rejects(f.store.getState().scanMusic(), /扫描结果/);
  assert.deepEqual(f.writes, []);
});

// 首次去重时下载条目还没有系统ID，仍要按同文件保住先前已读取的歌词。
test('下载条目首次与系统文件合并遇到标签警告时不清掉已有歌词', async () => {
  const filePath = '/storage/emulated/0/Music/song.aac';
  const f = setup({ existing: [song('dl-wy-8', 'download', { url: `file://${filePath}`, localLyrics: '已有歌词' })],
    native: nativeResult([nativeSong('42', { filePath, warnings: ['EMBEDDED_LYRICS_FAILED: unsupported'] })]) });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 1);
  assert.equal(f.store.getState().localSongs[0].localLyrics, '已有歌词');
});

// primary 根目录来自当前设备，SD卡与同名文件保持独立身份。
test('文件身份不误合并不同卷或字面百分号，并拒绝损坏的文档编码', () => {
  const { localMusicFileKey: key } = createLoader({})('src/services/localMusicScanModel.ts');
  const primary = 'content://com.android.externalstorage.documents/document/primary%3AMusic%2Fsong.mp3';
  assert.equal(key(primary, '/storage/emulated/10'), key('file:///storage/emulated/10/Music/song.mp3'));
  assert.notEqual(key(primary, '/storage/emulated/10'), key('file:///storage/emulated/0/Music/song.mp3'));
  assert.equal(key('content://com.android.externalstorage.documents/document/ABCD-1234%3AMusic%2Fsong.mp3'), key('file:///storage/ABCD-1234/Music/song.mp3'));
  assert.notEqual(key('file:///music/a%20b.mp3'), key('file:///music/a b.mp3'));
  assert.throws(() => key('content://com.android.externalstorage.documents/document/primary%ZZ'), /编码/);
});

// 文档提供方的数字ID不是MediaStore ID，合并不能把已有系统绑定写成另一个文件。
test('手动文档导入不能覆盖同文件的可信系统ID', async () => {
  const f = setup({ existing: [song('42', 'mediaStore', { localMediaId: '42' })],
    picked: [nativeSong('7', { filePath: '/music/42.mp3', contentUri: 'content://downloads/document/7' })] });
  await f.store.getState().importLocalFiles();
  assert.equal(f.store.getState().localSongs[0].localMediaId, '42');
  await f.store.getState().updateLocalSongMetadata(f.store.getState().localSongs[0], { name: '改名', singer: '歌手', albumName: '专辑' });
  assert.equal(f.metadataCalls[0][0], '42');
});

// 不同提供方碰巧使用相同数字ID时，手动音频和系统音频也必须是两首。
test('不同提供方相同数字ID但文件不同，不覆盖手动导入曲目', async () => {
  const f = setup({ picked: [nativeSong('7', { filePath: '/music/manual.mp3', contentUri: 'content://downloads/document/7' })],
    native: nativeResult([nativeSong('7', { filePath: '/music/system.mp3' })]) });
  await f.store.getState().importLocalFiles();
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 2);
  assert.equal(new Set(f.store.getState().localSongs.map(song => song.id)).size, 2);
  assert.deepEqual(f.store.getState().localSongs.map(song => song.url), ['file:///music/manual.mp3', 'file:///music/system.mp3']);
});

// 旧版已存数字ID的手动曲目也不能被本轮系统扫描覆盖。
test('旧手动记录数字ID冲突时保留原条目，系统曲目使用独立ID', async () => {
  const f = setup({ existing: [song('7', 'manual', { url: 'file:///music/manual.mp3' })],
    native: nativeResult([nativeSong('7', { filePath: '/music/system.mp3' })]) });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 2);
  assert.equal(new Set(f.store.getState().localSongs.map(song => song.id)).size, 2);
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 2);
});

// MediaStore暂时不再索引文件，不能把尚存在的已下载歌曲从本地曲库移除。
test('同文件合并后清除下载历史并退出系统索引，已知文件仍存在就保留', async () => {
  const filePath = '/storage/emulated/0/Music/wy-8-320k.mp3';
  const f = setup({ native: nativeResult([nativeSong('42', { filePath })]),
    downloads: [{ localPath: filePath, song: { id: '8', source: 'wy', name: '下载歌曲' } }] });
  await f.store.getState().scanMusic();
  const restored = setup({ existing: storedSongs(f), native: nativeResult([]), downloads: [] });
  await restored.store.getState().scanMusic();
  assert.equal(restored.store.getState().localSongs.length, 1);
  const missing = setup({ existing: storedSongs(restored), missingFiles: true });
  await missing.store.getState().scanMusic();
  assert.equal(missing.store.getState().localSongs.length, 0);
});

// 系统扫描、下载历史、已入库下载同时指向一份文件时，最后一个旧候选不能盖回陈旧标签。
test('三个来源重复命中同文件时仍采用本轮系统标签', async () => {
  const filePath = '/storage/emulated/0/Music/wy-8-320k.mp3';
  const f = setup({ existing: [song('42', 'download', { url: `file://${filePath}`, name: '旧曲库标题', localMediaId: '42' })],
    native: nativeResult([nativeSong('42', { filePath, title: '新文件标题', lyrics: '新文件歌词' })]),
    downloads: [{ localPath: filePath, song: { id: '8', source: 'wy', name: '旧下载标题' } }] });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 1);
  assert.equal(f.store.getState().localSongs[0].name, '新文件标题');
  assert.equal(f.store.getState().localSongs[0].localLyrics, '新文件歌词');
});

// 两个调用必须共享一次原生扫描，不能排队重复整库扫描。
test('并发扫描共享任务，只有一轮原生请求与提交', async () => {
  const scanGate = deferred();
  const f = setup({ scanGate });
  const a = f.store.getState().scanMusic();
  const b = f.store.getState().scanMusic();
  await new Promise(setImmediate);
  const calls = f.calls.length;
  scanGate.resolve(nativeResult([nativeSong('1')]));
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(f.writes.length, 1);
});

// Promise.all 早退曾使仍在运行的原生请求把失败状态改回扫描进度。
test('分支失败后停止接收进度，等待原生结算后才释放扫描任务', async () => {
  const scanGate = deferred();
  const options = { scanGate, downloadError: 'downloads unavailable' };
  const f = setup(options);
  let finished = false;
  const scanning = f.store.getState().scanMusic().then(() => null, error => { finished = true; return error; });
  await new Promise(setImmediate);
  f.progress({ scanned: 50, total: 100 });
  const progressAfterFailure = f.store.getState().scanProgress;
  const finishedBeforeNative = finished;
  const retry = f.store.getState().scanMusic().catch(error => error);
  await new Promise(setImmediate);
  const requests = f.calls.length;
  scanGate.resolve(nativeResult([nativeSong('1')]));
  assert.match((await scanning).message, /downloads unavailable/);
  await retry;
  assert.equal(finishedBeforeNative, false);
  assert.equal(requests, 1);
  assert.equal(progressAfterFailure, null);
  assert.equal(f.store.getState().loading, false);
  assert.equal(f.store.getState().scanProgress, null);
  assert.equal(f.progressListeners.size, 0);
  assert.deepEqual(f.writes, []);
  options.downloadError = null;
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 1);
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

test("下载到外部文件夹的 content URI 记录重扫后仍进入本地曲库", async () => {
  const localPath = "content://com.android.externalstorage.documents/document/primary%3AMusic%2Fsong.flac";
  const f = setup({ downloads: [{ localPath, song: { id: "42", source: "wy", name: "外部下载" } }] });
  await f.store.getState().scanMusic();
  const downloaded = f.store.getState().localSongs[0];
  assert.equal(downloaded.localOrigin, "download");
  assert.equal(downloaded.url, localPath);
  assert.equal(downloaded.name, "外部下载");
});

test("下载记录路径失效时保留曲库中仍有效的同曲下载条目", async () => {
  const f = setup({
    existing: [song("dl-kg-8", "download", { url: "file:///app/8.mp3", name: "仍有效" })],
    downloads: [{ localPath: "/app/missing.mp3", song: { id: "8", source: "kg", name: "失效记录" } }],
    missingPaths: ["/app/missing.mp3"],
  });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 1);
  assert.equal(f.store.getState().localSongs[0].name, "仍有效");
  assert.equal(f.store.getState().localSongs[0].url, "file:///app/8.mp3");
});

test("同曲多条下载记录中只要有一条文件存在就保留本地条目", async () => {
  const f = setup({
    downloads: [
      { localPath: "/app/existing.mp3", song: { id: "8", source: "kg", name: "有效记录" } },
      { localPath: "/app/missing.mp3", song: { id: "8", source: "kg", name: "失效记录" } },
    ],
    missingPaths: ["/app/missing.mp3"],
  });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 1);
  assert.equal(f.store.getState().localSongs[0].name, "有效记录");
  assert.equal(f.store.getState().localSongs[0].url, "file:///app/existing.mp3");
});

test("下载记录指向的私有文件被移动后，按文件名前缀从所选文件夹找回", async () => {
  const recoveredUri = "content://com.android.externalstorage.documents/document/primary%3AMusic%2Fkg-8-320k.mp3";
  const f = setup({
    downloads: [{ localPath: "/app/missing.mp3", song: { id: "8", source: "kg", name: "被移动的下载" } }],
    missingPaths: ["/app/missing.mp3"],
    recoveredUri,
  });
  await f.store.getState().scanMusic();
  assert.deepEqual(f.recoveryCalls, ["kg-8-320k."]);
  assert.equal(f.store.getState().localSongs.length, 1);
  assert.equal(f.store.getState().localSongs[0].name, "被移动的下载");
  assert.equal(f.store.getState().localSongs[0].url, recoveredUri);
  assert.equal(f.store.getState().localSongs[0].recoveryPrefix, undefined);
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
  assert.ok(scan.indexOf("if (!tagsUnchanged)") < scan.indexOf("LocalAudioAssetsReader.readLyrics("));
  assert.match(scan, /putBoolean\("complete", true\)/);
  assert.match(java, /lastModified\(\)/);
  assert.match(java, /length\(\)/);
});

test("标签未变时扫描仍刷新封面，并用 null 清除已删除的封面", async () => {
  const existing = [song("1", "mediaStore", { picUrl: "file:///old-cover.jpg", img: "file:///old-cover.jpg" })];
  let f = setup({
    existing,
    native: nativeResult([nativeSong("1", {
      tagsUnchanged: true, signature: "sig-1", albumArtUri: "content://cover/1?afv=999",
    })]),
  });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs[0].picUrl, "content://cover/1?afv=999");

  f = setup({
    existing,
    native: nativeResult([nativeSong("1", {
      tagsUnchanged: true, signature: "sig-1", albumArtUri: null,
    })]),
  });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs[0].picUrl, undefined);
});

test("下载索引为空不证明文件消失，已有下载文件仍在时保留记录", async () => {
  const f = setup({ existing: [song("dl-existing", "download")] });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 1);
  assert.equal(f.store.getState().localSongs[0].localOrigin, "download");
});

test("单个下载文件检查失败时保留记录并继续扫描", async () => {
  const f = setup({ existing: [song("dl-existing", "download")], fsError: "existing download unreadable" });
  await f.store.getState().scanMusic();
  assert.equal(f.store.getState().localSongs.length, 1);
  assert.equal(f.store.getState().localSongs[0].id, "dl-existing");
  assert.equal(f.store.getState().error, null);
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
    name: "用户改名", singer: "用户歌手", albumName: "用户专辑", localLyrics: "用户歌词",
  });
  item.song.interval = 200;
  await f.store.getState().scanMusic();
  const edited = f.store.getState().localSongs[0];
  assert.equal(edited.name, "用户改名");
  assert.equal(edited.singer, "用户歌手");
  assert.equal(edited.albumName, "用户专辑");
  // 封面已不可编辑（2026-10-16 删除封面匹配/自定义）：重扫后仍取文件自身的封面
  assert.equal(edited.picUrl, "original-cover");
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

test("封面不再有用户覆盖：重载刷新后仍来自文件自身", async () => {
  const item = { localPath: "/app/8.mp3", song: { id: "8", source: "kg", name: "原名", singer: "歌手", albumName: "专辑", picUrl: "old-cover" } };
  const f = setup({ downloads: [item] });
  await f.store.getState().scanMusic();
  // 即使调用方仍尝试传封面字段，也必须被忽略——封面只来自音频文件自己。
  await f.store.getState().updateLocalSongMetadata(f.store.getState().localSongs[0], { name: "原名", singer: "歌手", albumName: "专辑", coverUrl: "" });
  const restored = setup({ existing: storedSongs(f), downloads: [item] });
  await restored.store.getState().scanMusic();
  assert.equal(restored.store.getState().localSongs[0].picUrl, "old-cover");
});

test("原生下载文件夹恢复只匹配音频扩展名，避免把同名歌词当成音频", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const java = fs.readFileSync(path.resolve(
    __dirname,
    "../android/app/src/main/java/cn/chenle/auralflow/mobile/DownloadFileModule.java",
  ), "utf8");
  const method = java.slice(java.indexOf("public void findFileByPrefix("), java.indexOf("public void getFileSize("));
  assert.match(method, /name\.startsWith\(prefix\)/);
  assert.match(method, /isAudioFileName\(name\)/);
  for (const extension of ["mp3", "flac", "wav", "m4a", "aac", "ape", "ogg", "opus", "wma"]) {
    assert.match(java, new RegExp(`case "${extension}":`));
  }
  assert.doesNotMatch(java, /case "lrc":/);
});
