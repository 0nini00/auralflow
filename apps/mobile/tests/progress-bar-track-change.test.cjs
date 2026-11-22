const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { mobileRoot, mobileRequire } = require("./helpers/loadTs.cjs");

const desktopRequire = createRequire(path.resolve(mobileRoot, "../../desktop/package.json"));
const React = desktopRequire("react");
const { act, create } = desktopRequire("react-test-renderer");
const ts = mobileRequire("typescript");

function createHarness(mocks) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = fs.readFileSync(filename, "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module);
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
    new Function("require", "module", "exports", code)(requireModule, module, module.exports);
    return module.exports;
  }
  return load;
}

function createAnimatedMock() {
  const timings = [];
  const values = [];
  class Value {
    constructor(initial) {
      this.value = initial;
      this.setValueCalls = [];
      values.push(this);
    }
    setValue(value) { this.value = value; this.setValueCalls.push(value); }
    stopAnimation() {}
    interpolate() { return this; }
  }
  return {
    timings,
    values,
    module: {
      Value,
      View: "Animated.View",
      timing: (value, options) => {
        timings.push({ value, toValue: options.toValue, duration: options.duration });
        return { start() {}, stop() {} };
      },
    },
  };
}

const palette = { text: "#ffffff", primary: "#58a87a", surfaceMuted: "#303030" };
const themeMocks = {
  "@/stores/themeStore": {
    useThemeStore: selector => selector({ mode: "dark", systemTheme: "dark", accentColor: "#229955" }),
    getResolvedTheme: (mode, systemTheme) => (mode === "system" ? systemTheme : mode),
    getThemePalette: () => palette,
  },
  "@/services/themePaletteModel": { withAlpha: color => color },
  "@/services/logger": { logger: { warn() {}, error() {}, info() {} } },
};

test("MiniProgressBar 切歌时直接归位，不播放从上一首位置滑到开头的动画", t => {
  const animated = createAnimatedMock();
  const store = {
    state: { position: 50, duration: 100, currentSong: { source: "wy", id: "1" } },
    listeners: new Set(),
  };
  function usePlayerStore(selector) {
    const [, force] = React.useState(0);
    React.useEffect(() => {
      const listener = () => force(value => value + 1);
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    }, []);
    return selector(store.state);
  }
  const load = createHarness({
    react: React,
    "react-native": {
      Animated: animated.module,
      Easing: { linear: value => value },
      StyleSheet: { create: value => value },
      View: "View",
    },
    "@/stores/playerStore": { usePlayerStore },
    ...themeMocks,
  });
  const { MiniProgressBar } = load(path.join(mobileRoot, "src/components/MiniProgressBar.tsx"));
  let tree;
  try {
    act(() => { tree = create(React.createElement(MiniProgressBar)); });
    assert.equal(animated.timings.length, 1);
    act(() => {
      store.state = { position: 0, duration: 200, currentSong: { source: "wy", id: "2" } };
      for (const listener of store.listeners) listener();
    });
    assert.equal(animated.timings.length, 1, "切歌不能再启动 timing 动画");
    assert.ok(animated.values[0].setValueCalls.includes(0), "切歌应把进度直接设为 0");
  } finally {
    if (tree) act(() => tree.unmount());
  }
});

test("ProgressBar 切歌时直接归位，不播放从上一首位置滑到开头的动画", t => {
  const animated = createAnimatedMock();
  const load = createHarness({
    react: React,
    "react-native": {
      Animated: animated.module,
      Easing: { linear: value => value },
      StyleSheet: { create: value => value, hairlineWidth: 1 },
      View: "View",
    },
    ...themeMocks,
  });
  const { ProgressBar } = load(path.join(mobileRoot, "src/components/ProgressBar.tsx"));
  let tree;
  try {
    act(() => {
      tree = create(React.createElement(ProgressBar, {
        position: 50, duration: 100, trackKey: "wy:1", onSeek: () => {},
      }));
    });
    assert.equal(animated.timings.length, 1);
    act(() => {
      tree.update(React.createElement(ProgressBar, {
        position: 0, duration: 200, trackKey: "wy:2", onSeek: () => {},
      }));
    });
    assert.equal(animated.timings.length, 1, "切歌不能再启动 timing 动画");
    assert.ok(animated.values[0].setValueCalls.includes(0), "切歌应把进度直接设为 0");
  } finally {
    if (tree) act(() => tree.unmount());
  }
});
