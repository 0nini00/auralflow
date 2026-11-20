const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, deferred, mobileRequire } = require('./helpers/loadTs.cjs');
const { createStore } = mobileRequire('zustand/vanilla');

const LEGACY_KEY = 'auralflow.mobile.webdavCloudPlaylistSongs';
const song = id => ({ id: String(id), source: 'wy', name: `Song ${id}`, singer: 'Artist' });
function storageFixture(initial = [], hooks = {}) {
  const values = new Map(initial);
  const writes = [];
  const storage = {
    getItem: async key => { await hooks.read?.(key); return values.get(key) ?? null; },
    setItem: async (key, value) => { await hooks.write?.(key, value); writes.push({ key, value }); values.set(key, value); },
    removeItem: async key => { await hooks.remove?.(key); values.delete(key); },
  };
  return { values, writes, storage };
}

test('opening another cloud playlist only serializes its own songs', async () => {
  let serializations = 0;
  const f = storageFixture();
  const load = createLoader({
    zustand: { create: createStore }, '@react-native-async-storage/async-storage': f.storage,
    '../services/wyPlaylistService': { getPlaylistDetail: async id => Array.from({ length: 100 }, (_, n) => {
      const entry = song(`${id}-${n}`);
      Object.defineProperty(entry, 'toJSON', { value() { serializations++; return this; } });
      return entry;
    }) },
    '../services/txPlaylistService': {}, './accountStore': {},
    '../stores/customSourceStore': { useCustomSourceStore: createStore(() => ({ sources: [] })) },
    '@/services/secureStorageService': {}, '@/services/webdavUrlModel': {},
    '@/services/logger': { logger: { warn() {}, error() {} } },
    '@/utils/fetchWithTimeout': {}, pako: mobileRequire('pako'),
  });
  const playlists = load('src/stores/playlistStore.ts').usePlaylistStore;
  load('src/services/webdavSyncService.ts');
  for (const id of ['a', 'b', 'c']) {
    await playlists.getState().fetchPlaylistDetail(id, 'wy', { id, source: 'wy', name: id });
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(serializations, 300, 'three distinct 100-song lists must not repeatedly serialize earlier lists');
  assert.equal(f.writes.length, 3);
  assert.equal(new Set(f.writes.map(write => write.key)).size, 3);
});

function createCache(f) {
  return createLoader({})('src/services/cloudPlaylistSongsCache.ts').createCloudPlaylistSongsCache(f.storage);
}

test('legacy cache migrates once and a fresh cache reads separate playlist records', async () => {
  const f = storageFixture([[LEGACY_KEY, JSON.stringify({ 'wy:a': [song('a')], 'tx:b': [song('b')] })]]);
  const cache = createCache(f);
  assert.deepEqual(await cache.get('wy:a'), [song('a')]);
  assert.equal(f.values.has(LEGACY_KEY), false);
  assert.deepEqual(await createCache(f).get('tx:b'), [song('b')]);
  const count = f.writes.length;
  await cache.setLocal('wy:a', [song('a2')]);
  assert.equal(f.writes.length, count + 1);
  assert.deepEqual(await createCache(f).get('tx:b'), [song('b')]);
});

test('legacy and earlier per-playlist records keep their songs during automatic merge', async () => {
  const key = `${LEGACY_KEY}.playlist.v1:${encodeURIComponent('wy:a')}`;
  for (const initial of [
    [[LEGACY_KEY, JSON.stringify({ 'wy:a': [song('local')] })]],
    [[key, JSON.stringify([song('local')])]],
  ]) {
    const f = storageFixture(initial);
    const cache = createCache(f);
    await cache.mergeRemote(new Map([['wy:a', [song('remote')]]]));
    assert.deepEqual(await cache.get('wy:a'), [song('local')]);
    await cache.mergeRemote(new Map([['wy:a', [song('remote')]]]), { overwriteLocal: true });
    assert.deepEqual(await createCache(f).get('wy:a'), [song('remote')]);
  }
});

test('retrying interrupted migration preserves an already written entry and its origin', async () => {
  const key = `${LEGACY_KEY}.playlist.v1:${encodeURIComponent('wy:a')}`;
  const f = storageFixture([
    [LEGACY_KEY, JSON.stringify({ 'wy:a': [song('legacy-old')], 'wy:b': [song('legacy-b')] })],
    [key, JSON.stringify({ songs: [song('downloaded')], origin: 'remote' })],
  ]);
  const cache = createCache(f);
  assert.deepEqual(await cache.get('wy:a'), [song('downloaded')]);
  assert.deepEqual(await cache.get('wy:b'), [song('legacy-b')]);
  await cache.mergeRemote(new Map([['wy:a', [song('remote-new')]]]));
  assert.deepEqual(await cache.get('wy:a'), [song('remote-new')]);
  assert.equal(f.values.has(LEGACY_KEY), false);
});

test('a local clear queued during legacy loading wins and survives restart and remote merge', async () => {
  const gate = deferred();
  const entered = deferred();
  const f = storageFixture([[LEGACY_KEY, JSON.stringify({ 'wy:a': [song('old')] })]], {
    read: async key => { if (key === LEGACY_KEY) { entered.resolve(); await gate.promise; } },
  });
  const cache = createCache(f);
  const loading = cache.get('wy:a');
  await entered.promise;
  const clearing = cache.setLocal('wy:a', []);
  gate.resolve();
  await Promise.all([loading, clearing]);
  await cache.mergeRemote(new Map([['wy:a', [song('remote')]]]));
  assert.deepEqual(await cache.get('wy:a'), []);
  const restarted = createCache(f);
  await restarted.mergeRemote(new Map([['wy:a', [song('remote')]]]));
  assert.deepEqual(await restarted.get('wy:a'), []);
});

test('local edit beats stale remote completion and the next local edit can refill a cleared list', async () => {
  const f = storageFixture();
  const cache = createCache(f);
  await cache.mergeRemote(new Map([['wy:a', [song('old')]]]));
  const sinceRevision = cache.revision();
  await cache.setLocal('wy:a', [song('local')]);
  await cache.mergeRemote(new Map([['wy:a', [song('stale')]], ['wy:b', [song('b')]]]), { sinceRevision });
  assert.deepEqual(await cache.get('wy:a'), [song('local')]);
  await cache.setLocal('wy:a', []);
  await cache.setLocal('wy:a', [song('refilled')]);
  assert.deepEqual(await cache.get('wy:a'), [song('refilled')]);
});

test('a local edit queued during explicit download still beats its stale response', async () => {
  const f = storageFixture();
  const cache = createCache(f);
  await cache.setLocal('wy:a', [song('before')]);
  const sinceRevision = cache.revision();
  const editing = cache.setLocal('wy:a', [song('during')]);
  const downloading = cache.mergeRemote(new Map([['wy:a', [song('remote')]]]), { sinceRevision, overwriteLocal: true });
  await Promise.all([editing, downloading]);
  assert.deepEqual(await createCache(f).get('wy:a'), [song('during')]);
});

test('a later explicit remote refresh replaces earlier local snapshots and clear markers', async () => {
  const f = storageFixture();
  const cache = createCache(f);
  await cache.setLocal('wy:a', [song('local')]);
  await cache.mergeRemote(new Map([['wy:a', [song('new-remote')]]]), { sinceRevision: cache.revision(), overwriteLocal: true });
  assert.deepEqual(await cache.get('wy:a'), [song('new-remote')]);
  await cache.setLocal('wy:a', []);
  const restarted = createCache(f);
  await restarted.mergeRemote(new Map([['wy:a', [song('explicitly-restored')]]]), { sinceRevision: restarted.revision(), overwriteLocal: true });
  assert.deepEqual(await restarted.get('wy:a'), [song('explicitly-restored')]);
});

test('migration and writes reject explicitly and never discard the legacy file on partial failure', async () => {
  let rejectWrite = true;
  const f = storageFixture([[LEGACY_KEY, JSON.stringify({ 'wy:a': [song('a')] })]], {
    write: async () => { if (rejectWrite) throw new Error('disk full'); },
  });
  const cache = createCache(f);
  await assert.rejects(cache.get('wy:a'), /disk full/);
  assert.ok(f.values.has(LEGACY_KEY));
  rejectWrite = false;
  assert.deepEqual(await cache.get('wy:a'), [song('a')]);
  rejectWrite = true;
  await assert.rejects(cache.setLocal('wy:a', [song('new')]), /disk full/);
  await assert.rejects(cache.get('wy:a'), /disk full/);
  rejectWrite = false;
  await cache.setLocal('wy:a', [song('new')]);
  assert.deepEqual(await cache.get('wy:a'), [song('new')]);
});

test('corrupt cache data rejects rather than being uploaded as an empty playlist', async () => {
  const f = storageFixture([[LEGACY_KEY, '{bad']]);
  await assert.rejects(createCache(f).get('wy:a'));
  assert.equal(f.values.get(LEGACY_KEY), '{bad');
  assert.equal(f.writes.length, 0);
});

function uploadFixture({ write, remote, initial = [] } = {}) {
  const f = storageFixture([['auralflow.mobile.webdavConfig', JSON.stringify({ url: 'https://fixture.invalid', username: 'fixture' })], ...initial], { write });
  const requests = [];
  const playlists = createStore(() => ({ playlists: [{ id: 'a', name: 'a', source: 'wy' }], localPlaylists: [],
    currentPlaylist: null, currentPlaylistSongs: [], loadLocalPlaylists: async () => {}, mergeFromSync: async () => {} }));
  const load = createLoader({
    '@react-native-async-storage/async-storage': f.storage,
    '../stores/playlistStore': { usePlaylistStore: playlists },
    '../stores/favoritesStore': { useFavoritesStore: { getState: () => ({ favorites: [], loadFromStorage: async () => {}, mergeAll: async () => {} }) } },
    '../stores/historyStore': { useHistoryStore: { getState: () => ({ entries: [], loadHistory: async () => {}, mergeHistory: async () => {} }) } },
    '../stores/customSourceStore': {},
    '@/services/secureStorageService': { getSecureItem: async () => 'fixture-only' },
    '@/services/webdavUrlModel': { assertHttpsWebdavUrl() {} },
    '@/services/logger': { logger: { warn() {}, error() {} } },
    '@/utils/fetchWithTimeout': { fetchWithTimeout: async (_url, init) => {
      requests.push(init);
      if (init.method === 'GET' && remote) return { ok: true, status: 200, text: async () => JSON.stringify(remote) };
      assert.notEqual(init.method, 'GET', 'known clear must not prime stale remote songs');
      return { ok: true, status: init.method === 'PROPFIND' ? 207 : 201 };
    } },
    pako: mobileRequire('pako'),
  });
  return { ...f, playlists, requests, service: load('src/services/webdavSyncService.ts') };
}

test('clearing a loaded cloud list then leaving its detail uploads an empty list', async () => {
  const f = uploadFixture();
  f.playlists.setState({ currentPlaylist: { id: 'a', name: 'a', source: 'wy' }, currentPlaylistSongs: [song('old')] });
  f.playlists.setState({ currentPlaylistSongs: [] });
  f.playlists.setState({ currentPlaylist: null, currentPlaylistSongs: [] });
  await f.service.uploadPlaylistsSync();
  const upload = f.requests.find(request => request.method === 'PUT');
  assert.deepEqual(JSON.parse(upload.body).data.userList[0].list, []);
});

test('explicit download updates the next upload even while an older loaded detail is still open', async () => {
  const remote = { version: '3', lastModified: Date.now(), data: { defaultList: [], loveList: [],
    userList: [{ id: 'a', source: 'wy', name: 'a', list: [song('remote-new')] }] }, playHistory: [] };
  const f = uploadFixture({ remote });
  f.playlists.setState({ currentPlaylist: { id: 'a', name: 'a', source: 'wy' }, currentPlaylistSongs: [song('old-loaded')] });
  await new Promise(resolve => setImmediate(resolve));
  await f.service.downloadPlaylistsSync();
  await f.service.uploadPlaylistsSync();
  const upload = f.requests.find(request => request.method === 'PUT');
  assert.deepEqual(JSON.parse(upload.body).data.userList[0].list.map(item => item.id), ['remote-new']);
});

for (const restart of [false, true]) {
  test(`automatic sync preserves earlier nonempty local edits${restart ? ' after restart' : ' while the detail stays open'}`, async () => {
    const remote = { version: '3', lastModified: Date.now(), data: { defaultList: [], loveList: [],
      userList: [{ id: 'a', source: 'wy', name: 'a', list: [song('remote-old')] }] }, playHistory: [] };
    const first = uploadFixture({ remote });
    first.playlists.setState({ currentPlaylist: { id: 'a', name: 'a', source: 'wy' }, currentPlaylistSongs: [song('local-edited')] });
    await new Promise(resolve => setImmediate(resolve));
    const f = restart ? uploadFixture({ remote, initial: [...first.values] }) : first;
    await f.service.autoSyncPlaylistsOnce();
    const upload = f.requests.find(request => request.method === 'PUT');
    assert.deepEqual(JSON.parse(upload.body).data.userList[0].list.map(item => item.id), ['local-edited']);
  });
}

test('automatic sync still refreshes a previously downloaded snapshot after restart', async () => {
  const archive = id => ({ version: '3', lastModified: Date.now(), data: { defaultList: [], loveList: [],
    userList: [{ id: 'a', source: 'wy', name: 'a', list: [song(id)] }] }, playHistory: [] });
  const first = uploadFixture({ remote: archive('remote-old') });
  await first.service.downloadPlaylistsSync();
  const restarted = uploadFixture({ remote: archive('remote-new'), initial: [...first.values] });
  await restarted.service.autoSyncPlaylistsOnce();
  const upload = restarted.requests.find(request => request.method === 'PUT');
  assert.deepEqual(JSON.parse(upload.body).data.userList[0].list.map(item => item.id), ['remote-new']);
});

test('a failed background cache write is visible and blocks uploading stale songs', async () => {
  const f = uploadFixture({ write: async key => { if (key.includes('.playlist.v1:')) throw new Error('cache write failed'); } });
  f.playlists.setState({ currentPlaylist: { id: 'a', name: 'a', source: 'wy' }, currentPlaylistSongs: [song('edited')] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.playlists.getState().error, 'cache write failed');
  await assert.rejects(f.service.uploadPlaylistsSync(), /cache write failed/);
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 0);
});
