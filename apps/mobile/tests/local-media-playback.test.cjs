const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, deferred, mobileRequire } = require('./helpers/loadTs.cjs');
const options = { timeout: 5000 };
const song = id => ({ id, source: 'local', isLocal: true, name: id, singer: 'Singer', albumName: 'Album', interval: 100, url: `file:///music/${id}.mp3` });
const result = text => ({ status: 'matched', lyrics: [{ time: 1, text }], coverUri: 'file:///cache/art.jpg', message: '', issues: [] });
function setup() {
  const calls = [], requests = [];
  const coreLoader = createLoader({});
  const native = { pause: async () => calls.push('pause') };
  const cache = { getCachedPlaybackUrl: async () => null, saveCachedPlaybackUrl: async () => {}, invalidateCachedPlaybackUrl: async () => {} };
  const mocks = {
    zustand: mobileRequire('zustand'), 'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
    'react-native-track-player': { __esModule: true, default: native, State: { Paused: 'paused', Playing: 'playing', Buffering: 'buffering', Stopped: 'stopped' }, RepeatMode: {}, Event: {}, AppKilledPlaybackBehavior: {}, Capability: {} },
    '@lx/core': { ...coreLoader('../../packages/core/src/switch-step-queue.ts'), ...coreLoader('../../packages/core/src/playback-quality.ts'), isPreviewDuration: () => false },
    '@/services/logger': { logger: { info() {}, warn() {}, error() {} } }, '@/services/androidPitchService': {},
    '@/services/playbackUrlCache': cache, './playbackUrlCache': cache, '@/services/playbackFailurePolicy': {},
    '@/services/lyricOverlayService': { isLyricOverlaySupported: () => false },
    '@/services/listenTrackerService': { resetListeningSession() {} }, './listenTrackerService': {},
    './musicApi': { getLyrics: async () => { calls.push('oldLyrics'); return [{ time: 1, text: 'stale' }]; } },
    './wyDirectProvider': {}, './wyPlaylistService': {}, './customSourceRuntime': {}, '../stores/customSourceStore': {}, './streamProbe': {},
    '@/services/crossSourceFallbackService': {}, '@/stores/playbackSettingsStore': { usePlaybackSettingsStore: { getState: () => ({}) } },
    './cacheService': { CACHEABLE_AUDIO_SOURCES: new Set(), getCachedLyrics: async () => { calls.push('oldCache'); return [{ time: 1, text: 'stale cache' }]; }, cacheLyrics: async () => {}, cacheCover: async () => {} },
    './localMediaRuntime': { resolveLocalMediaAssets: (song, update, current) => {
      const gate = deferred(); requests.push({ song, update, current, gate }); return gate.promise;
    } },
  };
  const load = createLoader(mocks);
  const store = load('src/stores/playerStore.ts').usePlayerStore;
  const service = load('src/services/playerService.ts');
  const a = song('A'), queue = [a];
  store.setState({ currentSong: a, currentUrl: a.url, queue, currentIndex: 0, position: 37, lyrics: [], isPlaying: false });
  return { load, store, service, a, queue, calls, requests };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('本地歌词走统一补全，不先命中旧通用缓存；封面不改写歌曲或队列', options, async () => {
  const h = setup(), pending = h.service.loadLyricsForRestoredSong(h.a); await flush();
  assert.equal(h.requests.length, 1); assert.deepEqual(h.calls, []);
  h.requests[0].update(result('fresh')); h.requests[0].gate.resolve(result('fresh')); await pending;
  const state = h.store.getState();
  assert.equal(state.lyrics[0].text, 'fresh'); assert.strictEqual(state.currentSong, h.a); assert.strictEqual(state.queue, h.queue);
  assert.equal(state.currentUrl, h.a.url); assert.equal(state.position, 37); assert.equal(state.isPlaying, false);
  assert.equal(h.load('src/services/localMediaPlaybackModel.ts').selectPlaybackArtwork(state), 'file:///cache/art.jpg');
});
test('本地补全等待期间暂停不丢弃歌词，音频不会重新播放', options, async () => {
  const h = setup(), pending = h.service.loadLyricsForRestoredSong(h.a); await flush();
  assert.equal(h.requests.length, 1);
  await h.store.getState().pause();
  assert.equal(h.requests[0].current(), true);
  h.requests[0].update(result('after pause')); h.requests[0].gate.resolve(result('after pause')); await pending;
  assert.equal(h.store.getState().lyrics[0].text, 'after pause'); assert.equal(h.store.getState().isPlaying, false);
});
test('并发打开播放页复用当前补全，切歌后旧结果无效', options, async () => {
  const h = setup(); const one = h.service.loadLyricsForRestoredSong(h.a); const two = h.service.loadLyricsForRestoredSong(h.a); await flush();
  assert.equal(h.requests.length, 1);
  const b = song('B'); h.store.setState({ currentSong: b, localMedia: null, lyrics: [] });
  h.requests[0].update(result('old')); h.requests[0].gate.resolve(result('old')); await Promise.all([one, two]);
  assert.deepEqual(h.store.getState().lyrics, []);
  assert.equal(h.load('src/services/localMediaPlaybackModel.ts').selectPlaybackArtwork(h.store.getState()), undefined);
});
test('同一首重新播放建立新补全所有权，旧A不能覆盖新A', options, async () => {
  const h = setup(), old = h.service.loadLyricsForRestoredSong(h.a); await flush();
  h.store.setState({ localMedia: null });
  const next = h.service.loadLyricsForRestoredSong(h.a); await flush();
  assert.equal(h.requests.length, 2);
  h.requests[1].update(result('new')); h.requests[1].gate.resolve(result('new')); await next;
  h.requests[0].update(result('old')); h.requests[0].gate.resolve(result('old')); await old;
  assert.equal(h.store.getState().lyrics[0].text, 'new');
});
test('未匹配与失败不会变成音频播放错误，已有歌词不被清空', options, async () => {
  const h = setup(), pending = h.service.loadLyricsForRestoredSong(h.a); await flush();
  assert.equal(h.requests.length, 1);
  h.requests[0].update({ ...result('local'), status: 'error', message: '资料查询失败', issues: ['network'] });
  h.requests[0].gate.resolve(); await pending;
  assert.equal(h.store.getState().error, null); assert.equal(h.store.getState().lyrics[0].text, 'local');
  assert.equal(h.store.getState().localMedia.message, '资料查询失败');
});

test('非本地播放或过期封面不能覆盖当前歌曲，派生封面不写回原对象', () => {
  const model = createLoader({})('src/services/localMediaPlaybackModel.ts');
  const local = song('A');
  const media = { ...result('text'), requestId: 1, songKey: model.localMediaSongKey(local) };
  const remote = { id: 'B', source: 'wy', name: 'B', singer: 'S', picUrl: 'https://example.test/original.jpg' };
  assert.equal(model.selectPlaybackArtwork({ currentSong: remote, localMedia: media }), remote.picUrl);
  assert.equal(model.selectPlaybackArtwork({ currentSong: song('B'), localMedia: media }), undefined);
  assert.equal(local.picUrl, undefined);
});

test('播放器两处封面共享派生选择器，歌词空态显示补全状态', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { mobileRoot } = require('./helpers/loadTs.cjs');
  const read = name => fs.readFileSync(path.join(mobileRoot, 'src', name), 'utf8');
  for (const name of ['components/PlayerBar.tsx', 'screens/immersive/useImmersiveController.ts']) {
    assert.match(read(name), /usePlayerStore\(selectPlaybackArtwork\)/);
  }
  assert.match(read('screens/ImmersiveLyricsScreen.tsx'), /emptyText=\{localMediaMessage\}/);
  assert.match(read('components/LyricView.tsx'), /\{emptyText\}/);
});
