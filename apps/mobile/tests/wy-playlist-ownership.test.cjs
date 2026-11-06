const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

const song = { id: "100", source: "wy", name: "歌曲", singer: "歌手" };
const owned = {
  id: "1", source: "wy", name: "自建", trackCount: 23, subscribed: false,
  creator: { userId: "A", nickname: "A" },
};
const reference = { id: "2", source: "wy", name: "同步引用", trackCount: 0 };
const other = { ...owned, id: "3", creator: { userId: "B", nickname: "B" } };
const collected = { ...other, id: "4", subscribed: true };
const loadModel = createLoader({});
const selection = loadModel("src/services/localPlaylistSelectionModel.ts");
const groups = loadModel("src/services/libraryPlaylistGroups.ts");
const detail = loadModel("src/services/playlistDetailActions.ts");

test("添加候选仅包含当前账号创建的歌单，未知归属不能被 subscribed=false 授权", () => {
  const playlists = [owned, reference, other, collected, { ...reference, id: "5", subscribed: false }];
  const options = selection.buildOwnedWyPlaylistSongOptions(playlists, song, "A");
  assert.deepEqual(options.map(item => item.id), [owned.id]);
  assert.equal(options[0].trackCount, 23);
});

test("本人空歌单、红心歌单和缺少收藏标记的本人歌单仍可添加", () => {
  const playlists = [
    { ...owned, trackCount: 0 },
    { ...owned, id: "2", specialType: 5 },
    { ...owned, id: "3", subscribed: undefined },
    { ...owned, id: "4", subscribed: true },
  ];
  const options = selection.buildOwnedWyPlaylistSongOptions(playlists, song, "A");
  assert.deepEqual(options.map(item => item.id), ["1", "2", "3"]);
  assert.equal(options[0].trackCount, 0);
});

test("未登录和非网易云歌曲不能得到云端写入候选", () => {
  assert.deepEqual(selection.buildOwnedWyPlaylistSongOptions([owned], song, undefined), []);
  assert.deepEqual(selection.buildOwnedWyPlaylistSongOptions([owned], song, ""), []);
  assert.deepEqual(selection.buildOwnedWyPlaylistSongOptions([owned], { ...song, source: "tx" }, "A"), []);
});

test("歌单分组和详情删除入口使用相同账号归属规则", () => {
  const playlists = [owned, reference, other, collected, { ...owned, id: "5", source: "tx" }];
  const result = groups.buildWyPlaylistGroups(playlists, "A", undefined);
  assert.deepEqual(result[0].playlists.map(item => item.id), [owned.id]);
  assert.deepEqual(result[1].playlists.map(item => item.id), [collected.id]);
  for (const playlist of playlists) {
    assert.equal(detail.canRemoveSongsFromPlaylistDetail(playlist, "A"), playlist === owned);
  }
  assert.equal(detail.canRemoveSongsFromPlaylistDetail(owned, undefined), false);
});

function fixture({ userId = "A", read = async () => [owned], write = async () => {} } = {}) {
  const { createStore } = mobileRequire("zustand/vanilla");
  const account = createStore(() => ({ isLoggedIn: Boolean(userId), user: userId ? { userId } : null }));
  const calls = [];
  const load = createLoader({
    zustand: { create: createStore },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "./accountStore": { useAccountStore: account },
    "../services/txPlaylistService": {},
    "../services/wyPlaylistService": {
      getUserPlaylists: read,
      addPlaylistTracks: async (...args) => { calls.push(["add", ...args]); await write(); },
      removePlaylistTracks: async (...args) => { calls.push(["del", ...args]); await write(); },
    },
  });
  const store = load("src/stores/playlistStore.ts").usePlaylistStore;
  return { store, account, calls };
}

for (const action of ["addSongToWyPlaylist", "removeSongFromWyPlaylist"]) {
  test(`${action} 拒绝收藏、同步引用、他人歌单及未登录的直接调用`, async () => {
    for (const playlist of [reference, other, collected, { ...reference, subscribed: false }]) {
      const h = fixture();
      h.store.setState({ playlists: [playlist] });
      await assert.rejects(h.store.getState()[action](playlist.id, song), /当前账号.*创建/);
      assert.equal(h.calls.length, 0);
      assert.deepEqual(h.store.getState().playlists, [playlist]);
    }
    const h = fixture({ userId: null });
    h.store.setState({ playlists: [owned] });
    await assert.rejects(h.store.getState()[action](owned.id, song), /当前账号.*创建/);
    assert.equal(h.calls.length, 0);
  });
}

