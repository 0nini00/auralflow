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

const themePaletteModel = createLoader({})("src/services/themePaletteModel.ts");
const { DEFAULT_ACCENT_COLOR, buildThemePalette, migrateAccentColor } = themePaletteModel;

const native = {
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: value => value, hairlineWidth: 1 },
};

/** 用最小 mock 渲染 ThemeModeCard：只关心预设主题色的选中与写入。 */
function renderCard(t, accentColor) {
  const setAccentColorCalls = [];
  const themeState = {
    mode: "light",
    systemTheme: "light",
    accentColor,
    setMode: () => {},
    setAccentColor: value => setAccentColorCalls.push(value),
    resetAccentColor: async () => {},
  };
  const mocks = {
    react: React,
    "react-native": native,
    "lucide-react-native": { Check: "Check", Monitor: "Monitor", Moon: "Moon", Sun: "Sun" },
    "@/components/settings/SettingsCard": { SettingsCard: "SettingsCard" },
    "@/components/settings/ThemeColorPicker": { ThemeColorPicker: "ThemeColorPicker" },
    "@/services/themePaletteModel": themePaletteModel,
    // 设计 token 只参与样式数值，测试不关心
    "@/theme/tokens": { radius: {}, spacing: {}, touch: {}, typography: {} },
    "@/stores/themeStore": {
      useThemeStore: selector => selector(themeState),
      getResolvedTheme: (mode, systemTheme) => (mode === "system" ? systemTheme : mode),
      getThemePalette: (theme, accent) => buildThemePalette(theme, accent),
    },
  };
  const source = fs.readFileSync(path.join(mobileRoot, "src/components/ThemeModeCard.tsx"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    fileName: "ThemeModeCard.tsx",
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(mocks, name), `未声明的依赖：${name}`);
    return mocks[name];
  }, module, module.exports);
  let renderer;
  act(() => { renderer = create(React.createElement(module.exports.ThemeModeCard)); });
  t.after(() => act(() => renderer.unmount()));
  const swatch = () => renderer.root.findAll(
    node => node.type === "Pressable" && node.props.accessibilityLabel === "主题色：默认绿",
  )[0];
  return { renderer, swatch, setAccentColorCalls };
}

test("默认强调色下「默认绿」预设即为选中项", t => {
  const h = renderCard(t, DEFAULT_ACCENT_COLOR);
  assert.ok(h.swatch(), "必须存在「默认绿」预设");
  assert.equal(h.swatch().props.accessibilityState.selected, true);
  const rendered = JSON.stringify(h.renderer.toJSON());
  assert.match(rendered, /当前：默认绿/);
  assert.doesNotMatch(rendered, /当前：自定义颜色/);
});

test("点「默认绿」写入的就是全新安装的默认强调色", t => {
  const h = renderCard(t, "#a8324f");
  act(() => h.swatch().props.onPress());
  assert.deepEqual(h.setAccentColorCalls, [DEFAULT_ACCENT_COLOR]);
  // 写入值本身必须与读盘迁移结果一致，重启后不能再被折回成另一个颜色
  assert.equal(migrateAccentColor(h.setAccentColorCalls[0]), DEFAULT_ACCENT_COLOR);
});
