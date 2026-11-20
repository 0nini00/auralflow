const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, deferred, mobileRequire } = require('./helpers/loadTs.cjs');

function setup() {
  const playlists = deferred(), daily = deferred(), disk = deferred();
  const writes = [];
  const load = createLoader({
    zustand: mobileRequire('zustand'),
    '@react-native-async-storage/async-storage': {
      getItem: async () => null, removeItem: async () => {},
      setItem: async (key, value) => { writes.push([key, JSON.parse(value)]); await disk.promise; },
    },
    './wyPlaylistService': { fetchWyPersonalizedPlaylistMix: () => playlists.promise, fetchDailyRecommendedSongs: () => daily.promise },
    './wyHomeFeedService': { getPersonalizedRecommendedPlaylists: async () => [], getPublicRecommendedPlaylists: async () => [] },
  });
  return { store: load('src/stores/homeFeedStore.ts').useHomeFeedStore, playlists, daily, disk, writes };
}
const context = { scopeKey: 'wy:review', userId: 'review', isLoggedIn: true };
const playlist = { id: 'p', name: 'P', author: 'A', source: 'wy', trackCount: 1 };

test('首页快分区先展示，全部就绪无需等待磁盘写入', async () => {
  const h = setup();
  const task = h.store.getState().refreshAll(context);
  try {
    h.daily.resolve({ songs: [] });
    await new Promise(setImmediate);
    assert.deepEqual(h.store.getState().sections.map(s => s.id), ['dailySongs']);
    h.playlists.resolve([playlist]);
    await new Promise(setImmediate);
    assert.deepEqual(h.store.getState().sections.map(s => s.id), ['recommendedPlaylists', 'dailySongs']);
    assert.equal(h.store.getState().refreshing, false);
    assert.equal(h.writes.length, 1);
  } finally {
    h.playlists.resolve([playlist]); h.daily.resolve({ songs: [] }); h.disk.resolve(); await task;
  }
});

test('缓存写入失败保留已展示分区并报告错误', async () => {
  const h = setup();
  const task = h.store.getState().refreshAll(context);
  h.daily.resolve({ songs: [] }); h.playlists.resolve([playlist]);
  await new Promise(setImmediate);
  h.disk.reject(new Error('storage unavailable'));
  await task;
  assert.equal(h.store.getState().sections.length, 2);
  assert.match(h.store.getState().error, /storage unavailable/);
});

test('账号切换后旧分区回包不污染当前账号', async () => {
  const h = setup();
  const task = h.store.getState().refreshAll(context);
  h.daily.resolve({ songs: [] });
  await new Promise(setImmediate);
  h.store.setState({ cacheKey: 'another-account', sections: [] });
  h.playlists.resolve([playlist]); h.disk.resolve();
  await task;
  assert.equal(h.store.getState().sections.length, 0);
  assert.equal(h.writes.length, 0);
});
