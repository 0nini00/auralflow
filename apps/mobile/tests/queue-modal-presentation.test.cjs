const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const test = require("node:test");
const { createLoader, mobileRoot, mobileRequire } = require("./helpers/loadTs.cjs");

const desktopRequire = createRequire(path.resolve(mobileRoot, "../../desktop/package.json"));
const React = desktopRequire("react");
const { act, create } = desktopRequire("react-test-renderer");
const ts = mobileRequire("typescript");

const queueReorderModel = createLoader({})("src/services/queueReorderModel.ts");
const palette = createLoader({})("src/services/themePaletteModel.ts").buildThemePalette("dark");
const { sheet } = createLoader({})("src/theme/sheetTokens.ts");
const tokens = createLoader({})("src/theme/tokens.ts");

const songA = { source: "wy", id: "a", name: "甲", singer: "歌手" };
const songB = { source: "wy", id: "b", name: "乙", singer: "歌手" };

/** 渲染 QueueModal 一次：沉浸屏调用方现在不传任何形态参数，默认形态即契约。 */
function renderQueueModal(t, { bottomInset = 0, windowHeight = 844, queue = [songA, songB] } = {}) {
  const events = [];
  const BottomSheet = props => React.createElement(
    "BottomSheet",
    { visible: props.visible, maxHeightRatio: props.maxHeightRatio },
    props.visible ? props.children : null,
  );
  const DraggableQueueList = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ cancelDrag: () => events.push("cancelDrag") }));
    return React.createElement("DraggableQueueList", { height: props.height });
  });
  const mocks = {
    react: React,
    "react-native": {
      Alert: { alert: () => undefined },
      Pressable: "Pressable",
      Text: "Text",
      View: "View",
      StyleSheet: { create: value => value, hairlineWidth: 1 },
      useWindowDimensions: () => ({ width: 390, height: windowHeight }),
    },
    "lucide-react-native": { X: "X" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: bottomInset, left: 0 }) },
    "react-native-gesture-handler": { GestureHandlerRootView: "GestureHandlerRootView" },
    "@/services/queueReorderModel": queueReorderModel,
    "@/services/songListMetadataModel": { shouldPromptDownloadQuality: () => true, shouldShowSongListDownloadAction: () => true },
    "@/stores/playerStore": { usePlayerStore: selector => selector({ currentSong: songA, currentIndex: 0 }) },
    "@/stores/downloadStore": { useDownloadStore: selector => selector({ downloadSong: async () => ({ status: "completed" }) }) },
    "@/services/downloadService": { getLastSelectQuality: async () => null, saveLastSelectQuality: async () => undefined },
    "@/services/shareMusicService": { shareMusic: async () => undefined },
    "@/navigation/navigationRef": { openMvPlayerScreen: () => undefined },
    "@/components/queue/DraggableQueueList": { DraggableQueueList },
    "@/components/ActionMenuSheet": { ActionMenuSheet: "ActionMenuSheet" },
    "@/components/AddToLocalPlaylistModal": { AddToLocalPlaylistModal: "AddToLocalPlaylistModal" },
    "@/components/DownloadQualityModal": { DownloadQualityModal: "DownloadQualityModal" },
    "@/components/BottomSheet": { BottomSheet },
    "@/components/Touchable": { Touchable: "Touchable" },
    "@/theme/sheetTokens": { sheet },
    "@/utils/modalSequence": { afterModalDismiss: action => action() },
    "@/theme/tokens": tokens,
  };
  const props = {
    visible: true,
    queueModel: {
      show: true, triggerLabel: "播放队列", title: "播放队列", closeLabel: "关闭",
      summary: "共 2 首",
      items: [
        { key: "wy:a:0", index: 0, title: "甲", subtitle: "歌手", isCurrent: true },
        { key: "wy:b:1", index: 1, title: "乙", subtitle: "歌手", isCurrent: false },
      ],
      management: { canClearQueue: true, clearLabel: "清空队列" },
    },
    queue,
    palette,
    onClose: () => events.push("close"),
    onPlayItem: index => events.push(["play", index]),
    onRemoveItem: index => events.push(["remove", index]),
    onClear: () => events.push("clear"),
    onRequestNavigate: () => events.push("navigate"),
  };
  const source = fs.readFileSync(path.join(mobileRoot, "src/components/QueueModal.tsx"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    fileName: "QueueModal.tsx",
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(mocks, name), `未声明的依赖：${name}`);
    return mocks[name];
  }, module, module.exports);
  let renderer;
  act(() => { renderer = create(React.createElement(module.exports.QueueModal, props)); });
  t.after(() => act(() => renderer.unmount()));
  const touchable = label => renderer.root.findAll(
    node => node.type === "Touchable" && node.props.accessibilityLabel === label,
  )[0];
  return { renderer, events, touchable };
}

test("队列面板默认即以应用内弹层呈现，不经过 RN Modal", t => {
  const h = renderQueueModal(t);
  // 唯一的调用方（沉浸屏）不传形态参数：默认不能再落进 RN Modal 分支
  assert.equal(h.renderer.root.findAll(node => node.type === "Modal").length, 0);
  assert.equal(h.renderer.root.findAll(node => node.type === "BottomSheet").length, 1);
  const rendered = JSON.stringify(h.renderer.toJSON());
  assert.match(rendered, /播放队列/);
  assert.match(rendered, /共 2 首/);
  assert.match(rendered, /长按拖动排序/);
  assert.match(rendered, /清空队列/);
});

test("弹层头部的关闭与清空仍先取消拖动再走原回调", t => {
  const h = renderQueueModal(t);
  act(() => h.touchable("清空队列").props.onPress());
  act(() => h.touchable("关闭").props.onPress());
  assert.deepEqual(h.events, ["cancelDrag", "clear", "cancelDrag", "close"]);
});

test("长队列为底部安全区留出空间，短队列仍按歌曲数量收起", t => {
  const queue = Array.from({ length: 20 }, () => songA);
  const regular = renderQueueModal(t, { queue });
  const inset = renderQueueModal(t, { queue, bottomInset: 48 });
  const short = renderQueueModal(t, { bottomInset: 48 });
  const compact = renderQueueModal(t, { queue, bottomInset: 48, windowHeight: 320 });
  const height = h => h.renderer.root.findByType("DraggableQueueList").props.height;
  assert.equal(height(regular) - height(inset), 48 - tokens.spacing.m);
  assert.equal(height(short), 2 * queueReorderModel.QUEUE_ROW_HEIGHT);
  assert.ok(height(inset) > queueReorderModel.QUEUE_ROW_HEIGHT);
  assert.ok(height(compact) > 0 && height(compact) < queueReorderModel.QUEUE_ROW_HEIGHT,
    "短视口应允许不足一整行的列表高度，避免挤掉排序提示和安全区");
});
