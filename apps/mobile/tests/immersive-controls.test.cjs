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
const { buildThemePalette } = createLoader({})("src/services/themePaletteModel.ts");
const transpiled = new Map();
const palette = {
  text: "#ffffff", textMuted: "#aaaaaa", textSubtle: "#999999", surface: "#202020",
  surfaceMuted: "#303030", primaryInk: "#44cc88", primaryText: "#ffffff",
  actionFill: "#229955", onActionFill: "#ffffff", border: "#444444",
};

function flattenStyle(style) {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style || {};
}

function harness(t, componentName, props, options = {}) {
  const events = [];
  const native = {
    ...Object.fromEntries(["ActivityIndicator", "Modal", "Pressable", "ScrollView", "Text", "View"].map(name => [name, name])),
    StyleSheet: { create: value => value, flatten: flattenStyle, absoluteFill: {}, hairlineWidth: 1 },
    Platform: { OS: "android", select: value => value.android ?? value.default },
    useWindowDimensions: () => ({ width: 320, height: 640 }),
    Animated: {
      Value: class { constructor(value) { this.value = value; } },
      View: "Animated.View",
      timing: (value, options) => ({ start: callback => { value.value = options.toValue; callback?.(); } }),
    },
  };
  const mocks = {
    react: React,
    "react-native": native,
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24, bottom: 16 }) },
    "lucide-react-native": Object.fromEntries([
      "ArrowRight", "Captions", "ChevronDown", "Download", "FolderPlus", "Heart", "Image", "ImageIcon",
      "ListMusic", "MessageCircle", "MoreHorizontal", "Palette", "Pause", "Play", "Repeat", "Repeat1",
      "Share2", "Shuffle", "SkipBack", "SkipForward", "SlidersHorizontal", "Sparkles", "Timer", "Video", "X",
    ].map(name => [name, name])),
    "@/components/Touchable": { Touchable: "Touchable" },
    "@/components/ProgressBar": { ProgressBar: "ProgressBar" },
    "@/screens/immersive/Marquee": { Marquee: "Marquee" },
    "@/stores/themeStore": {
      useThemeStore: selector => selector({ mode: options.globalTheme ?? "dark", systemTheme: "dark", accentColor: "#229955" }),
      getResolvedTheme: (mode, systemTheme) => mode === "system" ? systemTheme : mode,
      getThemePalette: buildThemePalette,
    },
    "@/stores/playerStore": { usePlayerStore: selector => selector({ position: 12, duration: 180, buffered: 90 }) },
    "@/services/playerService": { formatTime: value => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}` },
    "@/services/hapticService": { hapticLight: () => events.push("haptic") },
  };
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const source = fs.readFileSync(filename, "utf8");
    let cached = transpiled.get(filename);
    if (!cached || cached.source !== source) {
      cached = { source, code: ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
        fileName: filename,
      }).outputText };
      transpiled.set(filename, cached);
    }
    const module = { exports: {} };
    modules.set(filename, module);
    const requireModule = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      const target = name.startsWith("@/")
        ? path.join(mobileRoot, "src", name.slice(2))
        : name.startsWith(".") ? path.resolve(path.dirname(filename), name) : null;
      assert.ok(target, `未声明的宿主边界：${name}`);
      const dependency = [target + ".ts", target + ".tsx"].find(candidate => fs.existsSync(candidate));
      assert.ok(dependency, `找不到源码模块：${name}`);
      return load(dependency);
    };
    new Function("require", "module", "exports", cached.code)(requireModule, module, module.exports);
    return module.exports;
  }
  const Component = load(path.join(mobileRoot, "src/screens/immersive", `${componentName}.tsx`))[componentName];
  let currentProps = { palette, ...props };
  let renderer;
  act(() => { renderer = create(React.createElement(Component, currentProps)); });
  t.after(() => act(() => renderer.unmount()));
  return {
    renderer, events,
    update(patch) {
      currentProps = { ...currentProps, ...patch };
      act(() => renderer.update(React.createElement(Component, currentProps)));
    },
    button(label) {
      return renderer.root.findAll(node => ["Pressable", "Touchable"].includes(node.type) && node.props.accessibilityLabel === label)[0];
    },
    click(label) {
      const button = this.button(label);
      assert.ok(button, `可访问按钮必须存在：${label}`);
      act(() => button.props.onPress());
    },
  };
}

const transportProps = events => ({
  insetsBottom: 16, compact: false, onSeek: value => events.push(["seek", value]),
  playMode: "list", playModeControl: { label: "列表循环", active: false },
  onTogglePlayMode: () => events.push("mode"), onPrevious: () => events.push("previous"),
  onNext: () => events.push("next"), onTogglePlay: () => events.push("play"),
  isPlaying: false, loading: false, onOpenQueue: () => events.push("queue"), queueLabel: "播放队列，共 12 首",
});

test("顶部只保留关闭与更多按钮，歌名歌手和歌手点击保持原样", t => {
  const calls = [];
  const h = harness(t, "ImmersiveTopBar", {
    insetsTop: 24, songName: "原有歌曲名", artist: "原有歌手", onClose: () => calls.push("close"),
    onPressArtist: () => calls.push("artist"), onOpenMore: () => calls.push("more"), moreMenuVisible: false,
  });
  const labels = h.renderer.root.findAllByType("Pressable").map(button => button.props.accessibilityLabel);
  assert.deepEqual(labels, ["关闭播放器", "查看歌手 原有歌手", "更多选项"]);
  assert.equal(h.renderer.root.findAllByType("MoreHorizontal").length, 1);
  assert.equal(h.renderer.root.findAllByType("Timer").length, 0);
  assert.equal(h.renderer.root.findAllByType("SlidersHorizontal").length, 0);
  assert.match(JSON.stringify(h.renderer.toJSON()), /原有歌曲名/);
  assert.match(JSON.stringify(h.renderer.toJSON()), /原有歌手/);
  h.click("关闭播放器"); h.click("查看歌手 原有歌手"); h.click("更多选项");
  assert.deepEqual(calls, ["close", "artist", "more"]);
  assert.equal(h.button("更多选项").props.accessibilityState.expanded, false);
  h.update({ moreMenuVisible: true });
  assert.equal(h.button("更多选项").props.accessibilityState.expanded, true);
});

test("全局浅色主题下，顶部关闭与更多图标仍使用深色播放器文字色", t => {
  const darkPalette = buildThemePalette("dark");
  const h = harness(t, "ImmersiveTopBar", {
    palette: darkPalette, insetsTop: 24, songName: "歌曲", artist: "歌手",
    onClose() {}, onOpenMore() {},
  }, { globalTheme: "light" });
  for (const name of ["ChevronDown", "MoreHorizontal"]) {
    assert.equal(h.renderer.root.findByType(name).props.color, darkPalette.text, name);
  }
});

test("全局浅色主题下，底栏图标和加载状态服从播放器配色", t => {
  const darkPalette = buildThemePalette("dark");
  const h = harness(t, "ImmersiveTransport", {
    ...transportProps([]), palette: darkPalette,
  }, { globalTheme: "light" });
  for (const name of ["Repeat", "SkipBack", "SkipForward", "ListMusic"]) {
    assert.equal(h.renderer.root.findByType(name).props.color, darkPalette.text, name);
  }
  assert.equal(h.renderer.root.findByType("Play").props.color, darkPalette.onActionFill);
  h.update({ isPlaying: true, playModeControl: { label: "随机播放", active: true }, playMode: "shuffle" });
  assert.equal(h.renderer.root.findByType("Shuffle").props.color, darkPalette.primaryInk);
  assert.equal(h.renderer.root.findByType("Pause").props.color, darkPalette.onActionFill);
  h.update({ loading: true });
  assert.deepEqual(h.renderer.root.findAllByType("ActivityIndicator").map(node => node.props.color), [
    darkPalette.text, darkPalette.onActionFill, darkPalette.text,
  ]);
});

for (const compact of [false, true]) {
  test(`底栏是单行五键，在320宽度内保持最小触控尺寸，compact=${compact}`, t => {
    const h = harness(t, "ImmersiveTransport", { ...transportProps([]), compact });
    const buttons = h.renderer.root.findAllByType("Pressable");
    assert.deepEqual(buttons.map(button => button.props.accessibilityLabel), ["播放模式：列表循环", "上一首", "播放", "下一首", "播放队列，共 12 首"]);
    assert.equal(h.renderer.root.findAllByType("Modal").length, 0);
    const widths = buttons.map(button => flattenStyle(button.props.style({ pressed: false })).width);
    assert.deepEqual(widths, [44, 48, 66, 48, 44]);
    const row = h.renderer.root.findAllByType("View").find(view =>
      view.children.filter(child => typeof child !== "string").length === 5
      && view.findAllByType("Pressable").length === 5);
    assert.ok(row, "五个按钮必须同属一个控制行");
    const style = flattenStyle(row.props.style);
    assert.equal(style.flexDirection, "row");
    assert.equal(style.flexWrap, "nowrap");
    const rootStyle = flattenStyle(h.renderer.root.findAllByType("View")[0].props.style);
    assert.ok(widths.reduce((sum, width) => sum + width, 0) + (style.gap ?? 0) * 4 <= 320 - rootStyle.paddingHorizontal * 2);
    assert.ok(buttons.every(button => flattenStyle(button.props.style({ pressed: false })).height >= 44));
    assert.equal(rootStyle.paddingBottom, 16 + (compact ? 8 : 12));
  });
}

test("底栏保留进度跳转、播放回调、触觉和播放模式提示", t => {
  const calls = [];
  const h = harness(t, "ImmersiveTransport", transportProps(calls));
  const progress = h.renderer.root.findByType("ProgressBar");
  assert.equal(progress.props.position, 12);
  assert.equal(progress.props.duration, 180);
  assert.equal(progress.props.buffered, 90);
  act(() => progress.props.onSeek(42));
  h.click("播放模式：列表循环"); h.click("上一首"); h.click("播放"); h.click("下一首"); h.click("播放队列，共 12 首");
  assert.deepEqual(calls, [["seek", 42], "mode", "previous", "play", "next", "queue"]);
  assert.equal(h.events.filter(event => event === "haptic").length, 3);
  assert.equal(h.renderer.root.findAllByType("Animated.View").length, 1);
  h.update({ isPlaying: true });
  assert.ok(h.button("暂停"));
  h.update({ loading: true });
  assert.equal(h.renderer.root.findAllByType("ActivityIndicator").length, 3);
});

function menuProps(events) {
  return {
    visible: true, onClose: () => events.push("close"), isLiked: false, onToggleLike: () => events.push("like"),
    floatingLyricActive: false, onToggleFloatingLyric: () => events.push("floating"),
    canShowComments: true, onOpenComments: () => events.push("comments"),
    sleepLabel: "30 分钟", sleepActive: false, onOpenSleep: () => events.push("sleep"),
    onOpenPlaySetting: () => events.push("settings"), onOpenBackground: () => events.push("background"),
    canAddToPlaylist: true, onAddToPlaylist: () => events.push("playlist"), onOpenDownload: () => events.push("download"),
    onPlayMv: () => events.push("mv"), canShare: true, onShare: () => events.push("share"),
    canShowSimilarSongs: true, onOpenSimilarSongs: () => events.push("similar"),
  };
}

test("更多菜单承接全部扩展操作，活动开关与睡眠状态准确可达", t => {
  const h = harness(t, "ImmersiveMoreMenu", menuProps([]));
  for (const label of ["喜欢", "打开悬浮歌词", "评论", "睡眠定时", "播放设置", "下载歌曲", "添加到歌单", "播放 MV", "分享音乐", "相似歌曲推荐"]) {
    assert.ok(h.button(label), label);
  }
  h.update({ isLiked: true, floatingLyricActive: true, sleepActive: true });
  for (const label of ["取消喜欢", "关闭悬浮歌词", "睡眠定时：30 分钟"]) {
    assert.ok(h.button(label), label);
    assert.equal(h.button(label).props.accessibilityState.selected, true);
  }
});

for (const [label, action] of [
  ["喜欢", "like"], ["打开悬浮歌词", "floating"], ["评论", "comments"], ["睡眠定时", "sleep"],
  ["播放设置", "settings"], ["下载歌曲", "download"], ["添加到歌单", "playlist"],
  ["播放 MV", "mv"], ["分享音乐", "share"], ["相似歌曲推荐", "similar"],
]) {
  test(`菜单“${label}”先关闭，再等待原生弹层退出后执行`, t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const calls = [];
    const h = harness(t, "ImmersiveMoreMenu", menuProps(calls));
    h.click(label);
    assert.deepEqual(calls, ["close"]);
    assert.deepEqual(h.events, ["haptic"]);
    act(() => t.mock.timers.tick(319));
    assert.deepEqual(calls, ["close"]);
    act(() => t.mock.timers.tick(1));
    assert.deepEqual(calls, ["close", action]);
  });
}

test("不可用的评论、歌单、MV、分享和相似入口不占菜单位置", t => {
  const h = harness(t, "ImmersiveMoreMenu", {
    ...menuProps([]), canShowComments: false, canAddToPlaylist: false, onPlayMv: undefined, canShare: false, canShowSimilarSongs: false,
  });
  for (const label of ["评论", "添加到歌单", "播放 MV", "分享音乐", "相似歌曲推荐"]) assert.equal(h.button(label), undefined, label);
  assert.ok(h.button("播放设置"));
});
