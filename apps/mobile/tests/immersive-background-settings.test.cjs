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

test("柔光色域成为固定背景，不再提供可配置背景状态", async () => {
  const h = fixture();
  await h.ready;
  assert.equal(Object.hasOwn(h.store.getState(), "immersiveBackground"), false);
  assert.equal(Object.hasOwn(h.DEFAULT_LYRIC_SETTINGS, "immersiveBackground"), false);
  assert.equal(Object.hasOwn(h.store.getState(), "setImmersiveBackground"), false);
  assert.equal(Object.hasOwn(h.store.getState(), "ambientCoverTint"), false);
  assert.equal(Object.hasOwn(h.store.getState(), "setAmbientCoverTint"), false);
});

for (const [label, persisted] of [
  ["旧开关开启", { ambientCoverTint: true }],
  ["旧开关关闭", { ambientCoverTint: false }],
  ["旧纯色", { immersiveBackground: "none" }],
  ["旧封面背景", { immersiveBackground: "cover" }],
  ["旧存档无开关", {}],
  ["旧柔光选择", { ambientCoverTint: false, immersiveBackground: "bloom" }],
  ["旧液态渐变", { immersiveBackground: "liquid" }],
  ["旧极光光幕", { immersiveBackground: "aurora" }],
  ["无效模式", { ambientCoverTint: false, immersiveBackground: "invalid" }],
  ["null模式", { immersiveBackground: null }],
  ["数字模式", { immersiveBackground: 1 }],
]) {
  test(`${label}恢复时移除背景开关，保存时不复活且保留其它歌词设置`, async () => {
    const h = fixture({ ...persisted, fontSize: 22, showTranslation: false, manualOffsetMs: 1000, fontFamily: "LXGWWenKai" });
    await h.ready;
    assert.equal(Object.hasOwn(h.store.getState(), "immersiveBackground"), false);
    assert.equal(Object.hasOwn(h.store.getState(), "ambientCoverTint"), false);
    assert.equal(h.store.getState().fontSize, 22);
    assert.equal(h.store.getState().showTranslation, false);
    assert.equal(h.store.getState().manualOffsetMs, 500);
    assert.equal(h.store.getState().fontFamily, "LXGWWenKai");
    h.store.getState().setFontSize(24);
    assert.equal(Object.hasOwn(h.saved(), "immersiveBackground"), false);
    assert.equal(Object.hasOwn(h.saved(), "ambientCoverTint"), false);
  });
}

test("恢复默认不复活旧背景开关，歌词设置仍正常重置", async () => {
  const h = fixture({ ambientCoverTint: false, immersiveBackground: "bloom", fontSize: 25, showTranslation: false });
  await h.ready;
  h.store.getState().resetSettings();
  assert.equal(Object.hasOwn(h.store.getState(), "immersiveBackground"), false);
  assert.equal(h.store.getState().fontSize, 16);
  assert.equal(h.store.getState().showTranslation, true);
  assert.equal(Object.hasOwn(h.saved(), "immersiveBackground"), false);
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

test("歌词设置页移除背景选择，原有封面旋转设置仍可操作", async t => {
  const h = fixture(); await h.ready;
  const { LyricSettingsContent } = loadUi(h)("src/screens/LyricSettingsScreen.tsx");
  let root;
  await act(async () => { root = create(React.createElement(LyricSettingsContent)); });
  t.after(() => act(() => root.unmount()));
  assert.equal(root.root.findAllByProps({ accessibilityLabel: "播放背景" }).length, 0);
  assert.equal(root.root.findAllByType("Switch").some(node => node.props.accessibilityLabel === "氛围色背景"), false);
  await act(async () => { root.root.findAllByType("Switch").find(node => node.props.accessibilityLabel === "封面旋转").props.onValueChange(false); });
  assert.equal(h.store.getState().coverSpin, false);
  assert.equal(h.saved().coverSpin, false);
  assert.equal(root.root.findAllByType("Modal").length, 0);
});
