const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

const PLAYLISTS = "auralflow.mobile.localPlaylists";
const FAVORITES = "auralflow.mobile.favorites.v1";
const LEGACY = "auralflow.mobile.likedSongs";
const song = id => ({ id, source: "tx", name: id, singer: "fixture" });
const playlist = { id: "local-fixture", name: "fixture", songs: [], createdAt: 1, updatedAt: 1 };

function setup(initial = {}, options = {}) {
  const memory = new Map(Object.entries(initial));
  const writes = [];
  const coreLoader = createLoader({});
  const storage = {
    getItem: async key => {
      if (options.read) await options.read(key);
      return memory.get(key) ?? null;
    },
    setItem: async (key, value) => {
      if (options.write) await options.write(key, value);
      writes.push([key, value]); memory.set(key, value);
    },
    removeItem: async key => memory.delete(key),
    multiGet: async keys => Promise.all(keys.map(async key => [key, await storage.getItem(key)])),
  };
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "@react-native-async-storage/async-storage": storage,
    "@lx/core": {
      ...coreLoader("../../packages/core/src/webdav-merge.ts"),
      ...coreLoader("../../packages/core/src/removed-source.ts"),
    },
    "../services/wyPlaylistService": {}, "../services/txPlaylistService": {}, "./accountStore": {},
    "@/services/logger": { logger: { warn() {} } },
  });
  return { memory, writes, load, playlists: load("src/stores/playlistStore.ts").usePlaylistStore,
    favorites: load("src/stores/favoritesStore.ts").useFavoritesStore };
}

test("并发添加本地歌单歌曲在落盘后保留所有修改", async () => {
  const h = setup({ [PLAYLISTS]: JSON.stringify([playlist]) });
  await h.playlists.getState().loadLocalPlaylists();
  await Promise.all(["A", "B"].map(id => h.playlists.getState().addSongToLocalPlaylist(playlist.id, song(id))));
  assert.deepEqual(h.playlists.getState().localPlaylists[0].songs.map(s => s.id).sort(), ["A", "B"]);
  assert.deepEqual(JSON.parse(h.memory.get(PLAYLISTS)), h.playlists.getState().localPlaylists);
});

test("首次修改等待歌单初始化，重复初始化不会回滚新增歌曲", async () => {
  const gate = deferred();
  const entered = deferred();
  const h = setup({ [PLAYLISTS]: JSON.stringify([playlist]) }, { read: async key => {
    if (key === PLAYLISTS) { entered.resolve(); await gate.promise; }
  } });
  const adding = h.playlists.getState().createLocalPlaylistWithSong({ name: "新增", song: song("A") });
  const loading = h.playlists.getState().loadLocalPlaylists();
  await entered.promise;
  gate.resolve();
  await Promise.all([adding, loading]);
  assert.equal(h.playlists.getState().localPlaylists.length, 2);
  assert.equal(h.playlists.getState().localPlaylists.some(p => p.songs.some(s => s.id === "A")), true);
});

test("本地歌单同步与用户修改共用提交队列", async () => {
  const h = setup({ [PLAYLISTS]: JSON.stringify([playlist]) });
  await h.playlists.getState().loadLocalPlaylists();
  await Promise.all([
    h.playlists.getState().mergeFromSync({ cloudPlaylists: [], localPlaylists: [{ ...playlist, songs: [song("remote")] }] }),
    h.playlists.getState().addSongToLocalPlaylist(playlist.id, song("local")),
  ]);
  assert.deepEqual(h.playlists.getState().localPlaylists[0].songs.map(s => s.id).sort(), ["local", "remote"]);
});

test("收藏写盘失败向调用者传播且不发布未落盘状态", async () => {
  let fail = true;
  const h = setup({ [FAVORITES]: JSON.stringify([song("old")]) }, { write: async () => {
    if (fail) throw new Error("disk unavailable");
  } });
  await h.favorites.getState().loadFromStorage();
  await assert.rejects(h.favorites.getState().addFavorite(song("A")), /disk unavailable/);
  assert.deepEqual(h.favorites.getState().favorites.map(s => s.id), ["old"]);
  fail = false;
  await h.favorites.getState().addFavorite(song("B"));
  assert.deepEqual(h.favorites.getState().favorites.map(s => s.id), ["B", "old"]);
});

test("收藏迁移落盘失败时保留旧数据和未完成状态", async () => {
  const legacy = JSON.stringify([song("old")]);
  const h = setup({ [LEGACY]: legacy }, { write: async () => { throw new Error("disk unavailable"); } });
  await assert.rejects(h.favorites.getState().loadFromStorage(), /disk unavailable/);
  assert.equal(h.memory.get(LEGACY), legacy);
  assert.equal(h.favorites.getState().loaded, false);
});

test("并发收藏切换两次保持原始状态", async () => {
  const h = setup();
  await h.favorites.getState().loadFromStorage();
  await Promise.all([h.favorites.getState().toggleFavorite(song("A")), h.favorites.getState().toggleFavorite(song("A"))]);
  assert.deepEqual(h.favorites.getState().favorites, []);
  assert.deepEqual(JSON.parse(h.memory.get(FAVORITES)), []);
});

for (const kind of ["playlists", "favorites", "history"]) {
  test(`${kind} 读取失败保持初始化失败且禁止后续覆盖磁盘`, async () => {
    const h = setup({}, { read: async () => { throw new Error("read unavailable"); } });
    const state = kind === "history" ? h.load("src/stores/historyStore.ts").useHistoryStore.getState() : h[kind].getState();
    const load = kind === "playlists" ? state.loadLocalPlaylists : kind === "favorites" ? state.loadFromStorage : state.loadHistory;
    await assert.rejects(load(), /read unavailable/);
    if (kind === "playlists") await assert.rejects(state.createLocalPlaylist({ name: "new" }), /read unavailable/);
    if (kind === "favorites") await assert.rejects(state.addFavorite(song("A")), /read unavailable/);
    assert.equal(h.writes.length, 0);
  });
}
