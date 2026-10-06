const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");
const { createStore } = mobileRequire("zustand/vanilla");

const LOCAL_TIME = 200000;
const REMOTE_TIME = 100000;
const CONFIG_KEY = "auralflow.mobile.webdavConfig";
const META_PREFIX = "auralflow.mobile.webdavMeta:";
const FAVORITES_KEY = "auralflow.mobile.favorites.v1";
const PLAYLISTS_KEY = "auralflow.mobile.localPlaylists";
const FIXTURE_ORIGIN = "https://webdav-fixture.invalid";

function song(id, name = id) {
  return { id, name, source: "wy", singer: "fixture", albumName: "fixture" };
}

function localPlaylist(id, songs) {
  return { id, name: id, description: "本地较新简介", songs, createdAt: 1, updatedAt: LOCAL_TIME };
}

function remoteFile(lastModified = REMOTE_TIME) {
  return {
    version: "3",
    lastModified,
    data: {
      loveList: [song("common", "云端旧标题"), song("remote-favorite")],
      defaultList: [],
      userList: [
        { id: "shared", name: "云端旧歌单名", description: "云端旧简介", source: "local", list: [song("common", "云端旧标题"), song("remote-song")], createdAt: 1, updatedAt: REMOTE_TIME },
        { id: "remote-only", name: "云端独有歌单", source: "local", list: [song("remote-only-song")], createdAt: 1, updatedAt: REMOTE_TIME },
        { id: "101", name: "云端旧引用名", source: "wy", list: [song("cloud-song")], updatedAt: REMOTE_TIME },
        { id: "202", name: "云端独有引用", source: "wy", list: [song("cloud-only-song")], updatedAt: REMOTE_TIME },
      ],
    },
    playHistory: [],
  };
}

function response(status, body = "") {
  return { status, ok: status >= 200 && status < 300, statusText: `fixture-${status}`, text: async () => body };
}

async function fixture({ remote = remoteFile(), read } = {}) {
  const initialLocal = [localPlaylist("shared", [song("common", "本地新标题"), song("local-song")]), localPlaylist("local-only", [song("local-only-song")])];
  const initialFavorites = [song("common", "本地新标题"), song("local-favorite")];
  const memory = new Map([
    [CONFIG_KEY, JSON.stringify({ url: FIXTURE_ORIGIN, username: "fixture", autoSyncPlaylists: true })],
    [META_PREFIX + "playlists", JSON.stringify({ lastModified: LOCAL_TIME, itemCount: 3 })],
    [META_PREFIX + "sources", JSON.stringify({ lastModified: LOCAL_TIME, itemCount: 1 })],
    [FAVORITES_KEY, JSON.stringify(initialFavorites)],
    [PLAYLISTS_KEY, JSON.stringify(initialLocal)],
  ]);
  const requests = [];
  const uploads = [];
  const sourceStore = createStore(set => ({
    sources: [{ id: "local-source", name: "local", script: "fixture-script" }],
    replaceAll: sources => set({ sources }),
  }));
  const loadCore = createLoader({});
  const core = {
    ...loadCore("../../packages/core/src/webdav-merge.ts"),
    ...loadCore("../../packages/core/src/webdav-sync-error.ts"),
    ...loadCore("../../packages/core/src/removed-source.ts"),
  };
  const load = createLoader({
    zustand: { create: createStore },
    "@react-native-async-storage/async-storage": {
      getItem: async key => memory.get(key) ?? null,
      setItem: async (key, value) => { memory.set(key, value); },
      removeItem: async key => { memory.delete(key); },
    },
    // 只加载被测模块使用的 core 纯函数，不加载平台服务入口。
    "@lx/core": core,
    "../services/txPlaylistService": {},
    "../services/wyPlaylistService": {},
    "./accountStore": {},
    "../stores/customSourceStore": { useCustomSourceStore: sourceStore },
    "./customSourceRuntime": { parseDesktopUserApiInfo: () => assert.fail("音源保护应在脚本解析前拒绝") },
    pako: mobileRequire("pako"),
    "@/services/secureStorageService": {
      getSecureItem: async () => "fixture-only-not-a-real-secret",
      setSecureItem: async () => assert.fail("不应写入凭证"),
      removeSecureItem: async () => assert.fail("不应删除凭证"),
    },
    "@/services/webdavUrlModel": {
      assertHttpsWebdavUrl: url => assert.equal(new URL(url).origin, FIXTURE_ORIGIN),
    },
    "@/services/logger": { logger: { warn: (...args) => assert.fail(`意外告警：${args.join(" ")}`) } },
    "@/utils/fetchWithTimeout": {
      fetchWithTimeout: async (url, init) => {
        assert.equal(new URL(url).origin, FIXTURE_ORIGIN);
        requests.push({ method: init.method, path: new URL(url).pathname });
        if (init.method === "GET") {
          if (read) return read(new URL(url).pathname);
          return response(200, typeof remote === "string" ? remote : JSON.stringify(remote));
        }
        if (init.method === "PROPFIND") return response(207);
        if (init.method === "PUT") {
          uploads.push(JSON.parse(init.body));
          return response(201);
        }
        assert.fail(`禁止真实 IO 或未声明的请求：${init.method}`);
      },
    },
  });
  const playlists = load("src/stores/playlistStore.ts").usePlaylistStore;
  const favorites = load("src/stores/favoritesStore.ts").useFavoritesStore;
  const history = load("src/stores/historyStore.ts").useHistoryStore;
  await playlists.getState().loadLocalPlaylists();
  await favorites.getState().loadFromStorage();
  await history.getState().loadHistory();
  playlists.setState({ playlists: [{ id: "101", source: "wy", name: "本地新引用名", updatedAt: LOCAL_TIME }] });
  const service = load("src/services/webdavSyncService.ts");
  const errors = core;
  return { service, playlists, favorites, history, sourceStore, memory, requests, uploads, errors };
}

