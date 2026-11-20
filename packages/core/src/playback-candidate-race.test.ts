import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { raceForBestQuality, raceStaggeredPriority } from "./playback-quality";

interface Candidate { url: string; quality: string; verified: boolean }
const uncertain: Candidate = { url: "uncertain", quality: "flac", verified: false };
const verified: Candidate = { url: "verified", quality: "320k", verified: true };
const late = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
const options = {
  getQuality: (value: Candidate) => value.quality,
  isVerified: (value: Candidate) => value.verified,
  floor: "128k",
  ceiling: "flac",
  upgradeWindowMs: 100,
  staggerMs: 100,
  deadlineMs: 6000,
};

describe("播放候选先比较可用性再比较音质", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("交错竞速不会让快但未验证的最高档取消后续可用源", async () => {
    const next = vi.fn(() => late(2000, verified));
    const task = raceStaggeredPriority([() => late(10, uncertain), next], options);
    const resolved = vi.fn();
    void task.then(resolved);
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolved).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(task).resolves.toEqual(verified);
  });

  it("并行网关竞速等待较慢但已验证的自定义地址", async () => {
    const task = raceForBestQuality([late(10, uncertain), late(3000, verified)], options);
    const resolved = vi.fn();
    void task.then(resolved);
    await vi.advanceTimersByTimeAsync(2000);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(task).resolves.toEqual(verified);
  });

  it("较晚的高档未验证地址不替换已验证低档地址", async () => {
    const task = raceForBestQuality([late(10, verified), late(20, uncertain)], options);
    await vi.advanceTimersByTimeAsync(30);
    await expect(task).resolves.toEqual(verified);
  });

  it("已验证最高档仍立即结束交错竞速", async () => {
    const next = vi.fn(() => late(2000, verified));
    const best = { ...verified, quality: "flac" };
    const task = raceStaggeredPriority([() => late(10, best), next], options);
    await vi.advanceTimersByTimeAsync(10);
    await expect(task).resolves.toEqual(best);
    expect(next).not.toHaveBeenCalled();
  });

  it("只有不确定地址时等到截止再交给实际播放器验证", async () => {
    const task = raceStaggeredPriority([() => late(10, uncertain), () => new Promise<Candidate>(() => {})], options);
    const resolved = vi.fn();
    void task.then(resolved);
    await vi.advanceTimersByTimeAsync(5999);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(task).resolves.toEqual(uncertain);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("所有候选已结算时可返回不确定地址而不空等截止", async () => {
    const task = raceForBestQuality([late(10, uncertain), late(200, null).then(() => { throw new Error("unavailable"); })], options);
    const resolved = vi.fn();
    void task.then(resolved);
    await vi.advanceTimersByTimeAsync(199);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(task).resolves.toEqual(uncertain);
    expect(vi.getTimerCount()).toBe(0);
  });
});
