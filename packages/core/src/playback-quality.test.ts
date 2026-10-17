import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
  DEFAULT_SOURCE_STAGGER_MS,
  raceStaggeredPriority,
} from "./playback-quality";

interface Hit {
  url: string;
  quality: string;
}

function hit(url: string, quality: string): Hit {
  return { url, quality };
}

function late<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function lateReject(ms: number, error: unknown): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(error), ms));
}

function options(overrides: Partial<Parameters<typeof raceStaggeredPriority<Hit>>[1]> = {}) {
  return {
    getQuality: (value: Hit) => value.quality,
    ceiling: "flac24bit",
    floor: "flac",
    staggerMs: DEFAULT_SOURCE_STAGGER_MS,
    upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
    deadlineMs: 8000,
    ...overrides,
  };
}

function tracker<T>() {
  const state = { settled: false, value: undefined as T | undefined, error: undefined as unknown };
  return {
    state,
    watch(promise: Promise<T>) {
      promise.then(
        (value) => {
          state.settled = true;
          state.value = value;
        },
        (error) => {
          state.settled = true;
          state.error = error;
        },
      );
      return promise;
    },
  };
}

describe("raceStaggeredPriority", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("没有候选时立即以 formatError 拒绝", async () => {
    await expect(raceStaggeredPriority<Hit>([], options())).rejects.toThrow("没有可用的解析候选");
  });

  it("慢源不被预算击杀:3.3s 后返回达标结果,全部候选结算即定稿", async () => {
    const track = tracker<Hit>();
    const pending = track.watch(
      raceStaggeredPriority([() => late(3300, hit("slow", "flac"))], options()),
    );
    await vi.advanceTimersByTimeAsync(3299);
    expect(track.state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(track.state.value?.url).toBe("slow");
    await pending;
  });

  it("快源命中最高档且无更靠前候选在途时立即定稿,后续源零唤醒", async () => {
    const calls: number[] = [];
    const track = tracker<Hit>();
    const pending = track.watch(
      raceStaggeredPriority(
        [
          () => {
            calls.push(1);
            return late(200, hit("first", "flac24bit"));
          },
          () => {
            calls.push(2);
            return late(1, hit("second", "flac24bit"));
          },
        ],
        options(),
      ),
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(track.state.value?.url).toBe("first");
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([1]);
    await pending;
  });

  it("慢主源在窗口内返回同档结果时按顺序优先,后源不能抢先定稿", async () => {
    const track = tracker<Hit>();
    const pending = track.watch(
      raceStaggeredPriority(
        [
          () => late(1500, hit("primary", "flac24bit")),
          () => late(100, hit("fallback", "flac24bit")),
        ],
        options(),
      ),
    );
    await vi.advanceTimersByTimeAsync(1499);
    expect(track.state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(track.state.value?.url).toBe("primary");
    await pending;
  });

  it("慢主源超出窗口时窗口到期用后源定稿,迟到结果不覆盖", async () => {
    const track = tracker<Hit>();
    const pending = track.watch(
      raceStaggeredPriority(
        [
          () => late(3000, hit("slow-primary", "flac24bit")),
          () => late(100, hit("fast-fallback", "flac24bit")),
        ],
        options(),
      ),
    );
    await vi.advanceTimersByTimeAsync(1700);
    expect(track.state.value?.url).toBe("fast-fallback");
    await vi.advanceTimersByTimeAsync(2000);
    expect(track.state.value?.url).toBe("fast-fallback");
    await pending;
  });

  it("占位源快速失败后立即启动下一个,不空等 stagger", async () => {
    const calls: string[] = [];
    const track = tracker<Hit>();
    const pending = track.watch(
      raceStaggeredPriority(
        [
          () => {
            calls.push("fail");
            return lateReject(50, new Error("占位失败"));
          },
          () => {
            calls.push("hit");
            return late(100, hit("second", "flac24bit"));
          },
        ],
        options(),
      ),
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(calls).toEqual(["fail", "hit"]);
    expect(track.state.value?.url).toBe("second");
    await pending;
  });

  it("低于最低档的结果不参与裁决并计入错误", async () => {
    const seen: string[] = [];
    const rejection = raceStaggeredPriority(
      [() => late(100, hit("low", "128k"))],
      options({
        formatError: (errors) => {
          seen.push(...errors.map((error) => (error instanceof Error ? error.message : String(error))));
          return new Error("全部候选未达标");
        },
      }),
    );
    const assertion = expect(rejection).rejects.toThrow("全部候选未达标");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(seen.join(" ")).toContain("音质不足");
  });

  it("全部候选失败时以 formatError 拒绝并携带各自原因", async () => {
    const first = raceStaggeredPriority(
      [() => lateReject(10, new Error("源甲失败")), () => lateReject(20, new Error("源乙失败"))],
      options(),
    );
    const assertion = expect(first).rejects.toThrow(/源甲失败[\s\S]*源乙失败/);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("deadline 到期停止启动新候选:已有低档结果则定稿", async () => {
    const calls: number[] = [];
    const track = tracker<Hit>();
    const pending = track.watch(
      raceStaggeredPriority(
        [
          () => {
            calls.push(1);
            return late(1000, hit("floor-hit", "flac"));
          },
          () => {
            calls.push(2);
            return late(5000, hit("never", "flac24bit"));
          },
        ],
        options({ deadlineMs: 1500 }),
      ),
    );
    await vi.advanceTimersByTimeAsync(1499);
    expect(track.state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(track.state.value?.url).toBe("floor-hit");
    await vi.advanceTimersByTimeAsync(6000);
    expect(track.state.value?.url).toBe("floor-hit");
    expect(calls).toEqual([1, 2]);
    await pending;
  });

  it("deadline 到期仍无结果时拒绝,错误中带时间预算说明", async () => {
    const rejection = raceStaggeredPriority([() => late(6000, hit("late", "flac24bit"))], options({ deadlineMs: 2000 }));
    await vi.advanceTimersByTimeAsync(0);
    const assertion = expect(rejection).rejects.toThrow(/时间预算/);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });
});