function ids(items) {
  return items.map(item => item.id).sort();
}

function assertMerged(f) {
  const local = f.playlists.getState().localPlaylists;
  assert.deepEqual(ids(local), ["local-only", "remote-only", "shared"]);
  const shared = local.find(item => item.id === "shared");
  assert.equal(shared.name, "shared");
  assert.equal(shared.description, "本地较新简介");
  assert.equal(shared.updatedAt, LOCAL_TIME);
  assert.deepEqual(ids(shared.songs), ["common", "local-song", "remote-song"]);
  assert.equal(shared.songs.find(item => item.id === "common").name, "本地新标题");
  assert.deepEqual(ids(local.find(item => item.id === "remote-only").songs), ["remote-only-song"]);
  assert.deepEqual(ids(f.favorites.getState().favorites), ["common", "local-favorite", "remote-favorite"]);
  assert.equal(f.favorites.getState().favorites.find(item => item.id === "common").name, "本地新标题");
  assert.deepEqual(ids(f.playlists.getState().playlists), ["101", "202"]);
  assert.equal(f.playlists.getState().playlists.find(item => item.id === "101").name, "本地新引用名");
  assert.deepEqual(JSON.parse(f.memory.get(PLAYLISTS_KEY)), JSON.parse(JSON.stringify(local)));
  assert.deepEqual(JSON.parse(f.memory.get(FAVORITES_KEY)), f.favorites.getState().favorites);
}

// 由隔离审查的 stale overwrite 复现转为正确行为断言，不涉及跨平台 ID 碰撞。
for (const [label, timestamp] of [["较旧", REMOTE_TIME], ["较新", 300000], ["未知", null]]) {
  test(`自动同步合并${label}云端，保留双方独有数据及本地同 ID 较新内容`, async () => {
    const remote = remoteFile(timestamp);
    if (timestamp === null) delete remote.lastModified;
    const f = await fixture({ remote });
    await f.service.autoSyncPlaylistsOnce();
    assertMerged(f);
    assert.equal(f.uploads.length, 1);
    const uploaded = f.uploads[0];
    assert.deepEqual(ids(uploaded.data.userList), ["101", "202", "local-only", "remote-only", "shared"]);
    assert.deepEqual(ids(uploaded.data.loveList), ["common", "local-favorite", "remote-favorite"]);
    assert.deepEqual(ids(uploaded.data.userList.find(item => item.id === "shared").list), ["common", "local-song", "remote-song"]);
    assert.equal(uploaded.data.userList.find(item => item.id === "shared").name, "shared");
    assert.deepEqual(ids(uploaded.data.userList.find(item => item.id === "remote-only").list), ["remote-only-song"]);
    assert.deepEqual(ids(uploaded.data.userList.find(item => item.id === "202").list), ["cloud-only-song"]);
  });
}

test("默认下载模式也合并旧云端，不要求 force", async () => {
  const f = await fixture();
  await f.service.downloadPlaylistsSync();
  assertMerged(f);
  assert.equal(f.uploads.length, 0);
});

