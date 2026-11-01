const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

const song = (id) => ({ id, source: "tx", name: id, singer: "Test", interval: 100 });
const ids = (list) => list.map((item) => item.id).join(",");

// 「下一首播放」必须在主队列里当场生效：此前只写 tempPlayList 暂存区，队列面板
// 看不到任何东西，直到播到它才突然出现（用户可见的症状即由此而来）。
function setup({ queue = [], currentIndex = -1, shuffleHistory = [], playedIndices = [] } = {}) {
  const played = [];
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "react-native-track-player": {
      __esModule: true,
      default: new Proxy({}, { get: () => () => {} }),
      State: {}, RepeatMode: {}, Event: {}, AppKilledPlaybackBehavior: {}, Capability: {},
    },
    "@lx/core": { isPreviewDuration: () => false },
    "@/services/androidPitchService": {},
    "@/services/playbackUrlCache": {},
    "@/services/playbackFailurePolicy": {},
    "@/services/logger": { logger: { warn() {}, info() {} } },
    "../services/playerService": { playFromQueue: async (index) => { played.push(index); } },
    "@/services/lyricOverlayService": {},
    "@/services/listenTrackerService": {},
  });
  const store = load("src/stores/playerStore.ts").usePlayerStore;
  store.setState({ queue: [...queue], currentIndex, shuffleHistory, playedIndices, tempPlayList: [] });
  return { store, played };
}

test("插入到当前曲之后，并且不写暂存区", () => {
  const { store } = setup({ queue: [song("A"), song("B"), song("C")], currentIndex: 0 });

  store.getState().playNextInQueue(song("X"));

  const state = store.getState();
  assert.equal(ids(state.queue), "A,X,B,C", "X 必须立刻出现在主队列当前曲之后");
  assert.equal(state.currentIndex, 0, "插入不应改变当前播放位置");
  assert.deepEqual(state.tempPlayList, [], "不应再写独立暂存区（那正是队列里看不到的原因）");
  assert.equal(state.pinnedNextSong?.id, "X", "随机 / FM 下要靠锚点保证下一个播它");
});

test("插入点之后的随机历史与已播集合整体加一", () => {
  const { store } = setup({
    queue: [song("A"), song("B"), song("C")],
    currentIndex: 0,
    shuffleHistory: [0, 1, 2],
    playedIndices: [0, 2],
  });

  store.getState().playNextInQueue(song("X"));

  const state = store.getState();
  assert.deepEqual(state.shuffleHistory, [0, 2, 3], "插入点及之后的索引必须平移，否则 prev() 会回到错曲");
  assert.deepEqual(state.playedIndices, [0, 3], "已播集合同样要平移");
});

test("连点两首时后点的先播，队列顺序与锚点同步", () => {
  const { store } = setup({ queue: [song("A"), song("B")], currentIndex: 0 });

  store.getState().playNextInQueue(song("X"));
  store.getState().playNextInQueue(song("Y"));

  const state = store.getState();
  assert.equal(ids(state.queue), "A,Y,X,B", "后点的歌排在更靠前的插入位");
  assert.equal(state.pinnedNextSong?.id, "Y", "锚点指向最后一次点击的歌");
});

test("空队列插入后立即开播，避免只改队列不出声", async () => {
  const { store, played } = setup();

  store.getState().playNextInQueue(song("X"));
  await new Promise((resolve) => setImmediate(resolve));

  const state = store.getState();
  assert.equal(ids(state.queue), "X");
  assert.equal(state.currentIndex, 0);
  assert.equal(state.pinnedNextSong, null, "已经直接开播了，不该再留锚点让下一首重播它");
  assert.deepEqual(played, [0], "空队列场景应直接播放这一首");
});
