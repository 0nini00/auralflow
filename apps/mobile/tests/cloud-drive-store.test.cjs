const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, deferred, mobileRequire } = require('./helpers/loadTs.cjs');

/**
 * 云盘列表的复用与落盘缓存契约。
 *
 * 真实痛点：用户去别的页面听首歌再回云盘，页面就重新拉一遍；App 重开也一样。
 * 这里的用例钉住四条：同账号复用、只有刷新/换账号才重拉、落盘缓存冷启动可用（保鲜期内
 * 零请求、过期先显示再刷新）、退出登录清空且删缓存。
 *
 * 注意：`initialize` 会先 `await` 读缓存，所以断言「请求已经发出」之前要让出一个宏任务
 * （见 `tick()`）——否则 hydrate 还没跑完，pending 队列里自然什么都没有。
 */

const tick = () => new Promise((resolve) => setImmediate(resolve));

const song = (id) => ({ id, source: 'wy', name: `歌${id}`, singer: '人', interval: 200 });
const page = (songs, extra = {}) => ({
  songs,
  count: songs.length,
  usedBytes: 1024,
  maxBytes: 2048,
  nextOffset: songs.length,
  hasMore: false,
  ...extra,
});
const cachedSnapshot = (songs, cachedAt = Date.now()) => ({
  songs,
  count: songs.length,
  usedBytes: 1024,
  maxBytes: 2048,
  nextOffset: 50,
  hasMore: false,
  cachedAt,
});

function setup() {
  const calls = [];
  const pending = [];
  const cacheCalls = { load: [], save: [], clear: [] };
  const cacheState = { value: null };
  const api = {
    getCloudSongs: (params) => {
      calls.push(params);
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
  };
  const cache = {
    loadCloudDriveSnapshot: async (uid) => { cacheCalls.load.push(uid); return cacheState.value; },
    saveCloudDriveSnapshot: async (uid, snapshot) => { cacheCalls.save.push({ uid, snapshot }); },
    clearCloudDriveSnapshot: async (uid) => { cacheCalls.clear.push(uid); },
  };
  const load = createLoader({
    zustand: mobileRequire('zustand'),
    '@/services/wyCloudService': api,
    '@/services/cloudDriveCache': cache,
  });
  const { useCloudDriveStore } = load('src/stores/cloudDriveStore.ts');
  return { store: useCloudDriveStore, calls, pending, cacheCalls, cacheState };
}

test('同一账号再次进页面复用已加载的列表，不再请求', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  await tick();
  h.pending[0].resolve(page([song('1'), song('2')]));
  await first;

  assert.equal(h.calls.length, 1);
  await h.store.getState().initialize('uid-A');

  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['1', '2']);
  assert.equal(h.store.getState().loaded, true);
});

test('只有 refresh 才强制重拉', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  await tick();
  h.pending[0].resolve(page([song('1')]));
  await first;

  const refreshed = h.store.getState().refresh();
  await tick();
  h.pending[1].resolve(page([song('1'), song('2')]));
  await refreshed;

  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['1', '2']);
});

test('换账号丢弃旧列表并重新拉取', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  await tick();
  h.pending[0].resolve(page([song('A1')]));
  await first;

  const second = h.store.getState().initialize('uid-B');
  assert.deepEqual(h.store.getState().songs, [], '换账号的那一刻旧列表必须立刻清空');
  await tick();
  h.pending[1].resolve(page([song('B1')]));
  await second;

  assert.equal(h.calls.length, 2);
  assert.equal(h.store.getState().accountUid, 'uid-B');
  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['B1']);
});

test('上一账号的晚到响应不能写进新账号的列表', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  await tick();

  const second = h.store.getState().initialize('uid-B');
  await tick();
  h.pending[1].resolve(page([song('B1')]));
  await second;
  h.pending[0].resolve(page([song('A1')]));
  await first;

  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['B1']);
});

test('退出登录清空列表、不发起请求，并删掉这个账号的缓存', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  await tick();
  h.pending[0].resolve(page([song('1')]));
  await first;

  await h.store.getState().initialize('');
  const state = h.store.getState();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(state.songs, []);
  assert.equal(state.count, 0);
  assert.equal(state.loaded, false);
  assert.equal(state.accountUid, '');
  assert.deepEqual(h.cacheCalls.clear, ['uid-A']);
});

test('加载更多按接口给的 nextOffset 翻页并去重', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  await tick();
  h.pending[0].resolve(page([song('1'), song('2')], { hasMore: true, nextOffset: 2 }));
  await first;

  const more = h.store.getState().loadMore();
  assert.equal(h.calls[1].offset, 2);
  h.pending[1].resolve(page([song('2'), song('3')], { hasMore: false, nextOffset: 3 }));
  await more;

  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['1', '2', '3']);
});

test('首屏失败后仍算「已尝试」，用户可点刷新重试而不必等下一次进页面', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  await tick();
  h.pending[0].reject(new Error('网络断开'));
  await first;

  const state = h.store.getState();
  assert.equal(state.loaded, true);
  assert.equal(state.error, '网络断开');

  const retry = h.store.getState().refresh();
  await tick();
  h.pending[1].resolve(page([song('1')]));
  await retry;
  assert.equal(h.store.getState().error, '');
  assert.equal(h.store.getState().songs.length, 1);
});

test('冷启动命中保鲜期内的落盘缓存：一次请求都不发', async () => {
  const h = setup();
  h.cacheState.value = { fresh: true, snapshot: cachedSnapshot([song('cached')]) };
  await h.store.getState().initialize('uid-A');

  assert.equal(h.calls.length, 0, '保鲜期内不该再请求');
  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['cached']);
  assert.equal(h.store.getState().loading, false);
});

test('缓存过期：先把旧列表显示出来，同时后台刷新', async () => {
  const h = setup();
  h.cacheState.value = { fresh: false, snapshot: cachedSnapshot([song('stale')], 0) };
  const loading = h.store.getState().initialize('uid-A');
  await tick();

  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['stale'], '旧列表应当立刻可见');
  assert.equal(h.store.getState().loading, true, '同时在后台刷新');
  assert.equal(h.calls.length, 1);

  h.pending[0].resolve(page([song('fresh')]));
  await loading;
  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['fresh']);
});

test('拉取成功后写入缓存；点刷新时不读缓存', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  await tick();
  h.pending[0].resolve(page([song('1')]));
  await first;

  assert.equal(h.cacheCalls.save.length, 1);
  assert.equal(h.cacheCalls.save[0].uid, 'uid-A');

  h.cacheCalls.load.length = 0;
  const refreshed = h.store.getState().refresh();
  await tick();
  h.pending[1].resolve(page([song('1')]));
  await refreshed;
  assert.deepEqual(h.cacheCalls.load, [], '强制刷新不该回头读缓存');
  assert.equal(h.calls.length, 2);
});
