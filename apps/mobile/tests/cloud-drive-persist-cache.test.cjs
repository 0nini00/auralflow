const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('./helpers/loadTs.cjs');

/**
 * 云盘落盘缓存（移动端，AsyncStorage）的契约。
 *
 * 与桌面端同一套规则：按 uid 分区、10 分钟保鲜、结构坏了当没有、退出登录必须删、
 * 空列表不落盘。
 */

const storage = new Map();
const asyncStorage = {
  __esModule: true,
  default: {
    getItem: async (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: async (key, value) => { storage.set(key, value); },
    removeItem: async (key) => { storage.delete(key); },
  },
};

const cache = createLoader({ '@react-native-async-storage/async-storage': asyncStorage })(
  'src/services/cloudDriveCache.ts',
);

const song = (id) => ({ id, source: 'wy', name: `歌${id}`, singer: '人' });
const snapshot = (extra = {}) => ({
  songs: [song('1'), song('2')],
  count: 2,
  usedBytes: 1024,
  maxBytes: 2048,
  nextOffset: 50,
  hasMore: false,
  ...extra,
});

function reset() {
  storage.clear();
}

test('写入后能按同一 uid 读回，且算作保鲜', async () => {
  reset();
  await cache.saveCloudDriveSnapshot('uid-A', snapshot());
  const loaded = await cache.loadCloudDriveSnapshot('uid-A');
  assert.equal(loaded.fresh, true);
  assert.deepEqual(loaded.snapshot.songs.map((item) => item.id), ['1', '2']);
  assert.equal(loaded.snapshot.count, 2);
});

test('超过保鲜期仍然读得到，只是标成过期', async () => {
  reset();
  await cache.saveCloudDriveSnapshot('uid-A', snapshot());
  const key = 'auralflow.mobile.cloudDrive.v1:uid-A';
  const parsed = JSON.parse(storage.get(key));
  parsed.cachedAt = Date.now() - cache.CLOUD_DRIVE_CACHE_TTL_MS - 1000;
  storage.set(key, JSON.stringify(parsed));

  const loaded = await cache.loadCloudDriveSnapshot('uid-A');
  assert.equal(loaded.fresh, false);
  assert.equal(loaded.snapshot.songs.length, 2);
});

test('别的账号读不到这份列表，空 uid 也不读', async () => {
  reset();
  await cache.saveCloudDriveSnapshot('uid-A', snapshot());
  assert.equal(await cache.loadCloudDriveSnapshot('uid-B'), null);
  assert.equal(await cache.loadCloudDriveSnapshot(''), null);
});

test('坏 JSON 与空列表都不产生缓存', async () => {
  reset();
  storage.set('auralflow.mobile.cloudDrive.v1:uid-A', '{not json');
  assert.equal(await cache.loadCloudDriveSnapshot('uid-A'), null);

  reset();
  await cache.saveCloudDriveSnapshot('uid-A', snapshot({ songs: [] }));
  assert.equal(storage.has('auralflow.mobile.cloudDrive.v1:uid-A'), false);
});

test('坏掉的行被丢掉，好的行照常返回；退出登录只删自己', async () => {
  reset();
  storage.set('auralflow.mobile.cloudDrive.v1:uid-A', JSON.stringify({
    songs: [song('1'), { source: 'wy', id: '' }, null],
    cachedAt: Date.now(),
  }));
  const loaded = await cache.loadCloudDriveSnapshot('uid-A');
  assert.deepEqual(loaded.snapshot.songs.map((item) => item.id), ['1']);

  await cache.saveCloudDriveSnapshot('uid-B', snapshot({ songs: [song('B1')] }));
  await cache.clearCloudDriveSnapshot('uid-A');
  assert.equal(await cache.loadCloudDriveSnapshot('uid-A'), null);
  const other = await cache.loadCloudDriveSnapshot('uid-B');
  assert.deepEqual(other.snapshot.songs.map((item) => item.id), ['B1']);
});
