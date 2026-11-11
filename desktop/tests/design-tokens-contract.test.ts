import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANVAS, RADIUS, TYPE_SCALE } from "@lx/core";

/**
 * 桌面的 CSS 变量必须与 @lx/core 的共享令牌逐值相等。
 *
 * 两端各写一份数值就是漂移的来源（圆角曾经是 6/8/10/14/20 对 8/12/16/20/28）。
 * 这张测试把 theme.css 当契约读进来比对，改了一边忘了另一边会直接失败。
 */
const css = readFileSync(resolve(__dirname, "../src/styles/theme.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`theme.css 里找不到 ${selector} 块`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function value(blockText: string, name: string): string {
  const match = blockText.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`theme.css 里找不到 ${name}`);
  return match[1].trim();
}

describe("桌面 CSS 变量与共享令牌一致", () => {
  it("圆角五档等于 RADIUS", () => {
    // 圆角与字号各自是一段独立的 :root 块，直接在全文件里找（这两个变量只声明一次）。
    expect(value(css, "--af-radius-xs")).toBe(`${RADIUS.xs}px`);
    expect(value(css, "--af-radius-sm")).toBe(`${RADIUS.sm}px`);
    expect(value(css, "--af-radius-md")).toBe(`${RADIUS.md}px`);
    expect(value(css, "--af-radius-lg")).toBe(`${RADIUS.lg}px`);
    expect(value(css, "--af-radius-xl")).toBe(`${RADIUS.xl}px`);
    expect(value(css, "--af-radius-full")).toBe(`${RADIUS.pill}px`);
  });

  it("字号阶梯等于 TYPE_SCALE.desktop", () => {
    expect(value(css, "--af-font-size-xs")).toBe(`${TYPE_SCALE.desktop.xs}px`);
    expect(value(css, "--af-font-size-sm")).toBe(`${TYPE_SCALE.desktop.sm}px`);
    expect(value(css, "--af-font-size-base")).toBe(`${TYPE_SCALE.desktop.base}px`);
    expect(value(css, "--af-font-size-lg")).toBe(`${TYPE_SCALE.desktop.lg}px`);
    expect(value(css, "--af-font-size-xl")).toBe(`${TYPE_SCALE.desktop.xl}px`);
    expect(value(css, "--af-font-size-2xl")).toBe(`${TYPE_SCALE.desktop.xxl}px`);
    expect(value(css, "--af-font-size-3xl")).toBe(`${TYPE_SCALE.desktop.xxxl}px`);
  });

  it("浅色与深色画布等于 CANVAS", () => {
    expect(value(block(":root"), "--af-bg-base")).toBe(CANVAS.light);
    expect(value(block('[data-theme="dark"]'), "--af-bg-base")).toBe(CANVAS.dark);
  });
});
