const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, deferred, mobileRequire } = require('./helpers/loadTs.cjs');

const song = { id: 'one', source: 'tx', name: 'Song', singer: 'Artist', albumName: '', interval: 300 };
function setup() {
  const writes = [];
  const files = new Map();
  const monthsWritten = [];
  const history = [];
  let legacyRemoved = 0;
  let stored = null;
  let read = async () => stored;
  let write = async () => {};
  const errors = [];
  const load = createLoader({
    zustand: mobileRequire('zustand'),
    '@react-native-async-storage/async-storage': { getItem: (...args) => read(...args), removeItem: async () => { legacyRemoved += 1; stored = null; }, setItem: async () => { throw new Error('统计不得写入业务AsyncStorage'); } },
    'react-native': { NativeModules: { ListeningStatsStore: {
      listMonths: async () => [...files.keys()], readMonth: async month => files.get(month) ?? null,
      writeMonth: async (month, value) => { await write(month, value); files.set(month, value); monthsWritten.push(month); writes.push(JSON.parse(value)); },
    } } },
    '@/stores/historyStore': { useHistoryStore: { getState: () => ({ addToHistory: async song => { history.push(song); } }) } },
    '@/stores/playbackSettingsStore': { usePlaybackSettingsStore: { getState: () => ({ enableScrobble: false }) } },
    './wyScrobbleService': { scrobbleWySong: async () => {} },
    '@/services/logger': { logger: { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) } },
  });
  const tracker = load('src/services/listenTrackerService.ts');
  return { tracker, load, writes, errors, files, history, monthsWritten, legacyRemoved: () => legacyRemoved, setRead: fn => { read = fn; }, setWrite: fn => { write = fn; } };
}

test('真实收听在十秒 checkpoint、暂停、seek、倍速和同曲重播后保留独立事件', async () => {
  const h = setup();
  assert.equal(typeof h.tracker.flushListeningSession, 'function');
  const stats = h.load('src/stores/listeningStatsStore.ts').useListeningStatsStore;
  h.tracker.startListeningSession(song, 0, 2, 0);
  h.tracker.onPlaybackProgress(20, true, 2, 10000);
  await h.tracker.flushListeningSession();
  assert.equal(stats.getState().events[0].listenedMs, 10000);
  h.tracker.onPlaybackProgress(22, false, 2, 11000);
  h.tracker.onPlaybackProgress(22, true, 2, 30000);
  h.tracker.seekListeningSession(200, true, 2, 30000);
  h.tracker.onPlaybackProgress(204, true, 2, 32000);
  h.tracker.resetListeningSession();
  h.tracker.startListeningSession(song, 0, 1, 32000);
  h.tracker.onPlaybackProgress(1, true, 1, 33000);
  await h.tracker.flushListeningSession();
  assert.deepEqual(stats.getState().events.map(event => event.listenedMs), [13000, 1000]);
  assert.equal(new Set(stats.getState().events.map(event => event.sessionId)).size, 2);
});

test('读盘未完成期间的记录合并旧事件，串行写盘失败可见且可重试', async () => {
  const h = setup();
  assert.equal(typeof h.tracker.flushListeningSession, 'function');
  const gate = deferred(); h.setRead(() => gate.promise);
  const stats = h.load('src/stores/listeningStatsStore.ts').useListeningStatsStore;
  const loading = stats.getState().load();
  h.tracker.startListeningSession(song, 0, 1, 0);
  h.tracker.onPlaybackProgress(1, true, 1, 1000);
  const saving = h.tracker.flushListeningSession();
  gate.resolve(JSON.stringify([{ sessionId: 'old', song, startedAt: 1, listenedMs: 2000 }]));
  await Promise.all([loading, saving]);
  assert.equal(stats.getState().events.length, 2);
  h.setWrite(async () => { throw new Error('disk full'); });
  h.tracker.onPlaybackProgress(2, true, 1, 2000);
  await assert.rejects(h.tracker.flushListeningSession(), /disk full/);
  assert.match(stats.getState().error, /disk full/);
  h.setWrite(async (_key, value) => h.writes.push(JSON.parse(value)));
  await h.tracker.flushListeningSession();
  assert.equal(stats.getState().error, null);
  assert.equal([...h.files.values()].flatMap(JSON.parse).length, 2);
});

