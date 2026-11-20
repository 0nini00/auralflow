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


  it("严格模式不因时间经过释放真实在途名额", async () => {
    const limiter = createRequestLimiter({ limit: 1 });
    const release = await limiter.acquire();
    let started = false;
    const queued = limiter.acquire().then((done) => { started = true; return done; });
    await vi.advanceTimersByTimeAsync(10_000);
    const beforeRelease = started;
    release();
    (await queued)();
    expect(beforeRelease).toBe(false);
  });

  it("取消排队者不获取名额，也不影响其它等待者", async () => {
    const limiter = createRequestLimiter({ limit: 1 });
    const release = await limiter.acquire();
    const controller = new AbortController();
    const cancelled = limiter.acquire(controller.signal);
    const rejection = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_000);
    release();
    await rejection;
    (await limiter.acquire())();
  });
});
