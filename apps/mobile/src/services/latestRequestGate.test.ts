import { describe, expect, it } from "vitest";
import { LatestRequestGate } from "./latestRequestGate";

describe("LatestRequestGate", () => {
  it("新请求淘汰旧请求", () => {
    const gate = new LatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it("invalidate 淘汰当前请求", () => {
    const gate = new LatestRequestGate();
    const request = gate.begin();
    gate.invalidate();
    expect(gate.isCurrent(request)).toBe(false);
  });
});
