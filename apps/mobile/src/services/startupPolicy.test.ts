import { describe, expect, it } from "vitest";
import { canRunStartupNetworkTasks } from "./startupPolicy";

describe("canRunStartupNetworkTasks", () => {
  it.each([false, null])("协议状态 %s 时禁止启动网络任务", (accepted) => {
    expect(canRunStartupNetworkTasks(accepted)).toBe(false);
  });

  it("已接受协议时允许启动网络任务", () => {
    expect(canRunStartupNetworkTasks(true)).toBe(true);
  });
});
