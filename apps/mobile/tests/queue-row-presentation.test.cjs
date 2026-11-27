const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

const React = mobileRequire("react");
const { act, create } = mobileRequire("react-test-renderer");
const { buildThemePalette, withAlpha } = createLoader({})("src/services/themePaletteModel.ts");
const { QUEUE_ROW_HEIGHT } = createLoader({})("src/services/queueReorderModel.ts");

global.IS_REACT_ACT_ENVIRONMENT = true;

const queue = [
  { source: "wy", id: "a", name: "胆小鬼", singer: "梁咏琪" },
  { source: "wy", id: "b", name: "不要在我寂寞的时候说爱我", singer: "歌手" },
];

function flatten(style) {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

function renderQueue(t, palette) {
  const events = [];
  const gesture = {};
  for (const name of ["enabled", "activateAfterLongPress", "maxPointers", "blocksExternalGesture", "onStart", "onUpdate", "onFinalize"]) {
    gesture[name] = () => gesture;
  }
  const FlatList = React.forwardRef(({ data, renderItem, ...props }, ref) =>
    React.createElement("FlatList", { ...props, ref }, data.map((item, index) =>
      React.createElement(React.Fragment, { key: item.key }, renderItem({ item, index })))),
  );
  const load = createLoader({
    react: React,
    "react-native": {
      AccessibilityInfo: { announceForAccessibility() {} },
      Alert: { alert() {} },
      AppState: { addEventListener: () => ({ remove() {} }) },
      FlatList,
      StyleSheet: { create: value => value, hairlineWidth: 1 },
      Text: "Text",
      View: "View",
    },
    "react-native-gesture-handler": {
      Gesture: { Native: () => ({}), Pan: () => gesture },
      GestureDetector: "GestureDetector",
    },
    "react-native-reanimated": {
      __esModule: true,
      default: { View: "AnimatedView", FlatList },
      runOnJS: callback => callback,
      scrollTo() {},
      useAnimatedRef: () => React.useRef(null),
      useAnimatedScrollHandler: callback => callback,
      useAnimatedStyle: callback => callback(),
      useFrameCallback() {},
      useSharedValue: value => React.useRef({ value }).current,
      withTiming: value => value,
    },
    "lucide-react-native": { Trash2: "Trash2", X: "X", GripVertical: "GripVertical" },
    "@/stores/playerStore": { usePlayerStore: { getState: () => ({ queue }) } },
    "@/components/SongList": { SongItem: "SongItem" },
    "@/components/Touchable": { Touchable: "Touchable" },
    "@/services/hapticService": { hapticLight() {} },
  });
  const { DraggableQueueList } = load("src/components/queue/DraggableQueueList.tsx");
  const props = {
    queue, currentIndex: 0, palette, height: QUEUE_ROW_HEIGHT * 2, enabled: true,
    onPlayItem: index => events.push(["play", index]),
    onRemoveItem: index => events.push(["remove", index]),
  };
  let renderer;
  act(() => { renderer = create(React.createElement(DraggableQueueList, props)); });
  t.after(() => act(() => renderer.unmount()));
  return {
    renderer,
    events,
    update(patch) {
      Object.assign(props, patch);
      act(() => renderer.update(React.createElement(DraggableQueueList, props)));
    },
    songs: () => renderer.root.findAllByType("SongItem"),
  };
}

test("当前歌曲高亮随自定义强调色、明暗主题和播放位置更新", t => {
  const h = renderQueue(t, buildThemePalette("light", "#397fb8"));
  for (const [theme, accentColor] of [["light", "#397fb8"], ["dark", "#d477a0"]]) {
    const palette = buildThemePalette(theme, accentColor);
    h.update({ palette, currentIndex: 0 });
    let [current, next] = h.songs();
    assert.equal(flatten(current.parent.parent.props.style).backgroundColor, withAlpha(palette.primaryInk, 0.08));
    assert.equal(flatten(next.parent.parent.props.style).backgroundColor, "transparent");
    assert.equal(current.props.showIndexColumn, true);
    assert.equal(current.props.hideMeta, false);
    assert.equal(next.props.hideMeta, true);

    h.update({ currentIndex: 1 });
    [current, next] = h.songs();
    assert.equal(flatten(current.parent.parent.props.style).backgroundColor, "transparent");
    assert.equal(flatten(next.parent.parent.props.style).backgroundColor, withAlpha(palette.primaryInk, 0.08));
  }
});

test("队列行仍按原索引播放、移除，视觉调整保持固定拖动行高", t => {
  const h = renderQueue(t, buildThemePalette("light"));
  const songs = h.songs();
  act(() => songs[1].props.onRowPress(queue[1], 1));
  const remove = h.renderer.root.findAll(node => node.type === "Touchable" && node.props.accessibilityLabel === "从队列移除");
  act(() => remove[0].props.onPress());
  act(() => remove[1].props.onPress());
  assert.deepEqual(h.events, [["play", 1], ["remove", 0], ["remove", 1]]);
  const list = h.renderer.root.findByType("FlatList");
  for (let index = 0; index < queue.length; index++) {
    const rowStyle = flatten(songs[index].parent.parent.props.style);
    assert.equal(rowStyle.height, QUEUE_ROW_HEIGHT);
    assert.deepEqual(list.props.getItemLayout(null, index), {
      length: QUEUE_ROW_HEIGHT, offset: index * QUEUE_ROW_HEIGHT, index,
    });
  }
});
