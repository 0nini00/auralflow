import { describe, expect, it } from "vitest";
import { BRAND, CANVAS, RADIUS, SPACING_STEPS, TYPE_SCALE } from "./design-tokens";

describe("跨端设计令牌", () => {
  it("圆角阶梯单调递增且相邻档差 ≥2px", () => {
    const values = Object.values(RADIUS);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
    const steps = values.slice(0, -1);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i] - steps[i - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  it("间距全部落在 2px 网格上且升序", () => {
    for (const step of SPACING_STEPS) {
      expect(step % 2).toBe(0);
    }
    const sorted = [...SPACING_STEPS].sort((a, b) => a - b);
    expect(sorted).toEqual([...SPACING_STEPS]);
  });

  it("两端字号阶梯都单调递增", () => {
    for (const scale of [TYPE_SCALE.desktop, TYPE_SCALE.mobile]) {
      const values = Object.values(scale);
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
    }
  });

  it("移动端正文比桌面大一档：这是唯一有意分叉", () => {
    expect(TYPE_SCALE.mobile.body).toBeGreaterThan(TYPE_SCALE.desktop.base);
  });

  it("品牌色与画布是合法十六进制", () => {
    for (const color of [...Object.values(BRAND), ...Object.values(CANVAS)]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