test('损坏统计不解释为空库，也不回写覆盖', async () => {
  const h = setup();
  assert.equal(typeof h.tracker.flushListeningSession, 'function');
  h.setRead(async () => '[{"playedAt":123}]');
  await assert.rejects(h.tracker.flushListeningSession(), /无效事件/);
  assert.equal(h.writes.length, 0);
});

test('串行写盘在阻塞期间接收新 checkpoint，最终文件包含较新进度', async () => {
  const h = setup();
  const gate = deferred();
  const entered = deferred();
  let active = 0;
  let maximum = 0;
  const snapshots = [];
  h.setWrite(async (_key, value) => {
    maximum = Math.max(maximum, ++active);
    snapshots.push(JSON.parse(value));
    if (snapshots.length === 1) { entered.resolve(); await gate.promise; }
    active -= 1;
  });
  h.tracker.startListeningSession(song, 0, 1, 0);
  h.tracker.onPlaybackProgress(1, true, 1, 1000);
  const first = h.tracker.flushListeningSession();
  await entered.promise;
  h.tracker.onPlaybackProgress(2, true, 1, 2000);
  const second = h.tracker.flushListeningSession();
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(maximum, 1);
  assert.equal(snapshots.at(-1)[0].listenedMs, 2000);
});

test('超过6MiB的跨月会话迁移至独立文件，后续仅序列化和写入变更月份', async () => {
  const h = setup();
  const legacy = Array.from({ length: 40_000 }, (_, index) => ({
    sessionId: `large-${index}`, song: { ...song, name: '长期听歌记录'.repeat(10) },
    startedAt: Date.UTC(2026, index % 12, 1), listenedMs: 1000,
  }));
  const raw = JSON.stringify(legacy);
  assert.ok(Buffer.byteLength(raw) > 6 * 1024 * 1024);
  h.setRead(async () => raw);
  const stats = h.load('src/stores/listeningStatsStore.ts').useListeningStatsStore;
  await stats.getState().flush();
  assert.equal(stats.getState().events.length, 40_000);
  assert.equal(h.files.size, 12);
  assert.equal(h.legacyRemoved(), 1);
  h.monthsWritten.length = 0;
  const unchanged = stats.getState().events.find(event => event.startedAt === Date.UTC(2026, 1, 1));
  Object.defineProperty(unchanged, 'toJSON', { value: () => { throw new Error('未修改月份不应序列化'); } });
  const january = stats.getState().events.find(event => event.startedAt === Date.UTC(2026, 0, 1));
  stats.getState().record({ ...january, listenedMs: 2000 });
  await stats.getState().flush();
  assert.deepEqual(h.monthsWritten, ['2026-01']);
  await stats.getState().flush();
  assert.deepEqual(h.monthsWritten, ['2026-01']);
});

test('月份文件损坏时只跳过该月，不覆盖原文件也不连累其它月份', async () => {
  const h = setup();
  h.files.set('2026-01', '[{"sessionId":"bad"}]');
  const stats = h.load('src/stores/listeningStatsStore.ts').useListeningStatsStore;
  await stats.getState().flush();
  assert.match(stats.getState().warning, /2026-01/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.files.get('2026-01'), '[{"sessionId":"bad"}]');
  assert.equal(h.legacyRemoved(), 0);
  // 损坏月份不再接收新事件（避免覆盖仅存的数据），健康月份照常落盘。
  stats.getState().record({ sessionId: 'new-in-jan', song, startedAt: Date.UTC(2026, 0, 2), listenedMs: 1000 });
  stats.getState().record({ sessionId: 'new-in-feb', song, startedAt: Date.UTC(2026, 1, 2), listenedMs: 1000 });
  await stats.getState().flush();
  assert.deepEqual(h.monthsWritten, ['2026-02']);
  assert.equal(h.files.get('2026-01'), '[{"sessionId":"bad"}]');
});

