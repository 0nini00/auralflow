const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

const song = (id) => ({ id, source: "tx", name: id, singer: "Test", interval: 100 });

function setup() {
  const nativeCalls = [];
  const native = new Proxy({}, { get: (_, name) => (...args) => { nativeCalls.push([name, args]); } });
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "react-native-track-player": { __esModule: true, default: native, State: {}, RepeatMode: {}, Event: {}, AppKilledPlaybackBehavior: {}, Capability: {} },
    "@lx/core": { isPreviewDuration: () => false },
    "@/services/androidPitchService": {},
    "@/services/playbackUrlCache": {},
    "@/services/playbackFailurePolicy": {},
    "@/services/logger": { logger: { warn() {} } },
    "../services/playerService": {},
    "@/services/lyricOverlayService": {},
    "@/services/listenTrackerService": {},
  });
  const store = load("src/stores/playerStore.ts").usePlayerStore;
  const tracks = [song("same"), song("B"), song("same"), song("D")];
  store.getState().setQueue(tracks, 2);
  const queue = store.getState().queue;
  store.setState({ currentSong: queue[2], position: 37.5, duration: 100, currentUrl: "file://current", isPlaying: true,
    shuffleHistory: [0, 2, 1, 2], playedIndices: [0, 2], tempPlayList: [song("next")] });
  return { store, queue, nativeCalls };
}

function reorder(store, queue, from, to) {
  assert.equal(typeof store.getState().reorderQueue, "function", "store must expose the sole reorderQueue action");
  return store.getState().reorderQueue(queue, from, to);
}

for (const [from, to, order, currentIndex, history, played] of [
  [2, 0, [2, 0, 1, 3], 0, [1, 0, 2, 0], [1, 0]],
  [0, 3, [1, 2, 3, 0], 1, [3, 1, 0, 1], [3, 1]],
]) {
  test("reorder " + from + " -> " + to + " preserves exact occurrence, playback and temporary queue", () => {
    const { store, queue, nativeCalls } = setup();
    const before = store.getState();
    let notifications = 0;
    store.subscribe(() => notifications++);
    assert.equal(reorder(store, queue, from, to), "reordered");
    const after = store.getState();
    assert.deepEqual(after.queue, order.map(index => queue[index]));
    assert.equal(after.currentIndex, currentIndex);
    assert.strictEqual(after.queue[currentIndex], before.currentSong);
    assert.deepEqual(after.shuffleHistory, history);
    assert.deepEqual(after.playedIndices, played);
    for (const key of Object.keys(before)) {
      if (!["queue", "currentIndex", "shuffleHistory", "playedIndices"].includes(key)) assert.strictEqual(after[key], before[key], key);
    }
    assert.deepEqual(queue.map(item => item.id), ["same", "B", "same", "D"]);
    assert.equal(notifications, 1);
    assert.deepEqual(nativeCalls, []);
  });
}

for (const type of ["personalFm", "heartbeat"]) {
  test(type + " remaps batch indices without discarding context or its buffer", () => {
    const { store, queue } = setup();
    const context = { type, currentBatch: queue, currentBatchIndex: 2, buffer: [song("buffer")], hasMore: true,
      ...(type === "heartbeat" ? { seedSongId: "seed", playlistId: "playlist" } : {}) };
    store.setState({ playbackContext: context });
    assert.equal(reorder(store, queue, 2, 0), "reordered");
    const state = store.getState();
    assert.deepEqual(state.playbackContext, { ...context, currentBatch: state.queue, currentBatchIndex: 0 });
    assert.strictEqual(state.playbackContext.currentBatch, state.queue);
    assert.strictEqual(state.playbackContext.buffer, context.buffer);
  });
}

test("stale baseline cannot overwrite replacement with identical songs or another reorder", () => {
  const { store, queue } = setup();
  store.getState().setQueue([...queue]);
  const replacement = store.getState();
  assert.equal(reorder(store, queue, 0, 3), "stale");
  assert.strictEqual(store.getState(), replacement);
  const fresh = replacement.queue;
  assert.equal(reorder(store, fresh, 0, 3), "reordered");
  const reordered = store.getState();
  assert.equal(reorder(store, fresh, 1, 3), "stale");
  assert.strictEqual(store.getState(), reordered);
});

test("drop maps the latest current index and random history, not the drag-start values", () => {
  const { store, queue } = setup();
  store.setState({ currentIndex: 3, currentSong: queue[3], position: 12, shuffleHistory: [2, 3], playedIndices: [2, 3] });
  assert.equal(reorder(store, queue, 0, 3), "reordered");
  const state = store.getState();
  assert.equal(state.currentIndex, 2);
  assert.strictEqual(state.currentSong, queue[3]);
  assert.equal(state.position, 12);
  assert.deepEqual(state.shuffleHistory, [1, 2]);
  assert.deepEqual(state.playedIndices, [1, 2]);
});