for (const [label, options, message] of [
  ["下载异常", { read: async () => { throw new Error("fixture-offline"); } }, /fixture-offline/],
  ["下载 HTTP 错误", { read: async () => response(503) }, /503/],
  ["JSON 解析失败", { remote: "{broken-json" }, /JSON/],
  ["迁移目录 HTTP 错误", { read: async path => response(path.startsWith("/AuralFlow/") ? 404 : 503) }, /503/],
  ["迁移目录下载异常", { read: async path => {
    if (path.startsWith("/AuralFlow/")) return response(404);
    throw new Error("fixture-legacy-offline");
  } }, /fixture-legacy-offline/],
]) {
  test(`自动同步${label}时拒绝且不执行 PUT`, async () => {
    const f = await fixture(options);
    await assert.rejects(f.service.autoSyncPlaylistsOnce(), message);
    assert.equal(f.uploads.length, 0);
    assert.ok(f.requests.every(request => request.method === "GET"));
  });
}

for (const stage of ["favorites", "playlists", "history"]) {
  test(`${stage} 合并失败时自动同步拒绝且不执行 PUT`, async () => {
    const f = await fixture({ remote: remoteFile(300000) });
    const error = new Error(`fixture-${stage}-merge`);
    const action = { favorites: "mergeAll", playlists: "mergeFromSync", history: "mergeHistory" }[stage];
    f[stage].setState({ [action]: async () => { throw error; } });
    await assert.rejects(f.service.autoSyncPlaylistsOnce(), e => e === error);
    assert.equal(f.uploads.length, 0);
  });
}

test("合并抛出的较旧数据拒绝不得被吞掉后继续上传", async () => {
  const f = await fixture({ remote: remoteFile(300000) });
  // 使用服务加载图中的同一个错误类，确保检查真实的 instanceof 分支。
  const error = new f.errors.CloudDataStaleError("fixture-merge-refused");
  f.playlists.setState({ mergeFromSync: async () => { throw error; } });
  await assert.rejects(f.service.autoSyncPlaylistsOnce(), e => e === error);
  assert.equal(f.uploads.length, 0);
});

for (const kind of ["playlists", "sources"]) {
  for (const [label, timestamp] of [["较旧", REMOTE_TIME], ["未知", null]]) {
    test(`${kind} 覆盖下载仍拒绝${label}云端且不改变本地数据`, async () => {
      const remote = remoteFile(timestamp);
      if (timestamp === null) delete remote.lastModified;
      const f = await fixture({ remote });
      const before = {
        playlists: structuredClone(f.playlists.getState().localPlaylists),
        favorites: structuredClone(f.favorites.getState().favorites),
        sources: structuredClone(f.sourceStore.getState().sources),
      };
      const operation = kind === "playlists"
        ? f.service.downloadPlaylistsSync({ merge: false })
        : f.service.downloadSourcesSync();
      await assert.rejects(operation, error => error.name === (timestamp === null ? "CloudSyncRefusalError" : "CloudDataStaleError"));
      assert.deepEqual(f.playlists.getState().localPlaylists, before.playlists);
      assert.deepEqual(f.favorites.getState().favorites, before.favorites);
      assert.deepEqual(f.sourceStore.getState().sources, before.sources);
      assert.equal(f.uploads.length, 0);
    });
  }
}

test("已确认 force 的覆盖下载仍可替换旧数据", async () => {
  const f = await fixture();
  await f.service.downloadPlaylistsSync({ merge: false, force: true });
  assert.deepEqual(ids(f.playlists.getState().localPlaylists), ["remote-only", "shared"]);
  assert.equal(f.playlists.getState().localPlaylists.find(item => item.id === "shared").name, "云端旧歌单名");
  assert.equal(f.uploads.length, 0);
});

test("首次同步新旧目录均 404 时允许上传本地数据", async () => {
  const f = await fixture({ read: async () => response(404) });
  await f.service.autoSyncPlaylistsOnce();
  assert.equal(f.uploads.length, 1);
  assert.deepEqual(ids(f.uploads[0].data.userList), ["101", "local-only", "shared"]);
  assert.deepEqual(ids(f.uploads[0].data.loveList), ["common", "local-favorite"]);
  assert.ok(f.requests.some(request => request.path === "/LX_Music/playlists.json"));
});

for (const remote of [{ unexpected: "not-a-backup" }, { data: { userList: "invalid" } }, []]) {
  test(`不认识或损坏的歌单结构不得当作空备份覆盖：${JSON.stringify(remote)}`, async () => {
    const f = await fixture({ remote });
    await assert.rejects(f.service.autoSyncPlaylistsOnce(), /结构|格式/);
    assert.equal(f.uploads.length, 0);
  });
}
