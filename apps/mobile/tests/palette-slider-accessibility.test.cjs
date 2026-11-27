const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

const React = mobileRequire("react");
const { act, create } = mobileRequire("react-test-renderer");
const { buildThemePalette } = createLoader({})("src/services/themePaletteModel.ts");
const palette = buildThemePalette("light");
const native = {
  View: "View", Text: "Text", Pressable: "Pressable", Switch: "Switch",
  StyleSheet: { create: value => value, hairlineWidth: 1 },
};

global.IS_REACT_ACT_ENVIRONMENT = true;

function renderSlider(t, initial = {}) {
  const { PaletteSlider } = createLoader({ react: React, "react-native": native })("src/components/settings/PaletteSlider.tsx");
  const changes = [];
  let props = { value: 0.5, min: 0.1, max: 1, step: 0.05, palette,
    accessibilityLabel: "其他行与译文透明度", accessibilityValueText: "50%", ...initial };
  let renderer;
  const render = () => React.createElement(PaletteSlider, { ...props, onChange(value) {
    changes.push(value);
    props = { ...props, value, accessibilityValueText: `${Math.round(value * 100)}%` };
    renderer.update(render());
  } });
  act(() => { renderer = create(render()); });
  t.after(() => act(() => renderer.unmount()));
  const control = () => renderer.root.findAllByType("View")[0];
  return {
    changes, control,
    action(name) {
      assert.equal(typeof control().props.onAccessibilityAction, "function", "滑块必须响应读屏调节动作");
      act(() => control().props.onAccessibilityAction({ nativeEvent: { actionName: name } }));
    },
    drag(x, phase = "onResponderGrant") {
      act(() => control().props.onLayout({ nativeEvent: { layout: { width: 300 } } }));
      act(() => control().props[phase]({ nativeEvent: { locationX: x } }));
    },
  };
}

test("滑块播报名称、范围、当前数值和百分比", t => {
  const h = renderSlider(t);
  const { props } = h.control();
  assert.equal(props.accessible, true);
  assert.equal(props.accessibilityRole, "adjustable");
  assert.equal(props.accessibilityLabel, "其他行与译文透明度");
  assert.deepEqual(props.accessibilityValue, { min: 0, max: 18, now: 8, text: "50%" });
  for (const key of ["min", "max", "now"]) {
    assert.ok(Number.isInteger(props.accessibilityValue[key]), "Android读屏范围会转为整数，须使用刻度索引");
  }
  assert.deepEqual(props.accessibilityActions.map(action => action.name), ["increment", "decrement"]);
});

test("读屏按步长增减，更新播报且边界不越界或重复写入", t => {
  const h = renderSlider(t, { value: 0.95, accessibilityValueText: "95%" });
  h.action("increment");
  assert.equal(h.changes.at(-1), 1);
  assert.deepEqual(h.control().props.accessibilityValue, { min: 0, max: 18, now: 18, text: "100%" });
  h.action("increment");
  assert.equal(h.changes.length, 1);
  h.action("decrement");
  assert.ok(Math.abs(h.changes.at(-1) - 0.95) < 1e-12);
  for (let index = 0; index < 20; index++) h.action("decrement");
  assert.equal(h.changes.at(-1), 0.1);
  const count = h.changes.length;
  h.action("decrement"); h.action("activate");
  assert.equal(h.changes.length, count);
  assert.ok(h.changes.every(value => value >= 0.1 && value <= 1));
});

test("拖动保留相同步长和边界，并可接续读屏调节", t => {
  const h = renderSlider(t);
  h.drag(200);
  assert.ok(Math.abs(h.changes.at(-1) - 0.7) < 1e-12);
  h.action("increment");
  assert.equal(h.changes.at(-1), 0.75);
  h.drag(-100, "onResponderMove");
  assert.equal(h.changes.at(-1), 0.1);
  h.drag(1000, "onResponderMove");
  assert.equal(h.changes.at(-1), 1);
});

test("未传step时读屏使用默认刻度", t => {
  const h = renderSlider(t, { value: 0.5, min: 0, max: 1, step: undefined });
  h.action("increment");
  assert.ok(Math.abs(h.changes.at(-1) - 0.525) < 1e-12);
  assert.deepEqual(h.control().props.accessibilityValue, { min: 0, max: 40, now: 21, text: "53%" });
  h.action("decrement");
  assert.equal(h.changes.at(-1), 0.5);
});

test("歌词设置使用同一个百分比展示文字和读屏当前值", t => {
  const lyricState = {
    fontSize: 16, lineGap: 8, textOpacity: 0.65, activeColor: "", inactiveColor: "",
    fontFamily: "", textAlign: "center", fontWeight: "600", manualOffsetMs: 0,
    coverSpin: false, showLyricProgress: false, enableAnimation: false,
    animationIntensity: "normal", showTranslation: true,
  };
  const load = createLoader({
    react: React, "react-native": native,
    "opencc-js": mobileRequire("opencc-js"),
    "@/stores/themeStore": {
      useThemeStore: select => select({ mode: "light", systemTheme: "light", accentColor: palette.primary }),
      getResolvedTheme: () => "light", getThemePalette: () => palette,
    },
    "@/stores/lyricSettingsStore": {
      useLyricSettingsStore: select => select(lyricState),
      FONT_OPTIONS: [], ACTIVE_COLOR_PRESETS: [], INACTIVE_COLOR_PRESETS: [],
    },
    "@/stores/playerStore": { usePlayerStore: select => select({ lyrics: [] }) },
    "@/hooks/useLyricLineIndex": { useLyricLineIndex: () => -1 },
    "@/services/lyricOverlayAppearance": { syncLyricOverlayTextAppearance: async () => {} },
    "@/components/settings/SettingsCard": { SettingsCard: "SettingsCard" },
  });
  const { LyricSettingsContent } = load("src/screens/LyricSettingsScreen.tsx");
  let renderer;
  act(() => { renderer = create(React.createElement(LyricSettingsContent)); });
  t.after(() => act(() => renderer.unmount()));
  const slider = renderer.root.findAll(node => node.type === "View" && node.props.onResponderGrant)[0];
  assert.equal(slider.props.accessibilityLabel, "其他行与译文透明度");
  assert.deepEqual(slider.props.accessibilityValue, { min: 0, max: 18, now: 11, text: "65%" });
  assert.match(JSON.stringify(renderer.toJSON()), /其他行与译文透明度 · .*65%/);
});