test("identical object references remain separate queue slots", () => {
  const { store } = setup();
  const duplicate = song("duplicate");
  const queue = [duplicate, song("B"), duplicate];
  store.getState().setQueue(queue, 2);
  assert.equal(reorder(store, store.getState().queue, 2, 0), "reordered");
  assert.equal(store.getState().currentIndex, 0);
  assert.deepEqual(store.getState().queue, [duplicate, duplicate, queue[1]]);
});

test("invalid indices and same-slot drops cause no state change", () => {
  const { store, queue } = setup();
  for (const [from, to] of [[-1, 0], [0, 4], [NaN, 1], [0, 0.5], [Infinity, 0]]) {
    const before = store.getState();
    assert.equal(reorder(store, queue, from, to), "invalid");
    assert.strictEqual(store.getState(), before);
  }
  const before = store.getState();
  assert.equal(reorder(store, queue, 1, 1), "unchanged");
  assert.strictEqual(store.getState(), before);
});

test("invalid history or divergent FM batch is rejected, not silently repaired", () => {
  const { store, queue } = setup();
  store.setState({ shuffleHistory: [99] });
  let before = store.getState();
  assert.equal(reorder(store, queue, 0, 2), "invalid");
  assert.strictEqual(store.getState(), before);
  store.setState({ shuffleHistory: [], playbackContext: { type: "personalFm", currentBatch: [song("other")], currentBatchIndex: 0, buffer: [], hasMore: false } });
  before = store.getState();
  assert.equal(reorder(store, queue, 0, 2), "invalid");
  assert.strictEqual(store.getState(), before);
});

const model = createLoader({})("src/services/queueReorderModel.ts");

test("drag geometry includes scroll distance, clamps both ends and opens a real insertion gap", () => {
  assert.equal(typeof model.getQueueDropIndex, "function");
  assert.equal(model.getQueueDropIndex(10, 32, 640, 704, 10000), 12);
  assert.equal(model.getQueueDropIndex(10, -10000, 640, 0, 10000), 0);
  assert.equal(model.getQueueDropIndex(10, 1000000, 640, 704, 10000), 9999);
  assert.equal(model.getQueueRowOffset(3, 1, 4), -64);
  assert.equal(model.getQueueRowOffset(1, 4, 0), 64);
  assert.equal(model.getQueueRowOffset(5, 1, 4), 0);
});

test("edge autoscroll continues without pointer movement and cannot overscroll", () => {
  assert.equal(typeof model.getQueueAutoScrollOffset, "function");
  const advance = model.getQueueAutoScrollOffset;
  assert.equal(advance(150, 300, 100, 640000, 16), 100);
  assert.ok(advance(295, 300, 100, 640000, 16) > 100);
  assert.ok(advance(5, 300, 100, 640000, 16) < 100);
  assert.equal(advance(0, 300, 0, 640000, 16), 0);
  assert.equal(advance(300, 300, 639700, 640000, 16), 639700);
  assert.equal(advance(300, 300, 0, 64, 16), 0);
  let offset = 0;
  for (let frame = 0; frame < 300; frame++) offset = advance(300, 300, offset, 640000, 16);
  assert.ok(offset > 3000);
});

test("occurrence keys remain distinct and stable for duplicate IDs and object references", () => {
  assert.equal(typeof model.buildQueueEntries, "function");
  const duplicate = song("A");
  const queue = [duplicate, song("A"), duplicate, song("B")];
  const entries = model.buildQueueEntries(queue);
  assert.equal(new Set(entries.map(entry => entry.key)).size, 4);
  const moved = model.moveQueueItem(entries, 2, 0);
  const rebuilt = model.buildQueueEntries(moved.map(entry => entry.song), moved);
  assert.deepEqual(rebuilt.map(entry => entry.key), moved.map(entry => entry.key));
  const added = model.buildQueueEntries([...queue, song("C")], entries);
  assert.deepEqual(added.slice(0, 4), entries);
  assert.equal(new Set(added.map(entry => entry.key)).size, 5);
});