test('迁移写入失败保留旧key和既有月份，重试成功后才删除key', async () => {
  const h = setup();
  const event = { sessionId: 'existing', song, startedAt: Date.UTC(2026, 0, 1), listenedMs: 1000 };
  h.files.set('2026-01', JSON.stringify([event]));
  h.setRead(async () => JSON.stringify([{ ...event, listenedMs: 2000 }]));
  h.setWrite(async () => { throw new Error('atomic write rejected'); });
  const stats = h.load('src/stores/listeningStatsStore.ts').useListeningStatsStore;
  await assert.rejects(stats.getState().flush(), /atomic write rejected/);
  assert.equal(JSON.parse(h.files.get('2026-01'))[0].listenedMs, 1000);
  assert.equal(h.legacyRemoved(), 0);
  h.setWrite(async () => {});
  await stats.getState().flush();
  assert.equal(JSON.parse(h.files.get('2026-01'))[0].listenedMs, 2000);
  assert.equal(h.legacyRemoved(), 1);
});

test('最近播放仍按媒体连续进度达到50%入历史，真实统计按倍速经过时间累计', async () => {
  const h = setup();
  h.tracker.startListeningSession({ ...song, interval: 180 }, 0, 2, 0);
  for (let tick = 1; tick <= 180; tick += 1) h.tracker.onPlaybackProgress(tick / 2, true, 2, tick * 250);
  await h.tracker.flushListeningSession();
  assert.equal(h.history.length, 1);
  const stats = h.load('src/stores/listeningStatsStore.ts').useListeningStatsStore;
  assert.equal(stats.getState().events[0].listenedMs, 45_000);
});

