const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createLoader, mobileRoot } = require("./helpers/loadTs.cjs");

const modelPath = path.join(mobileRoot, "src/services/immersiveLayoutModel.ts");
const model = fs.existsSync(modelPath) ? createLoader({})(modelPath) : {};
const base = {
  width: 390, height: 844, fontScale: 1,
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};
function layout(overrides = {}) {
  return model.resolveImmersiveLayout({ ...base, ...overrides });
}
function cover(overrides = {}) {
  assert.equal(typeof model.resolveImmersiveCoverLayout, "function", "封面预算必须只来自媒体视口实测尺寸");
  return model.resolveImmersiveCoverLayout({ width: 390, height: 483, miniLyricHeight: 76, ...overrides });
}
function assertFits(result) {
  assert.ok(result.primaryWidth >= 0);
  if (result.mode === "split") {
    assert.ok(result.primaryWidth >= 304);
    assert.ok(result.lyricsWidth >= 280);
  }
  assert.ok(result.primaryWidth + result.lyricsWidth + result.columnGap + 2 * result.horizontalPadding <= result.safeWidth + 0.01);
}

test("手机竖屏保留 Pager 和迷你歌词", () => {
  assert.equal(layout().mode, "pager");
  assert.equal(layout().safeHeight, 763);
  assert.equal(cover().showMiniLyric, true);
});

test("宽横屏及竖屏平板按可用宽度并列封面与歌词", () => {
  for (const [width, height] of [[844, 390], [768, 1024], [1366, 1024]]) {
    const result = layout({ width, height, insets: { top: 0, bottom: 21, left: 24, right: 24 } });
    assert.equal(result.mode, "split");
    assertFits(result);
  }
});

test("安全区和字号共同决定断点", () => {
  assert.equal(layout({ width: 700 }).mode, "split");
  assert.equal(layout({ width: 700, fontScale: 2 }).mode, "pager");
  const result = layout({ width: 700, insets: { top: 0, bottom: 20, left: 48, right: 48 } });
  assert.equal(result.safeWidth, 604);
  assert.equal(result.mode, "pager");
});

test("封面与迷你歌词只占媒体视口，不挤占控制区或歌词页", () => {
  const normal = cover();
  const short = cover({ height: 110 });
  assert.equal(short.showMiniLyric, false);
  assert.ok(short.coverSize < normal.coverSize);
  assert.equal(cover({ miniLyricHeight: 0 }).showMiniLyric, false);
  assert.ok(cover({ miniLyricHeight: 200 }).coverSize < normal.coverSize);
  for (const height of [0, 40, 96, 140, 280, 483]) {
    const result = cover({ height });
    assert.ok(result.coverSize >= 0);
    assert.ok(result.coverSize + result.coverBottomSpace <= height);
  }
});

test("恢复时窗口和安全区重排不覆盖已测媒体预算", () => {
  const before = cover();
  for (const overrides of [
    { height: 0 }, { width: 844, height: 390 },
    { insets: { top: 0, bottom: 0, left: 0, right: 0 } }, {},
  ]) {
    assertFits(layout(overrides));
    assert.deepEqual(cover(), before);
  }
});

test("尺寸矩阵满足安全区和封面各自预算", () => {
  for (const width of [0, 280, 320, 390, 568, 640, 663, 664, 768, 1024, 1366]) {
    for (const height of [0, 180, 250, 320, 390, 600, 844, 1024]) {
      for (const fontScale of [1, 1.5, 2, 3]) {
        const result = layout({ width, height, fontScale });
        assertFits(result);
        if (result.mode === "split") assert.ok(result.lyricsWidth >= Math.max(280, 200 * fontScale));
        const media = cover({ width: result.primaryWidth, height, miniLyricHeight: 76 * fontScale });
        assert.ok(media.coverSize <= result.primaryWidth);
        assert.ok(media.coverSize + media.coverBottomSpace <= height);
      }
    }
  }
});

test("非法布局输入显式报错", () => {
  for (const overrides of [{ width: NaN }, { height: -1 }, { fontScale: 0 }, { insets: { top: 0, bottom: 0, left: -1, right: 0 } }]) {
    assert.throws(() => layout(overrides), RangeError);
  }
  for (const overrides of [{ width: NaN }, { height: -1 }, { miniLyricHeight: Infinity }]) {
    assert.throws(() => cover(overrides), RangeError);
  }
});

