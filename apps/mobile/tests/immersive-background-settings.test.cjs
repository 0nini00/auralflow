const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const test = require("node:test");
const { createLoader, mobileRequire, mobileRoot } = require("./helpers/loadTs.cjs");

const desktopRequire = createRequire(path.resolve(mobileRoot, "../../desktop/package.json"));
const React = desktopRequire("react");
const { act, create } = desktopRequire("react-test-renderer");
const { createStore } = mobileRequire("zustand/vanilla");
const middleware = mobileRequire("zustand/middleware");
const ts = mobileRequire("typescript");
const STORAGE_KEY = "auralflow-lyric-settings";
const options = [
  { value: "none", label: "纯色" },
  { value: "cover", label: "封面氛围" },
  { value: "bloom", label: "柔光色域" },
];

function fixture(persisted) {
  const values = new Map(persisted === undefined ? [] : [[STORAGE_KEY, JSON.stringify({ state: persisted, version: 0 })]]);
  const writes = [];
  const load = createLoader({
    zustand: { create: createStore },
    "zustand/middleware": middleware,
    "@react-native-async-storage/async-storage": {
      getItem: async key => values.get(key) ?? null,
      setItem: async (key, value) => { values.set(key, value); writes.push([key, value]); },
      removeItem: async key => values.delete(key),
    },
    "opencc-js": mobileRequire("opencc-js"),
  });
  const module = load("src/stores/lyricSettingsStore.ts");
  const store = module.useLyricSettingsStore;
  const ready = store.persist.hasHydrated() ? Promise.resolve() : new Promise(resolve => store.persist.onFinishHydration(resolve));
  return { ...module, store, load, ready, writes, saved: () => JSON.parse(values.get(STORAGE_KEY)).state };
}

test("默认背景为封面氛围，只有一个模式字段", async () => {
  const h = fixture();
  await h.ready;
  assert.equal(h.store.getState().immersiveBackground, "cover");
  assert.equal(h.DEFAULT_LYRIC_SETTINGS.immersiveBackground, "cover");
  assert.equal(Object.hasOwn(h.store.getState(), "ambientCoverTint"), false);
  assert.equal(Object.hasOwn(h.store.getState(), "setAmbientCoverTint"), false);
});

for (const [label, persisted, expected] of [
  ["旧开关开启", { ambientCoverTint: true }, "cover"],
  ["旧开关关闭", { ambientCoverTint: false }, "none"],
  ["旧存档无开关", {}, "cover"],
  ["新模式优先于旧开关", { ambientCoverTint: false, immersiveBackground: "bloom" }, "bloom"],
  ["液态渐变迁移为柔光色域", { immersiveBackground: "liquid" }, "bloom"],
  ["极光光幕迁移为柔光色域", { immersiveBackground: "aurora" }, "bloom"],
  ["无效新模式不回退旧开关", { ambientCoverTint: false, immersiveBackground: "invalid" }, "cover"],
  ["null模式", { immersiveBackground: null }, "cover"],
  ["数字模式", { immersiveBackground: 1 }, "cover"],
]) {
  test(`${label}经真实持久化hydration得到${expected}且旧key不再保存`, async () => {
    const h = fixture({ ...persisted, fontSize: 22, showTranslation: false, manualOffsetMs: 1000, fontFamily: "LXGWWenKai" });
    await h.ready;
    assert.equal(h.store.getState().immersiveBackground, expected);
    assert.equal(Object.hasOwn(h.store.getState(), "ambientCoverTint"), false);
    assert.equal(h.store.getState().fontSize, 22);
    assert.equal(h.store.getState().showTranslation, false);
    assert.equal(h.store.getState().manualOffsetMs, 500);
    assert.equal(h.store.getState().fontFamily, "LXGWWenKai");
    h.store.getState().setFontSize(24);
    assert.equal(h.saved().immersiveBackground, expected);
    assert.equal(Object.hasOwn(h.saved(), "ambientCoverTint"), false);
  });
}

