import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaybackRequestScheduler } from "./index";

function finishAfter(ms: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error("transport aborted")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve("ok"); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

describe("固定候选期限调度", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("8个4.5秒慢源分三批完成，不因排队者增多抢占，并发始终不超过3", async () => {
    const scheduler = createPlaybackRequestScheduler();
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 8 }, () => scheduler.run(async signal => {
      active += 1;
      peak = Math.max(peak, active);
      try { return await finishAfter(4500, signal); } finally { active -= 1; }
    }));
    const result = Promise.all(tasks);
    await vi.advanceTimersByTimeAsync(13500);
    await expect(result).resolves.toEqual(Array(8).fill("ok"));
    expect(peak).toBe(3);
    expect(active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("取链和探活共同拥有8秒，不按源数量分割时间片", async () => {
    const scheduler = createPlaybackRequestScheduler({ limit: 1 });
    const first = scheduler.run(async signal => {
      await finishAfter(4500, signal);
      return finishAfter(2500, signal);
    });
    const second = scheduler.run(signal => finishAfter(1000, signal));
    await vi.advanceTimersByTimeAsync(8000);
    await expect(Promise.all([first, second])).resolves.toEqual(["ok", "ok"]);
  });

  it("超时明确报告TimeoutError，取得名额后才开始计时", async () => {
    const scheduler = createPlaybackRequestScheduler({ limit: 1 });
    const first = scheduler.run(signal => finishAfter(9000, signal));
    const failure = expect(first).rejects.toMatchObject({ name: "TimeoutError" });
    const second = scheduler.run(signal => finishAfter(4500, signal));
    await vi.advanceTimersByTimeAsync(12500);
    await failure;
    await expect(second).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("超时任务尚未退出时不得假释放名额", async () => {
    const scheduler = createPlaybackRequestScheduler({ limit: 1 });
    const first = scheduler.run(() => new Promise(resolve => setTimeout(resolve, 9000)));
    const failure = expect(first).rejects.toMatchObject({ name: "TimeoutError" });
    const startNext = vi.fn(signal => finishAfter(10, signal));
    const second = scheduler.run(startNext);
    await vi.advanceTimersByTimeAsync(8500);
    expect(startNext).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(510);
    await failure;
    await expect(second).resolves.toBe("ok");
  });

  it("取消排队请求不会抢占仍在执行的其他请求", async () => {
    const scheduler = createPlaybackRequestScheduler({ limit: 1 });
    const first = scheduler.run(signal => finishAfter(4500, signal));
    const cancel = new AbortController();
    const neverStarted = vi.fn(signal => finishAfter(10, signal));
    const queued = scheduler.run(neverStarted, cancel.signal);
    const failure = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    cancel.abort();
    await vi.advanceTimersByTimeAsync(4500);
    await failure;
    await expect(first).resolves.toBe("ok");
    expect(neverStarted).not.toHaveBeenCalled();
  });

  it("父请求取消与候选超时分开报告", async () => {
    const scheduler = createPlaybackRequestScheduler();
    const cancel = new AbortController();
    const task = scheduler.run(signal => finishAfter(7000, signal), cancel.signal);
    const failure = expect(task).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10);
    cancel.abort();
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });
});