// 仅执行 JSX 渲染契约；不模拟 Yoga、原生滚动或动画，真机验证仍需单独执行。
function renderScreen({ width = 390, height = 844, currentPage = 0, overlay = {} } = {}) {
  const { mobileRequire } = require("./helpers/loadTs.cjs");
  const ts = mobileRequire("typescript");
  const React = mobileRequire("react");
  const slots = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef: (current) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current };
      return slots[index];
    },
    useMemo: (build) => build(),
    useCallback: (callback) => callback,
    useEffect: () => {},
  };
  const gesture = { enabled: (enabled) => { gesture.isEnabled = enabled; return gesture; } };
  for (const name of ["maxPointers", "activeOffsetY", "failOffsetX", "onUpdate", "onEnd", "onFinalize"]) gesture[name] = () => gesture;
  const entering = (kind) => {
    const animation = { kind, duration: () => animation, delay: () => animation };
    return animation;
  };
  const controller = {
    insets: { top: 20, bottom: 20, left: 12, right: 12 },
    currentSong: { id: "1", name: "Song", singer: "Artist", source: "wy" },
    currentPage, isLyricsPage: currentPage === 1,
    palette: { background: "#000000" },
    sleepTimerControl: {}, currentSongActions: {}, queueModel: {},
    ...overlay,
  };
  const modules = {
    react: { __esModule: true, default: hooks },
    "react-native": {
      View: "View", ScrollView: "ScrollView", StatusBar: "StatusBar", Modal: "Modal", Pressable: "Pressable", Text: "Text",
      StyleSheet: { create: (styles) => styles }, useWindowDimensions: () => ({ width, height, fontScale: 1 }),
    },
    "react-native-gesture-handler": { Gesture: { Pan: () => gesture }, GestureDetector: "GestureDetector", GestureHandlerRootView: "GestureHandlerRootView" },
    "react-native-reanimated": {
      __esModule: true, default: { View: "Animated.View" },
      FadeIn: entering("FadeIn"), FadeInDown: entering("FadeInDown"), FadeInUp: entering("FadeInUp"),
      useSharedValue: (value) => ({ value }), useAnimatedStyle: (build) => build(),
    },
    "react-native-pager-view": { __esModule: true, default: "PagerView" },
    "react-native-keep-awake": { __esModule: true, default: "KeepAwake" },
    "@/screens/immersive/useImmersiveController": { useImmersiveController: () => controller },
    "@/screens/immersive/immersiveStyles": createLoader({
      "react-native": { StyleSheet: { create: (styles) => styles }, Platform: { OS: "android", select: (options) => options.android ?? options.default } },
    })("src/screens/immersive/immersiveStyles.ts"),
    "@/screens/immersive/immersiveFlySource": { getImmersiveFlySource: () => null },
    "@/services/immersiveLayoutModel": model,
    "@/stores/themeStore": { useThemeStore: (select) => select({}), getResolvedTheme: () => "dark" },
    "@/stores/lyricSettingsStore": { useLyricSettingsStore: (select) => select({ fontSize: 22, showLyricProgress: true }) },
  };
  const source = fs.readFileSync(path.join(mobileRoot, "src/screens/ImmersiveLyricsScreen.tsx"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (Object.hasOwn(modules, name)) return modules[name];
    const components = [
      "@/components/LyricView", "@/components/AddToLocalPlaylistModal", "@/components/CachedImage",
      "@/components/MiniLyric", "@/components/DownloadQualityModal",
      "@/screens/immersive/ImmersiveTopBar", "@/screens/immersive/ImmersiveTransport",
      "@/screens/immersive/ImmersiveCommentsSheet", "@/screens/immersive/ImmersiveModals",
      "@/screens/immersive/ImmersivePlaySettingSheet", "@/screens/immersive/ImmersiveCoverPage",
      "react-native-linear-gradient",
    ];
    if (components.includes(name)) {
      const component = name.split("/").at(-1);
      return { __esModule: true, default: component, [component]: component };
    }
    // 本测试不执行图片解码、取色、导航及用户动作，不能冒充其运行时验证。
    if (["@lx/core", "@/services/coverColorService", "@/services/themePaletteModel", "@/navigation"].includes(name)) return {};
    throw new Error("Unmocked screen dependency: " + name);
  }, loaded, loaded.exports);
  const result = { gesture, tree: null, rerender: (changes = {}) => {
    width = changes.width ?? width;
    height = changes.height ?? height;
    if (changes.insets) controller.insets = changes.insets;
    cursor = 0;
    result.tree = loaded.exports.ImmersiveLyricsScreen({ visible: true, onClose() {} });
    return result;
  } };
  return result.rerender();
}
function descendants(node, type) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child, type));
  return [...(node.type === type ? [node] : []), ...descendants(node.props?.children, type)];
}

test("渲染契约：竖屏保留两个原生 Pager 页面，宽屏同屏展示歌词且只有一套控制", () => {
  const portrait = renderScreen();
  const pager = descendants(portrait.tree, "PagerView");
  assert.equal(pager.length, 1);
  assert.equal(pager[0].props.children.length, 2);
  for (const page of pager[0].props.children) assert.equal(page.props.collapsable, false);
  const wide = renderScreen({ width: 844, height: 390 });
  assert.equal(descendants(wide.tree, "PagerView").length, 0);
  for (const { tree } of [portrait, wide]) {
    assert.equal(descendants(tree, "ImmersiveTransport").length, 1);
    assert.equal(descendants(tree, "ImmersiveCoverPage").length, 1);
    assert.equal(descendants(tree, "LyricView").length, 1);
    const detector = descendants(tree, "GestureDetector");
    assert.equal(detector.length, 1);
    assert.equal(descendants(detector[0], "LyricView").length, 0);
    assert.equal(descendants(detector[0], "ImmersiveTransport").length, 0);
  }
  assert.equal(descendants(portrait.tree, "KeepAwake").length, 0);
  assert.equal(descendants(wide.tree, "KeepAwake").length, 1);
});

