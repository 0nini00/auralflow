import { describe, expect, it } from "vitest";
import { disposeRuntimePendingRequests } from "./customSourceRuntimeLifecycleModel";

describe("disposeRuntimePendingRequests", () => {
  it("释放 runtime 时删除路由并拒绝所有挂起请求", () => {
    const rejected: string[] = [];
    const registry = new Map([
      ["rid", new Map([
        ["request-1", { reject: (error: Error) => rejected.push(error.message) }],
        ["request-2", { reject: (error: Error) => rejected.push(error.message) }],
      ])],
    ]);

    expect(disposeRuntimePendingRequests(registry, "rid", new Error("disposed"))).toBe(true);
    expect(registry.has("rid")).toBe(false);
    expect(rejected).toEqual(["disposed", "disposed"]);
  });

  it("不存在的 runtime 返回 false", () => {
    expect(disposeRuntimePendingRequests(new Map(), "missing", new Error("disposed"))).toBe(false);
  });
});
