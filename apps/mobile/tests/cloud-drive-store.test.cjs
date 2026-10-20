const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, deferred, mobileRequire } = require('./helpers/loadTs.cjs');

/**
 * 云盘列表的复用契约。
 *
 * 真实痛点：用户去别的页面听首歌再回云盘，页面就重新拉一遍（还要先清空再填回来）。
 * 这里的用例把「同一账号加载过就复用、只有换账号或刷新才重拉、旧账号的晚到响应不许
 * 写回新账号列表」四条钉死。
 */

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

function setup() {
  const calls = [];
  const pending = [];
  const api = {
    getCloudSongs: (params) => {
      calls.push(params);
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
  };
  const load = createLoader({
    zustand: mobileRequire('zustand'),
    '@/services/wyCloudService': api,
  });
  const { useCloudDriveStore } = load('src/stores/cloudDriveStore.ts');
  return { store: useCloudDriveStore, calls, pending };
}

test('同一账号再次进页面复用已加载的列表，不再请求', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  h.pending[0].resolve(page([song('1'), song('2')]));
  await first;

  assert.equal(h.calls.length, 1);
  const second = h.store.getState().initialize('uid-A');
  await second;

  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['1', '2']);
  assert.equal(h.store.getState().loaded, true);
});

test('只有 refresh 才强制重拉', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  h.pending[0].resolve(page([song('1')]));
  await first;

  const refreshed = h.store.getState().refresh();
  h.pending[1].resolve(page([song('1'), song('2')]));
  await refreshed;

  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['1', '2']);
});

test('换账号丢弃旧列表并重新拉取', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  h.pending[0].resolve(page([song('A1')]));
  await first;

  const second = h.store.getState().initialize('uid-B');
  assert.deepEqual(h.store.getState().songs, [], '换账号的那一刻旧列表必须立刻清空');
  h.pending[1].resolve(page([song('B1')]));
  await second;

  assert.equal(h.calls.length, 2);
  assert.equal(h.store.getState().accountUid, 'uid-B');
  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['B1']);
});

test('上一账号的晚到响应不能写进新账号的列表', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');

  const second = h.store.getState().initialize('uid-B');
  h.pending[1].resolve(page([song('B1')]));
  await second;
  h.pending[0].resolve(page([song('A1')]));
  await first;

  assert.deepEqual(h.store.getState().songs.map((item) => item.id), ['B1']);
});

test('退出登录清空列表且不发起请求', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
  h.pending[0].resolve(page([song('1')]));
  await first;

  await h.store.getState().initialize('');
  const state = h.store.getState();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(state.songs, []);
  assert.equal(state.count, 0);
  assert.equal(state.loaded, false);
  assert.equal(state.accountUid, '');
});

test('加载更多按接口给的 nextOffset 翻页并去重', async () => {
  const h = setup();
  const first = h.store.getState().initialize('uid-A');
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
  h.pending[0].reject(new Error('网络断开'));
  await first;

  const state = h.store.getState();
  assert.equal(state.loaded, true);
  assert.equal(state.error, '网络断开');

  const retry = h.store.getState().refresh();
  h.pending[1].resolve(page([song('1')]));
  await retry;
  assert.equal(h.store.getState().error, '');
  assert.equal(h.store.getState().songs.length, 1);
});