test("cancel, unsuccessful finalize and late gesture IDs never invoke the store", () => {
  assert.equal(typeof model.createQueueDragSession, "function");
  const calls = [];
  const session = model.createQueueDragSession((...args) => { calls.push(args); return "reordered"; });
  const queue = [song("A"), song("B")];
  session.start(1, queue, 0);
  session.cancel();
  assert.equal(session.finish(1, 1, true), "cancelled");
  session.start(2, queue, 0);
  assert.equal(session.finish(2, 1, false), "cancelled");
  session.start(3, queue, 0);
  assert.equal(session.finish(2, 1, true), "cancelled");
  assert.deepEqual(calls, []);
  assert.equal(session.finish(3, 1, true), "reordered");
  assert.deepEqual(calls, [[queue, 0, 1]]);
  assert.equal(session.finish(3, 1, true), "cancelled");
});

test("queue replacement between long press and drop is rejected by the real store", () => {
  assert.equal(typeof model.createQueueDragSession, "function");
  const { store, queue } = setup();
  const session = model.createQueueDragSession(store.getState().reorderQueue);
  session.start(1, queue, 0);
  store.getState().setQueue([song("new")]);
  const before = store.getState();
  assert.equal(session.finish(1, 3, true), "stale");
  assert.strictEqual(store.getState(), before);
});

for (const context of ["queue", "personalFm", "heartbeat"]) {
  test("resetting " + context + " with the same array invalidates an in-flight drag", () => {
    const { store } = setup();
    const payload = { currentBatch: store.getState().queue, currentBatchIndex: 0, seedSongId: "seed", playlistId: "list" };
    const reset = () => {
      if (context === "queue") store.getState().setQueue(payload.currentBatch);
      else if (context === "personalFm") store.getState().setPersonalFmContext(payload);
      else store.getState().setHeartbeatContext(payload);
    };
    reset();
    const baseline = store.getState().queue;
    payload.currentBatch = baseline;
    reset();
    const afterReset = store.getState();
    assert.equal(reorder(store, baseline, 0, 2), "stale");
    assert.strictEqual(store.getState(), afterReset);
  });
}

test("ten-thousand-entry reorder preserves a permutation and occurrence keys", () => {
  const queue = Array.from({ length: 10000 }, (_, index) => song(String(index % 17)));
  const entries = model.buildQueueEntries(queue);
  const state = { queue, currentIndex: 8765, shuffleHistory: [0, 8765, 9999], playedIndices: [5, 8765], playbackContext: { type: "queue" } };
  for (const [from, to] of [[0, 9999], [9999, 0], [8765, 5000]]) {
    const result = model.reorderQueueState(state, queue, from, to);
    assert.equal(result.status, "reordered");
    assert.strictEqual(result.patch.queue[result.patch.currentIndex], queue[8765]);
    assert.equal(new Set(result.patch.queue).size, 10000);
    const nextEntries = model.moveQueueItem(entries, from, to);
    assert.equal(new Set(nextEntries.map(entry => entry.key)).size, 10000);
    assert.deepEqual(nextEntries.map(entry => entry.song), result.patch.queue);
  }
});

test("changed native modules compile with the installed Babel and worklet configuration", () => {
  const path = require("node:path");
  const { mobileRoot } = require("./helpers/loadTs.cjs");
  const babel = mobileRequire("@babel/core");
  for (const relativePath of ["src/components/QueueModal.tsx", "src/components/queue/DraggableQueueList.tsx", "src/services/queueReorderModel.ts", "src/stores/playerStore.ts"]) {
    const result = babel.transformFileSync(path.join(mobileRoot, relativePath), { cwd: mobileRoot, configFile: path.join(mobileRoot, "babel.config.js") });
    assert.ok(result.code.length > 0, relativePath);
    if (relativePath.endsWith("DraggableQueueList.tsx")) assert.match(result.code, /__workletHash/);
  }
});
const queuePresentation = createLoader({})("src/services/queueReorderModel.ts");
test("窄屏队列行先隐藏可选信息，更多按钮不与拖动把手重叠", () => {
  assert.equal(typeof queuePresentation.resolveQueueRowPresentation, "function");
  const narrow = queuePresentation.resolveQueueRowPresentation(320 - 24);
  assert.equal(narrow.showDuration, false);
  assert.equal(narrow.showCover, true);
  assert.equal(narrow.showLikeAction, true);
  for (const width of [228, 256, 296, 336, 396, 700]) {
    const presentation = queuePresentation.resolveQueueRowPresentation(width);
    const coverOrIndex = presentation.showCover ? 62 : 40;
    const actions = 36 + (presentation.showLikeAction ? 40 : 0) + (presentation.showDuration ? 46 : 0);
    assert.ok(4 + coverOrIndex + 96 + actions + queuePresentation.QUEUE_DRAG_HANDLE_WIDTH <= width,
      `队列可用宽度 ${width} 不足`);
  }
  assert.equal(queuePresentation.resolveQueueRowPresentation(396).showDuration, true);
});