test("背景选项顺序与文案来自共用模型", async () => {
  const h = fixture();
  await h.ready;
  const modelPath = path.join(mobileRoot, "src/services/immersiveBackgroundSettings.ts");
  assert.ok(fs.existsSync(modelPath), "缺少共享背景设置模型");
  const model = h.load(modelPath);
  assert.deepEqual(model.IMMERSIVE_BACKGROUND_OPTIONS, options);
  assert.equal(model.DEFAULT_IMMERSIVE_BACKGROUND, "cover");
});

for (const option of options) {
  test(`${option.label}立即更新、保存并可重新加载`, async () => {
    const h = fixture();
    await h.ready;
    assert.equal(typeof h.store.getState().setImmersiveBackground, "function");
    h.store.getState().setImmersiveBackground(option.value);
    assert.equal(h.store.getState().immersiveBackground, option.value);
    assert.equal(h.saved().immersiveBackground, option.value);
    const restored = fixture(h.saved());
    await restored.ready;
    assert.equal(restored.store.getState().immersiveBackground, option.value);
  });
}

test("非法setter输入明确拒绝且不改变状态或写盘", async () => {
  const h = fixture({ immersiveBackground: "bloom" });
  await h.ready;
  assert.equal(typeof h.store.getState().setImmersiveBackground, "function");
  const before = h.writes.length;
  for (const value of [undefined, null, false, "invalid", "", 123]) {
    assert.throws(() => h.store.getState().setImmersiveBackground(value), /背景/);
  }
  assert.equal(h.store.getState().immersiveBackground, "bloom");
  assert.equal(h.writes.length, before);
});

test("恢复默认同时重置背景与既有歌词设置，保存中不含旧key", async () => {
  const h = fixture({ ambientCoverTint: false, immersiveBackground: "bloom", fontSize: 25, showTranslation: false });
  await h.ready;
  h.store.getState().resetSettings();
  assert.equal(h.store.getState().immersiveBackground, "cover");
  assert.equal(h.store.getState().fontSize, 16);
  assert.equal(h.store.getState().showTranslation, true);
  assert.equal(h.saved().immersiveBackground, "cover");
  assert.equal(Object.hasOwn(h.saved(), "ambientCoverTint"), false);
});

const palette = { background: "#101010", surface: "#202020", surfaceMuted: "#303030", border: "#444444", text: "#ffffff", textMuted: "#bbbbbb", textSubtle: "#999999", primary: "#00aa55", primaryInk: "#55dd99", actionFill: "#008844", onActionFill: "#ffffff" };

function loadUi(h) {
  const cache = new Map();
  const host = name => name;
  const mocks = {
    react: React,
    "react-native": { Modal: ({ visible, children, ...props }) => visible ? React.createElement("Modal", props, children) : null,
      View: host("View"), Text: host("Text"), Pressable: host("Pressable"), ScrollView: host("ScrollView"), Switch: host("Switch"),
      StyleSheet: { create: value => value, hairlineWidth: 1, absoluteFill: { position: "absolute", inset: 0 } },
      useWindowDimensions: () => ({ width: 390, height: 844 }), Platform: { OS: "android", select: value => value.android },
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) },
    "lucide-react-native": { Check: "Check", X: "X", ChevronRight: "ChevronRight" },
    "@/stores/lyricSettingsStore": { ...h, useLyricSettingsStore: selector => selector(React.useSyncExternalStore(h.store.subscribe, h.store.getState, h.store.getState)) },
    "@/stores/themeStore": { useThemeStore: selector => selector({ mode: "dark", systemTheme: "dark", accentColor: "#008844" }), getResolvedTheme: () => "dark", getThemePalette: () => palette },
    "@/stores/playerStore": { usePlayerStore: selector => selector({ lyrics: [] }) },
    "@/hooks/useLyricLineIndex": { useLyricLineIndex: () => -1 },
    "@/services/lyricOverlayAppearance": { syncLyricOverlayTextAppearance: async () => {} },
    "@/components/settings/SettingsCard": { SettingsCard: "SettingsCard" },
    "@/components/settings/PaletteSlider": { PaletteSlider: "PaletteSlider" },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    assert.ok(fs.existsSync(filename), `缺少界面实现 ${filename}`);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
      jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
    }, fileName: filename }).outputText;
    const module = { exports: {} };
    const requireDependency = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) {
        const base = path.join(mobileRoot, "src", name.slice(2));
        return fs.existsSync(`${base}.tsx`) ? load(`${base}.tsx`) : h.load(`${base}.ts`);
      }
      throw new Error(`Unmocked UI import ${name}`);
    };
    new Function("require", "module", "exports", code)(requireDependency, module, module.exports);
    cache.set(filename, module.exports);
    return module.exports;
  }
  // 设计 token 含 Platform；从真实模块加载，原生平台边界仍使用测试宿主。
  mocks["@/theme/tokens"] = createLoader({ "react-native": mocks["react-native"] })("src/theme/tokens.ts");
  return relative => load(path.join(mobileRoot, relative));
}

