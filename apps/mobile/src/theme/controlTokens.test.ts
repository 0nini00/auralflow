import { describe, expect, it } from "vitest";
import { control, controlHitSlop } from "./controlTokens";

describe("mobile control tokens", () => {
  it("defines stable button sizes and touch targets", () => {
    expect(control.button.small.height).toBeLessThan(control.button.medium.height);
    expect(control.button.medium.height).toBeLessThan(control.button.large.height);
    expect(control.button.medium.height).toBeGreaterThanOrEqual(44);
    expect(control.iconButton.compact.size).toBeGreaterThanOrEqual(36);
    expect(control.iconButton.standard.size).toBeGreaterThanOrEqual(44);
    expect(control.iconButton.large.size).toBeGreaterThan(control.iconButton.standard.size);
  });

  it("provides hit slop for compact icon controls", () => {
    const hitSlop = controlHitSlop("compact");
    expect(hitSlop.top).toBeGreaterThan(0);
    expect(hitSlop.top).toBe(hitSlop.bottom);
    expect(hitSlop.left).toBe(hitSlop.right);
  });
});
