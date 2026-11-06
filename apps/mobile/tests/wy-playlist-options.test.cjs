const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const test = require("node:test");
const { createLoader, deferred, mobileRequire, mobileRoot } = require("./helpers/loadTs.cjs");

const desktopRequire = createRequire(path.resolve(mobileRoot, "../../desktop/package.json"));
const React = desktopRequire("react");
const { act, create } = desktopRequire("react-test-renderer");
const { createStore } = mobileRequire("zustand/vanilla");
const song = { id: "song-1", source: "wy", name: "歌曲" };
const owned = (id, userId = "A", trackCount = 37) => ({
  id, source: "wy", name: id, trackCount, subscribed: false, creator: { userId },
});

function useStore(store, selector) {
  return selector(React.useSyncExternalStore(store.subscribe, store.getState, store.getState));
}

function setup(t, initialProps = {}, accountState = {}) {
  const hookPath = path.join(mobileRoot, "src/hooks/useWyPlaylistSongOptions.ts");
  assert.ok(fs.existsSync(hookPath), "添加弹窗必须具有按账户刷新网易云候选的 hook");
  const requests = [];
  const renders = [];
  const account = createStore(() => ({ isLoggedIn: true, user: { userId: "A" }, ...accountState }));
  const playlists = createStore(() => ({
    playlists: [owned("stale-list", "A", 0)],
    fetchPlaylists(userId) {
      const request = { userId, ...deferred() };
      requests.push(request);
      return request.promise;
    },
  }));
  const load = createLoader({
    react: React,
    "@/stores/accountStore": { useAccountStore: selector => useStore(account, selector) },
    "@/stores/playlistStore": { usePlaylistStore: selector => useStore(playlists, selector) },
  });
  const { useWyPlaylistSongOptions } = load("src/hooks/useWyPlaylistSongOptions.ts");
  let value;
  let props = { visible: true, song, songCount: 1, ...initialProps };
  function Probe(input) {
    value = useWyPlaylistSongOptions(input);
    renders.push({ ...value, options: [...value.options] });
    return null;
  }
  let root;
  act(() => { root = create(React.createElement(Probe, props)); });
  t.after(() => act(() => root.unmount()));
  return {
    account, playlists, requests, renders,
    get value() { return value; },
    update(next) {
      props = { ...props, ...next };
      act(() => root.update(React.createElement(Probe, props)));
    },
    switchAccount(userId) {
      act(() => account.setState({ isLoggedIn: Boolean(userId), user: userId ? { userId } : null }));
    },
    async respond(index, result = { ok: true }, freshPlaylists) {
      assert.ok(requests[index], `请求 ${index} 必须已发出`);
      await act(async () => {
        if (freshPlaylists) playlists.setState({ playlists: freshPlaylists });
        requests[index].resolve(result);
        await requests[index].promise;
      });
    },
    retry() { act(() => value.retry()); },
  };
}

test("打开单曲添加弹窗立即刷新，完成前隐藏旧引用并采用在线歌曲数", async t => {
  const h = setup(t);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].userId, "A");
  assert.equal(h.value.loading, true);
  assert.deepEqual(h.value.options, []);
  assert.ok(h.renders.every(render => render.options.length === 0));
  await h.respond(0, { ok: true }, [owned("online-list", "A", 37), owned("empty-list", "A", 0)]);
  assert.equal(h.value.loading, false);
  assert.equal(h.value.error, null);
  assert.deepEqual(h.value.options.map(option => [option.id, option.trackCount]), [["online-list", 37], ["empty-list", 0]]);
});

test("刷新失败显式呈现错误并隐藏旧候选，重试成功才开放选择", async t => {
  const h = setup(t);
  await h.respond(0, { ok: false, error: "网易云请求失败" });
  assert.equal(h.value.loading, false);
  assert.equal(h.value.error, "网易云请求失败");
  assert.deepEqual(h.value.options, []);
  h.retry();
  assert.equal(h.requests.length, 2);
  assert.equal(h.value.loading, true);
  assert.equal(h.value.error, null);
  assert.deepEqual(h.value.options, []);
  await h.respond(1, { ok: true }, [owned("retry-list")]);
  assert.deepEqual(h.value.options.map(option => option.id), ["retry-list"]);
});

test("关闭后重新打开必须重新刷新，旧请求晚到不得释放新请求的加载状态", async t => {
  const h = setup(t);
  h.update({ visible: false });
  assert.equal(h.value.loading, false);
  assert.deepEqual(h.value.options, []);
  h.update({ visible: true });
  assert.equal(h.requests.length, 2);
  await h.respond(0, { ok: false, error: "旧请求失败" });
  assert.equal(h.value.loading, true);
  assert.equal(h.value.error, null);
  assert.deepEqual(h.value.options, []);
  await h.respond(1, { ok: true }, [owned("reopened-list")]);
  assert.deepEqual(h.value.options.map(option => option.id), ["reopened-list"]);
});

test("刷新成功后关闭再打开的第一帧也不暴露上次候选", async t => {
  const h = setup(t);
  await h.respond(0, { ok: true }, [owned("previous-list")]);
  h.update({ visible: false });
  const firstReopenRender = h.renders.length;
  h.update({ visible: true });
  assert.equal(h.requests.length, 2);
  assert.ok(h.renders.slice(firstReopenRender).every(render => render.options.length === 0));
});

test("账号切换第一帧即隐藏旧候选并按新账号刷新", async t => {
  const h = setup(t);
  await h.respond(0, { ok: true }, [owned("A-list")]);
  const firstNewAccountRender = h.renders.length;
  h.switchAccount("B");
  assert.equal(h.requests[1].userId, "B");
  assert.ok(h.renders.slice(firstNewAccountRender).every(render => render.options.length === 0));
  await h.respond(1, { ok: true }, [owned("B-list", "B", 19)]);
  assert.deepEqual(h.value.options.map(option => [option.id, option.trackCount]), [["B-list", 19]]);
});

test("旧账号的晚响应不能释放新账号加载状态或覆盖新请求结果", async t => {
  const h = setup(t);
  h.switchAccount("B");
  await h.respond(0, { ok: true });
  assert.equal(h.value.loading, true);
  assert.deepEqual(h.value.options, []);
  await h.respond(1, { ok: true }, [owned("B-list", "B")]);
  assert.deepEqual(h.value.options.map(option => option.id), ["B-list"]);
});

for (const [label, props] of [
  ["隐藏", { visible: false }],
  ["其他音源", { song: { ...song, source: "tx" } }],
  ["批量歌曲", { songCount: 2 }],
  ["没有歌曲", { song: undefined, songCount: 0 }],
]) {
  test(`${label}时不请求网易云歌单且不提供候选`, t => {
    const h = setup(t, props);
    assert.equal(h.requests.length, 0);
    assert.equal(h.value.loading, false);
    assert.deepEqual(h.value.options, []);
  });
}

test("未登录时显示登录要求，不读取缓存作为候选", t => {
  const h = setup(t, {}, { isLoggedIn: false, user: null });
  assert.equal(h.requests.length, 0);
  assert.equal(h.value.loginRequired, true);
  assert.deepEqual(h.value.options, []);
});

test("加载中退出登录后旧请求晚到不会重新显示歌单", async t => {
  const h = setup(t);
  h.switchAccount(undefined);
  await h.respond(0, { ok: true });
  assert.equal(h.value.loading, false);
  assert.equal(h.value.loginRequired, true);
  assert.equal(h.value.error, null);
  assert.deepEqual(h.value.options, []);
});