test("共用背景面板提供三个可访问单选，选择即时保存且继续预览", async t => {
  const h = fixture(); await h.ready;
  const { ImmersiveBackgroundSheet } = loadUi(h)("src/components/ImmersiveBackgroundSheet.tsx");
  let closed = 0;
  let root;
  act(() => { root = create(React.createElement(ImmersiveBackgroundSheet, { visible: true, palette, onClose: () => closed++ })); });
  t.after(() => act(() => root.unmount()));
  const radios = () => root.root.findAll(node => node.type === "Pressable" && node.props.accessibilityRole === "radio");
  assert.deepEqual(radios().map(node => node.props.accessibilityLabel), options.map(option => `播放背景：${option.label}`));
  assert.deepEqual(radios().map(node => node.props.accessibilityState.selected), options.map((_, index) => index === 1));
  for (let i = 0; i < options.length; i++) {
    act(() => radios()[i].props.onPress());
    assert.equal(h.saved().immersiveBackground, options[i].value);
    assert.deepEqual(radios().map(node => node.props.accessibilityState.selected), options.map((_, index) => index === i));
  }
  assert.equal(closed, 0);
  act(() => root.root.findByType("Modal").props.onRequestClose());
  assert.equal(closed, 1);
  act(() => root.root.findByProps({ accessibilityLabel: "关闭播放背景选择" }).props.onPress());
  assert.equal(closed, 2);
  act(() => root.root.findByProps({ accessibilityLabel: "完成背景选择" }).props.onPress());
  assert.equal(closed, 3);
  act(() => root.update(React.createElement(ImmersiveBackgroundSheet, { visible: false, palette, onClose: () => closed++ })));
  assert.equal(radios().length, 0);
});

test("歌词设置入口打开同一背景面板并随选项和关闭状态更新", async t => {
  const h = fixture(); await h.ready;
  const { LyricSettingsContent } = loadUi(h)("src/screens/LyricSettingsScreen.tsx");
  let root;
  await act(async () => { root = create(React.createElement(LyricSettingsContent)); });
  t.after(() => act(() => root.unmount()));
  const opener = () => root.root.findByProps({ accessibilityLabel: "播放背景" });
  assert.equal(root.root.findAllByType("Switch").some(node => node.props.accessibilityLabel === "氛围色背景"), false);
  assert.equal(opener().props.accessibilityValue.text, "封面氛围");
  act(() => opener().props.onPress());
  act(() => root.root.findByProps({ accessibilityLabel: "播放背景：柔光色域" }).props.onPress());
  assert.equal(h.store.getState().immersiveBackground, "bloom");
  assert.equal(opener().props.accessibilityValue.text, "柔光色域");
  act(() => root.root.findByType("Modal").props.onRequestClose());
  assert.equal(root.root.findAllByType("Modal").length, 0);
});