test("本人添加成功后才发布歌曲和计数，失败保留原数据", async () => {
  const pending = deferred();
  const h = fixture({ write: () => pending.promise });
  h.store.setState({ playlists: [owned], currentPlaylist: owned, currentPlaylistSongs: [] });
  const request = h.store.getState().addSongToWyPlaylist(owned.id, song);
  assert.equal(h.store.getState().playlists[0].trackCount, 23);
  pending.resolve();
  await request;
  assert.deepEqual(h.calls, [["add", owned.id, [song.id]]]);
  assert.equal(h.store.getState().playlists[0].trackCount, 24);
  assert.deepEqual(h.store.getState().currentPlaylistSongs, [song]);

  const failed = fixture({ write: async () => { throw new Error("网络环境存在风险"); } });
  failed.store.setState({ playlists: [owned] });
  await assert.rejects(failed.store.getState().addSongToWyPlaylist(owned.id, song), /网络环境存在风险/);
  assert.deepEqual(failed.store.getState().playlists, [owned]);
});

test("在线刷新替换同步引用并恢复真实歌曲数", async () => {
  const h = fixture();
  h.store.getState().replaceAllFromSync([{ ...reference, id: owned.id }]);
  assert.deepEqual(selection.buildOwnedWyPlaylistSongOptions(h.store.getState().playlists, song, "A"), []);
  assert.deepEqual(await h.store.getState().fetchPlaylists("A"), { ok: true });
  assert.equal(selection.buildOwnedWyPlaylistSongOptions(h.store.getState().playlists, song, "A")[0].trackCount, 23);
  await h.store.getState().mergeFromSync({ cloudPlaylists: [{ ...reference, id: owned.id, updatedAt: 9000 }, reference], localPlaylists: [] });
  assert.deepEqual(selection.buildOwnedWyPlaylistSongOptions(h.store.getState().playlists, song, "A").map(item => [item.id, item.trackCount]), [[owned.id, 23]]);
});

test("在线刷新失败显式返回错误，不能被调用者当作成功", async () => {
  const h = fixture({ read: async () => { throw new Error("offline"); } });
  h.store.setState({ playlists: [owned] });
  assert.deepEqual(await h.store.getState().fetchPlaylists("A"), { ok: false, error: "offline" });
  assert.equal(h.store.getState().playlistsLoading, false);
  assert.equal(h.store.getState().playlistsError, "offline");
});

for (const staleFailure of [false, true]) {
  test(`旧账号刷新${staleFailure ? "失败" : "成功"}不能覆盖新账号歌单`, async () => {
    const pending = deferred();
    const h = fixture({ read: id => id === "A" ? pending.promise : Promise.resolve([other]) });
    const oldRequest = h.store.getState().fetchPlaylists("A");
    h.account.setState({ user: { userId: "B" } });
    await h.store.getState().fetchPlaylists("B");
    if (staleFailure) pending.reject(new Error("old failure"));
    else pending.resolve([owned]);
    const result = await oldRequest;
    assert.deepEqual(h.store.getState().playlists, [other]);
    assert.equal(h.store.getState().error, null);
    assert.equal(result?.ok, false);
  });
}

test("同账号旧刷新晚到不能覆盖新刷新", async () => {
  const pending = deferred();
  let first = true;
  const latest = { ...owned, trackCount: 27 };
  const h = fixture({ read: () => { if (first) { first = false; return pending.promise; } return Promise.resolve([latest]); } });
  const oldRequest = h.store.getState().fetchPlaylists("A");
  await h.store.getState().fetchPlaylists("A");
  pending.resolve([owned]);
  const result = await oldRequest;
  assert.deepEqual(h.store.getState().playlists, [latest]);
  assert.equal(result?.ok, false);
});

test("退出账号或清空歌单后在途刷新不得恢复旧列表", async () => {
  for (const clear of [false, true]) {
    const pending = deferred();
    const h = fixture({ read: () => pending.promise });
    const request = h.store.getState().fetchPlaylists("A");
    if (clear) h.store.getState().clearPlaylists();
    else h.account.setState({ isLoggedIn: false, user: null });
    pending.resolve([owned]);
    const result = await request;
    assert.deepEqual(h.store.getState().playlists, []);
    assert.equal(result?.ok, false);
    assert.equal(h.store.getState().playlistsLoading, false);
  }
});

test("添加弹窗刷新列表失败不污染已打开的歌单详情", async () => {
  const pending = deferred();
  const h = fixture({ read: () => pending.promise });
  h.store.setState({ currentPlaylist: owned, currentPlaylistSongs: [song], loading: false, error: null });
  const request = h.store.getState().fetchPlaylists("A");
  assert.equal(h.store.getState().loading, false);
  assert.equal(h.store.getState().playlistsLoading, true);
  pending.reject(new Error("offline"));
  assert.deepEqual(await request, { ok: false, error: "offline" });
  assert.equal(h.store.getState().error, null);
  assert.equal(h.store.getState().playlistsError, "offline");
  assert.deepEqual(h.store.getState().currentPlaylistSongs, [song]);
});

test("列表刷新成功不清除另一项详情请求的加载和错误状态", async () => {
  const h = fixture();
  h.store.setState({ loading: true, error: "详情加载失败" });
  await h.store.getState().fetchPlaylists("A");
  assert.equal(h.store.getState().loading, true);
  assert.equal(h.store.getState().error, "详情加载失败");
  assert.equal(h.store.getState().playlistsLoading, false);
  assert.equal(h.store.getState().playlistsError, null);
});