test('实际原生播放入口在同曲重播、倍速、暂停、seek 和后台切换时累计真实会话', async (t) => {
  const listeners = new Map();
  const serviceEvents = new Map();
  let appState;
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const addListener = (event, fn) => {
    const list = serviceEvents.get(event) ?? [];
    list.push(fn); serviceEvents.set(event, list);
    if (!listeners.has(event)) listeners.set(event, fn);
    return { remove() {} };
  };
  const native = { addEventListener: addListener, getState: async () => 'playing', getPlayWhenReady: async () => true };
  for (const name of ['setupPlayer', 'updateOptions', 'setRepeatMode', 'add', 'skip', 'remove', 'setRate', 'setVolume', 'play', 'pause', 'stop', 'setPlayWhenReady', 'seekTo']) native[name] = async () => {};
  native.getQueue = async () => [];
  const writes = [];
  const load = createLoader({
    zustand: mobileRequire('zustand'),
    'react-native': { NativeModules: { ListeningStatsStore: { listMonths: async () => [], readMonth: async () => null, writeMonth: async (_month, value) => writes.push(JSON.parse(value)) } }, DeviceEventEmitter: { addListener }, AppState: { addEventListener: (_name, listener) => { appState = listener; return { remove() {} }; } } },
    'react-native-track-player': { __esModule: true, default: native, State: { Playing: 'playing', Paused: 'paused', Stopped: 'stopped', Buffering: 'buffering' },
      Event: Object.fromEntries(['RemotePlay', 'RemotePause', 'RemoteStop', 'RemoteNext', 'RemotePrevious', 'RemoteSeek', 'RemoteDuck', 'PlaybackQueueEnded', 'PlaybackProgressUpdated', 'PlaybackState', 'PlaybackActiveTrackChanged', 'PlaybackError'].map(name => [name, name])), RepeatMode: { Off: 0 }, AppKilledPlaybackBehavior: {}, Capability: {} },
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async (key, value) => { if (key === 'af-listening-events-v1') writes.push(JSON.parse(value)); } },
    '@/services/logger': { logger: { info() {}, warn() {}, error() {} } },
    '@/services/lyricOverlayService': { isLyricOverlaySupported: () => false },
    '@/services/lyricOverlayPlayback': { syncLyricOverlayPlaybackClock: async () => {} },
    '@/services/playbackUrlCache': {},
    '@/services/audioInterruptionPolicy': { getAudioInterruptionAction: () => ({ type: 'none' }) },
    '../services/playerService': { cancelPendingPlayback: () => 0, prefetchUpcomingSongNearEnd() {} },
    '@/stores/historyStore': { useHistoryStore: { getState: () => ({ addToHistory: async () => {} }) } },
    '@/stores/playbackSettingsStore': { usePlaybackSettingsStore: { getState: () => ({ enableScrobble: false }) } },
    './wyScrobbleService': { scrobbleWySong: async () => {} },
  });
  const { usePlayerStore: player, setupPlayerListeners, SILENCE_GAP_TRACK_ID } = load('src/stores/playerStore.ts');
  const request = load('src/services/playbackRequest.ts');
  const tracker = load('src/services/listenTrackerService.ts');
  const stats = load('src/stores/listeningStatsStore.ts').useListeningStatsStore;
  setupPlayerListeners();
  await player.getState().play(song, 'file:one');
  const progress = (elapsed, position) => { clock += elapsed; listeners.get('PlaybackProgressUpdated')({ position, duration: 300, buffered: 300 }); };
  progress(1000, 1);
  // PlaybackError 不带轨道身份，迟到错误不能在尚未确认失败时销毁在播会话。
  listeners.get('PlaybackError')({ message: '旧管线迟到错误' });
  player.getState().syncPlayerState('paused');
  progress(10000, 1);
  player.getState().syncPlayerState('playing');
  native.setRate = async () => { throw new Error('rate rejected'); };
  await assert.rejects(player.getState().setPlaybackRate(2), /rate rejected/);
  assert.equal(player.getState().playbackRate, 1);
  native.setRate = async () => {};
  await player.getState().setPlaybackRate(2);
  progress(1000, 3);
  await player.getState().seekTo(200);
  progress(1000, 202);
  appState('background');
  await tracker.flushListeningSession();
  assert.equal(stats.getState().events[0].listenedMs, 3000);
  listeners.get('PlaybackActiveTrackChanged')({ track: { id: SILENCE_GAP_TRACK_ID }, lastTrack: { id: 'tx-old' }, lastPosition: 300 });
  progress(1000, 204);
  request.beginPlaybackRequest();
  await player.getState().play(song, 'file:one');
  progress(1000, 2);
  clock += 500;
  listeners.get('PlaybackActiveTrackChanged')({ track: { id: SILENCE_GAP_TRACK_ID }, lastPosition: 3 });
  await tracker.flushListeningSession();
  assert.deepEqual(stats.getState().events.map(event => event.listenedMs), [4000, 1500]);
  assert.ok(writes.length > 0);
  const service = load('src/player/playbackService.ts');
  player.setState({ playMode: 'single' });
  const lifetime = service({ serviceId: 'stats' });
  const emit = async (event, payload) => { for (const listener of serviceEvents.get(event) ?? []) await listener(payload); };
  await emit('PlaybackActiveTrackChanged', { track: { id: SILENCE_GAP_TRACK_ID }, lastTrack: { id: 'tx-one' }, lastPosition: 3 });
  progress(1000, 2);
  await emit('auralflow-playback-service-destroyed', { serviceId: 'stats' });
  await lifetime;
  assert.deepEqual(stats.getState().events.map(event => event.listenedMs), [4000, 1500, 1000]);
  assert.deepEqual(writes.at(-1).map(event => event.listenedMs), [4000, 1500, 1000]);
});
