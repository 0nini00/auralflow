const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, deferred, mobileRequire } = require('./helpers/loadTs.cjs');
const { React, renderer, host, theme } = require('./helpers/renderNative.cjs');
const { createStore } = mobileRequire('zustand/vanilla');

const song = { id: 'one', source: 'wy', name: 'Song', singer: 'Artist' };
function fixture(events = [], beforeRead) {
  const files = new Map();
  for (const event of events) {
    const month = new Date(event.startedAt).toISOString().slice(0, 7);
    const list = JSON.parse(files.get(month) ?? '[]'); list.push(event); files.set(month, JSON.stringify(list));
  }
  const written = [];
  const load = createLoader({
    zustand: { create: createStore },
    '@react-native-async-storage/async-storage': { getItem: async () => null, removeItem: async () => {} },
    'react-native': { NativeModules: { ListeningStatsStore: {
      listMonths: async () => [...files.keys()], readMonth: async month => { await beforeRead?.(month); return files.get(month) ?? null; },
      writeMonth: async (month, text) => { written.push(month); files.set(month, text); },
    } } },
    '@/services/logger': { logger: { error() {}, warn() {} } },
  });
  const store = load('src/stores/listeningStatsStore.ts').useListeningStatsStore;
  return { load, store, files, written };
}

test('moving an existing session to another UTC month never duplicates it in memory or disk', async () => {
  const previous = { sessionId: 'move', song, startedAt: Date.UTC(2026, 0, 31, 23), listenedMs: 1000 };
  const f = fixture([previous]); await f.store.getState().load();
  f.store.getState().record({ ...previous, startedAt: Date.UTC(2026, 1, 1, 1), listenedMs: 2000 });
  await f.store.getState().flush();
  assert.equal(f.store.getState().events.length, 1);
  assert.deepEqual(JSON.parse(f.files.get('2026-01')), []);
  assert.equal(JSON.parse(f.files.get('2026-02')).length, 1);
});

test('a newer cross-month checkpoint arriving during hydration removes the stale persisted month', async () => {
  const previous = { sessionId: 'move', song, startedAt: Date.UTC(2026, 0, 31, 23), listenedMs: 1000 };
  const gate = deferred(); const entered = deferred();
  const f = fixture([previous], async () => { entered.resolve(); await gate.promise; });
  const loading = f.store.getState().load();
  await entered.promise;
  f.store.getState().record({ ...previous, startedAt: Date.UTC(2026, 1, 1, 1), listenedMs: 2000 });
  gate.resolve();
  await loading;
  await f.store.getState().flush();
  assert.deepEqual(JSON.parse(f.files.get('2026-01')), []);
  assert.equal(JSON.parse(f.files.get('2026-02')).length, 1);
});

test('stats index matches full aggregation but a checkpoint never revisits unrelated historic song metadata', async () => {
  const f = fixture(); await f.store.getState().load();
  const core = f.load('../../packages/core/src/stats/listening-session.ts');
  for (let n = 0; n < 2000; n++) f.store.getState().record({ sessionId: `old-${n}`, song: { ...song, id: String(n) }, startedAt: Date.UTC(2026, n % 10, 1), listenedMs: n + 1 });
  assert.equal(typeof f.store.getState().getStats, 'function');
  const expected = core.aggregateListeningEvents(f.store.getState().events);
  assert.deepEqual(f.store.getState().getStats(), expected);
  const old = f.store.getState().events[0];
  Object.defineProperty(old.song, 'singer', { get() { throw new Error('historic metadata revisited'); } });
  const next = { sessionId: 'new', song, startedAt: Date.UTC(2026, 10, 20), listenedMs: 10000 };
  f.store.getState().record(next);
  assert.equal(f.store.getState().getStats().totalMs, expected.totalMs + 10000);
  const version = f.store.getState().revision;
  f.store.getState().record(next);
  assert.equal(f.store.getState().revision, version);
});

test('unfocused stats page does not request snapshots; focus resumes the latest checkpoint', async () => {
  const f = fixture([{ sessionId: 'one', song, startedAt: Date.UTC(2026, 10, 20), listenedMs: 1000 }]);
  await f.store.getState().load();
  let focused = false;
  let snapshots = 0;
  const original = f.store.getState().getStats;
  if (original) f.store.setState({ getStats: (...args) => { snapshots++; return original(...args); } });
  const core = f.load('../../packages/core/src/index.ts');
  let fullAggregations = 0;
  const loadScreen = createLoader({
    react: React, '@react-navigation/native': { useIsFocused: () => focused },
    'react-native': { View: host('View'), Text: host('Text'), ScrollView: host('ScrollView'), StyleSheet: { create: value => value, hairlineWidth: 1 } },
    'lucide-react-native': new Proxy({}, { get: (_, name) => host(String(name)) }),
    '@lx/core': { ...core, aggregateListeningEvents: events => { fullAggregations++; return core.aggregateListeningEvents(events); } },
    '@/stores/listeningStatsStore': { useListeningStatsStore: selector => React.useSyncExternalStore(f.store.subscribe, () => selector(f.store.getState())), reportListeningStatsError() {} },
    '@/stores/themeStore': theme,
    '@/components/IconButton': { IconButton: host('IconButton') }, '@/components/ScreenScaffold': { ScreenScaffold: host('ScreenScaffold') },
    '@/components/ScreenState': { EmptyState: host('EmptyState'), ErrorState: host('ErrorState'), LoadingState: host('LoadingState') },
    '@/components/SectionHeader': { SectionHeader: host('SectionHeader') },
  });
  const Screen = loadScreen('src/screens/ListeningStatsScreen.tsx').ListeningStatsScreen;
  let root;
  await renderer.act(async () => { root = renderer.create(React.createElement(Screen)); });
  assert.equal(snapshots + fullAggregations, 0);
  await renderer.act(async () => { f.store.getState().record({ sessionId: 'new', song, startedAt: Date.UTC(2026, 10, 20), listenedMs: 10000 }); await f.store.getState().flush(); });
  assert.equal(snapshots, 0);
  assert.equal(f.written.length, 1, 'hidden screen must not stop checkpoint persistence');
  focused = true;
  await renderer.act(async () => root.update(React.createElement(Screen)));
  assert.equal(snapshots, 1);
  assert.equal(fullAggregations, 0);
  renderer.act(() => root.unmount());
});