test("渲染契约：弹层打开及竖屏歌词页停用下拉，宽屏歌词不阻断封面下拉", () => {
  assert.equal(renderScreen().gesture.isEnabled, true);
  assert.equal(renderScreen({ currentPage: 1 }).gesture.isEnabled, false);
  assert.equal(renderScreen({ width: 844, height: 390, currentPage: 1 }).gesture.isEnabled, true);
  for (const modal of ["queueModalVisible", "commentsVisible", "playSettingVisible", "sleepModalVisible", "rateModalVisible", "volumeModalVisible", "addToPlaylistVisible", "coverMenuVisible", "coverSongDownloadVisible"]) {
    assert.equal(renderScreen({ overlay: { [modal]: true } }).gesture.isEnabled, false, modal);
  }
});

function flattenStyle(style) {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style || {};
}
function ancestors(node, type, parents = []) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => ancestors(child, type, parents));
  if (node.type === type) return [parents];
  return ancestors(node.props?.children, type, [...parents, node]);
}

test("恢复布局契约：控制栏按固有高度贴底，不把测量值写回父级固定高度", () => {
  const { tree } = renderScreen();
  const parents = ancestors(tree, "ImmersiveTransport")[0];
  for (const parent of parents) {
    assert.equal(flattenStyle(parent.props.style).height, undefined, "控制区祖先不能依赖上一帧高度");
  }
  const transportHost = parents.at(-1);
  assert.equal(transportHost.props.onLayout, undefined, "不能将控制区的布局结果再写回控制区视口");
});

test("Pager 原生页面必须显式铺满，不依赖无效的 flex 子页尺寸", () => {
  const [pager] = descendants(renderScreen().tree, "PagerView");
  for (const page of pager.props.children) {
    assert.equal(flattenStyle(page.props.style).width, "100%");
    assert.equal(flattenStyle(page.props.style).height, "100%");
  }
});

test("标题和控制区只设高度上限，内容超高时原生滚动且不自动补安全区", () => {
  const { tree } = renderScreen();
  for (const type of ["ImmersiveTopBar", "ImmersiveTransport"]) {
    const scroll = ancestors(tree, type)[0].findLast((node) => node.type === "ScrollView");
    assert.equal(flattenStyle(scroll.props.style).height, undefined);
    assert.equal(flattenStyle(scroll.props.style).maxHeight, type === "ImmersiveTopBar" ? "30%" : "70%");
    assert.notEqual(scroll.props.scrollEnabled, false);
    assert.equal(scroll.props.contentInsetAdjustmentBehavior, "never");
    assert.equal(scroll.props.automaticallyAdjustContentInsets, false);
    assert.equal(scroll.props.bounces, false);
  }
});

function emitLayout(node, width, height) {
  assert.equal(typeof node.props.onLayout, "function");
  node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
}

test("恢复事件序列：根尺寸和媒体尺寸乱序到达，控制区不缓存像素高度", () => {
  const screen = renderScreen();
  const getMedia = () => ancestors(screen.tree, "PagerView")[0].at(-1);
  const getRoot = () => ancestors(screen.tree, "ImmersiveTransport")[0].find((node) => node.type === "Animated.View" && node.props.onLayout);
  emitLayout(getMedia(), 366, 500);
  screen.rerender();
  const before = descendants(screen.tree, "ImmersiveCoverPage")[0].props.coverSize;
  for (const height of [0, 400, 844, 780, 844]) {
    emitLayout(getRoot(), 390, height);
    screen.rerender({ height: 400 });
    assert.equal(descendants(screen.tree, "ImmersiveCoverPage")[0].props.coverSize, before);
    for (const parent of ancestors(screen.tree, "ImmersiveTransport")[0]) {
      assert.equal(flattenStyle(parent.props.style).height, undefined);
    }
  }
  emitLayout(getMedia(), 366, 120);
  screen.rerender({ height: 844, insets: { top: 47, bottom: 34, left: 0, right: 0 } });
  assert.ok(descendants(screen.tree, "ImmersiveCoverPage")[0].props.coverSize <= 120);
  emitLayout(getMedia(), 366, 500);
  screen.rerender();
  assert.equal(descendants(screen.tree, "ImmersiveCoverPage")[0].props.coverSize, before);
});

test("控制区入场只淡入，不遗留独立于恢复逻辑的向上位移", () => {
  const host = ancestors(renderScreen().tree, "ImmersiveTransport")[0].at(-1);
  assert.equal(host.props.entering.kind, "FadeIn");
});
