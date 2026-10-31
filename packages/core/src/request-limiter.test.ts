import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestLimiter } from "./request-limiter";

describe("createRequestLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("达到上限后排队，释放槽位后按序转交", async () => {
    const limiter = createRequestLimiter({ limit: 2 });
    const first = await limiter.acquire();
    const second = await limiter.acquire();

    let third = false;
    const pendingThird = limiter.acquire().then((release) => {
      third = true;
      return release;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(third).toBe(false);

    first();
    const releaseThird = await pendingThird;
    expect(third).toBe(true);

    second();
    releaseThird();
  });

  it("租约到期让出槽位，挂死的请求不再阻塞后来者", async () => {
    // 排队上限故意设得比租约长：只验证租约本身能救回队尾。
    const limiter = createRequestLimiter({ limit: 1, leaseMs: 1_000, queueWaitMs: 5_000 });
    await limiter.acquire();

    let admitted = false;
    const pending = limiter.acquire().then((release) => {
      admitted = true;
      return release;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(admitted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(admitted).toBe(true);
    const release = await pending;
    release();
  });

  it("abandon 后排队中的候选被拒绝，后续申请也直接抛错", async () => {
    const limiter = createRequestLimiter({ limit: 1 });
    const held = await limiter.acquire();

    const pending = limiter.acquire();
    const rejection = expect(pending).rejects.toThrow("当前解析轮次已结束");
    limiter.abandon();
    await rejection;
    await expect(limiter.acquire()).rejects.toThrow("当前解析轮次已结束");

    held();
  });

  it("排队超时后溢出放行，其释放函数不占用也不归还槽位", async () => {
    const limiter = createRequestLimiter({ limit: 1, queueWaitMs: 300, leaseMs: 10_000 });
    const held = await limiter.acquire();

    let overflowRelease: (() => void) | null = null;
    const overflow = limiter.acquire().then((release) => {
      overflowRelease = release;
    });
    await vi.advanceTimersByTimeAsync(300);
    await overflow;
    expect(overflowRelease).toBeTypeOf("function");

    // no-op 释放不能把 held 占着的槽位提前放掉：下一次申请仍要排队。
    overflowRelease!();
    let second = false;
    const next = limiter.acquire().then((release) => {
      second = true;
      return release;
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(second).toBe(true);

    const releaseNext = await next;
    releaseNext();
    held();
  });
});
