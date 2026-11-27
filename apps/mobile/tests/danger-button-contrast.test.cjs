const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

const React = mobileRequire("react");
const { act, create } = mobileRequire("react-test-renderer");
const { buildThemePalette } = createLoader({})("src/services/themePaletteModel.ts");

global.IS_REACT_ACT_ENVIRONMENT = true;

function rgb(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
}

function composite(rgba, surface) {
  const match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(rgba);
  assert.ok(match, `必须使用实际透明底色计算：${rgba}`);
  const alpha = Number(match[4]);
  return rgb(surface).map((channel, index) => Number(match[index + 1]) * alpha + channel * (1 - alpha));
}

function luminance(channels) {
  const linear = channels.map(channel => channel / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function flatten(style) {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

for (const mode of ["light", "dark"]) {
  test(`${mode}危险按钮在实际透明底色上满足正文对比度`, t => {
    const palette = buildThemePalette(mode);
    const { Button } = createLoader({
      react: React,
      "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: value => value } },
      "@/stores/themeStore": {
        useThemeStore: select => select({ mode, systemTheme: mode, accentColor: palette.primary }),
        getResolvedTheme: () => mode, getThemePalette: () => palette,
      },
    })("src/components/ui/Button.tsx");
    let renderer;
    act(() => { renderer = create(React.createElement(Button, { label: "退出", variant: "danger", size: "small" })); });
    t.after(() => act(() => renderer.unmount()));
    const background = flatten(renderer.root.findByType("Pressable").props.style({ pressed: false })).backgroundColor;
    const foreground = flatten(renderer.root.findByType("Text").props.style).color;
    const textLuminance = luminance(rgb(foreground));
    const backgroundLuminance = luminance(composite(background, palette.surface));
    const contrast = (Math.max(textLuminance, backgroundLuminance) + 0.05) / (Math.min(textLuminance, backgroundLuminance) + 0.05);
    assert.ok(contrast >= 4.5, `${mode}危险按钮文字对比度为${contrast.toFixed(2)}:1，低于4.5:1`);
  });
}
