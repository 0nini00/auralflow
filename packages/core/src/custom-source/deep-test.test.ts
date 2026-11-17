import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HiddenSourceSearcher, HiddenSourceTrack } from "../hidden-source";
import {
  buildCustomSourceDeepTestInitFailure,
  buildCustomSourceDeepTestTarget,
  planCustomSourceDeepTest,
  runCustomSourceDeepTestPlatforms,
  type CustomSourceDeepTestDeps,
  type CustomSourceDeepTestTarget,
} from "./deep-test";
import type { CustomSourceSourceInfo } from "./model";

const music = (qualitys: string[] = ["128k", "320k"]): CustomSourceSourceInfo => ({ type: "music", actions: ["musicUrl"], qualitys });
const kwTrack: HiddenSourceTrack = {
  source: "kw",
  id: "228908",
  name: "江南",
  singer: "林俊杰",
  albumName: "第二天堂",
  interval: 267,
  picUrl: "https://example.com/kw.jpg",
  extra: { rid: 228908 },
};

function searcher(id: "kw" | "kg", tracks: HiddenSourceTrack[]): HiddenSourceSearcher & { search: ReturnType<typeof vi.fn> } {
  return { id, search: vi.fn(async () => tracks) };
}

function deps(overrides: Partial<CustomSourceDeepTestDeps> = {}) {
  return {
    searchers: [searcher("kw", [kwTrack])],
    withTimeout: vi.fn(<T>(task: Promise<T>) => task) as unknown as CustomSourceDeepTestDeps["withTimeout"] & ReturnType<typeof vi.fn>,
    requestMusicUrl: vi.fn(async (_target: CustomSourceDeepTestTarget, quality: string) => ({ url: "https://example.com/song.mp3", quality })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("planCustomSourceDeepTest", () => {
  it("没有声明 musicUrl 时只验证初始化，直接判通过", () => {
    const sources = { local: { type: "music" as const, actions: ["lyric"], qualitys: [] } };
    const updateAlert = { log: "新版本" };
    expect(planCustomSourceDeepTest({ sources, updateAlert })).toEqual({
      platforms: [],
      verdict: { ok: true, message: "初始化正常；未声明 musicUrl，仅验证初始化", sources, updateAlert },
    });
    expect(planCustomSourceDeepTest({}).verdict).toMatchObject({ ok: true, sources: {} });
  });

  it("声明的平台都不在覆盖范围内时判未通过并说明原因", () => {
    const plan = planCustomSourceDeepTest({ sources: { local: music([]) } });
    expect(plan.platforms).toEqual([]);
    expect(plan.verdict).toMatchObject({ ok: false, message: "初始化正常；脚本只声明了 local，当前深度测试仅覆盖 wy/tx/kw/kg" });
  });

  it("待测平台按固定顺序 wy/tx/kw/kg 排列，与脚本声明顺序无关", () => {
    expect(planCustomSourceDeepTest({ sources: { kg: music(), local: music([]), wy: music(), tx: { ...music(), actions: [] } } })).toEqual({
      platforms: ["wy", "kg"],
      verdict: null,
    });
  });
});

describe("buildCustomSourceDeepTestTarget", () => {
  it("wy/tx 用固定曲目，不经过搜索", async () => {
    const d = deps();
    await expect(buildCustomSourceDeepTestTarget("wy", d)).resolves.toEqual({
      platform: "wy",
      music: { id: "2034742057", name: "江南", singer: "林俊杰", albumName: "第二天堂", source: "wy" },
    });
    await expect(buildCustomSourceDeepTestTarget("tx", d)).resolves.toMatchObject({ music: { id: "0039MnYb0qxYhV", source: "tx" } });
    expect(d.withTimeout).not.toHaveBeenCalled();
  });

  it("kw/kg 搜索同曲并把平台元数据放进 platformRequest", async () => {
    const kw = searcher("kw", [{ ...kwTrack, id: "other", name: "别的歌" }, kwTrack]);
    const d = deps({ searchers: [kw] });
    await expect(buildCustomSourceDeepTestTarget("kw", d, 4_000)).resolves.toEqual({
      platform: "kw",
      music: { id: "228908", name: "江南", singer: "林俊杰", albumName: "第二天堂", source: "tx", interval: 267, picUrl: "https://example.com/kw.jpg" },
      platformRequest: { source: "kw", songmid: "228908", interval: 267, albumName: "第二天堂", picUrl: "https://example.com/kw.jpg", extra: { rid: 228908 } },
    });
    expect(kw.search).toHaveBeenCalledWith("江南 林俊杰");
    expect(d.withTimeout).toHaveBeenCalledWith(expect.any(Promise), 4_000, "搜索测试曲目");
  });

  it("没有搜索实现或搜不到同曲时拒绝", async () => {
    await expect(buildCustomSourceDeepTestTarget("kg", deps())).rejects.toThrow("该平台没有可用的搜索实现");
    await expect(buildCustomSourceDeepTestTarget("kw", deps({ searchers: [searcher("kw", [])] }))).rejects.toThrow("未在平台搜到匹配的测试曲目");
  });
});

describe("runCustomSourceDeepTestPlatforms", () => {
  it("逐个平台取链并汇总，全部通过才算 ok", async () => {
    const sources = { wy: music(), kw: music() };
    const updateAlert = { log: "新版本" };
    const d = deps();
    const outcome = await runCustomSourceDeepTestPlatforms({ sources, updateAlert }, ["wy", "kw"], d);
    expect(outcome).toEqual({
      passed: 2,
      result: { ok: true, message: "初始化正常；取链测试 2/2 通过（wy 通过:128k；kw 通过:128k）", sources, updateAlert },
    });
    expect(d.requestMusicUrl).toHaveBeenNthCalledWith(1, expect.objectContaining({ platform: "wy" }), "128k");
    expect(d.requestMusicUrl).toHaveBeenNthCalledWith(2, expect.objectContaining({ platform: "kw", platformRequest: expect.objectContaining({ source: "kw" }) }), "128k");
  });

  it("128k 不在声明里时退回声明的第一个音质，未声明音质时仍用 128k", async () => {
    const d = deps();
    await runCustomSourceDeepTestPlatforms({ sources: { wy: music(["320k", "flac"]), tx: music([]) } }, ["wy", "tx"], d);
    expect(d.requestMusicUrl).toHaveBeenNthCalledWith(1, expect.anything(), "320k");
    expect(d.requestMusicUrl).toHaveBeenNthCalledWith(2, expect.anything(), "128k");
  });

  it("单个平台失败只记在该平台上，错误详情压成一行并截断", async () => {
    const d = deps({
      searchers: [],
      requestMusicUrl: vi.fn(async (target: CustomSourceDeepTestTarget) => {
        if (target.platform === "wy") throw new Error(`第一行\n  第二行 ${"x".repeat(200)}`);
        return { url: "blob:not-playable", quality: "" };
      }),
    });
    const { passed, result } = await runCustomSourceDeepTestPlatforms({ sources: { wy: music(), tx: music(), kg: music() } }, ["wy", "tx", "kg"], d);
    expect(passed).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      `初始化正常；取链测试 0/3 通过（wy 失败:取链失败：第一行 第二行 ${"x".repeat(160 - "第一行 第二行 ".length)}...；` +
        "tx 失败:取链失败：未返回可播放 URL：blob:not-playable；kg 失败:搜索测试曲目失败：该平台没有可用的搜索实现）",
    );
  });

  it("部分通过时 ok 为 false 但 passed 如实返回", async () => {
    const d = deps({
      requestMusicUrl: vi.fn(async (target: CustomSourceDeepTestTarget, quality: string) => {
        if (target.platform === "tx") throw "脚本抛了字符串";
        return { url: "https://example.com/a.mp3", quality };
      }),
    });
    const { passed, result } = await runCustomSourceDeepTestPlatforms({ sources: { wy: music(), tx: music() } }, ["wy", "tx"], d);
    expect(passed).toBe(1);
    expect(result).toMatchObject({ ok: false, message: "初始化正常；取链测试 1/2 通过（wy 通过:128k；tx 失败:取链失败：脚本抛了字符串）" });
  });

  it("总预算按剩余平台均摊，单平台取链不超过 20s，搜索不超过 6s", async () => {
    const one = deps();
    await runCustomSourceDeepTestPlatforms({ sources: { kw: music() } }, ["kw"], one);
    expect(one.withTimeout).toHaveBeenNthCalledWith(1, expect.any(Promise), 6_000, "搜索测试曲目");
    expect(one.withTimeout).toHaveBeenNthCalledWith(2, expect.any(Promise), 20_000, "取链测试");

    const four = deps();
    await runCustomSourceDeepTestPlatforms({ sources: { wy: music(), tx: music(), kw: music(), kg: music() } }, ["wy", "tx"], four);
    // 两个平台：60s / 2 = 30s，封顶 25s 的平台预算，再封顶 20s 的取链预算
    expect(four.withTimeout).toHaveBeenNthCalledWith(1, expect.any(Promise), 20_000, "取链测试");
  });

  it("慢平台耗掉的时间从后续平台的预算里扣，耗尽后剩余平台记为未测试", async () => {
    const d = deps({
      requestMusicUrl: vi.fn(async (target: CustomSourceDeepTestTarget, quality: string) => {
        // wy 用掉 50s，tx 再用掉 10s：轮到 kw 时 60s 总预算已耗尽
        vi.setSystemTime(Date.now() + (target.platform === "wy" ? 50_000 : 10_000));
        return { url: "https://example.com/a.mp3", quality };
      }),
    });
    const { passed, result } = await runCustomSourceDeepTestPlatforms({ sources: { wy: music(), tx: music(), kw: music() } }, ["wy", "tx", "kw"], d);
    // tx 只剩 10s：均摊值 5s 即最低平台预算
    expect(d.withTimeout).toHaveBeenNthCalledWith(2, expect.any(Promise), 5_000, "取链测试");
    expect(passed).toBe(2);
    expect(result.message).toContain("kw 失败:未测试（总预算耗尽）");
    expect(d.requestMusicUrl).toHaveBeenCalledTimes(2);
  });

  it("搜索耗尽平台预算后不再取链", async () => {
    const kw = searcher("kw", [kwTrack]);
    kw.search.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 25_000);
      return [kwTrack];
    });
    const d = deps({ searchers: [kw] });
    const { result } = await runCustomSourceDeepTestPlatforms({ sources: { kw: music() } }, ["kw"], d);
    expect(result.message).toContain("kw 失败:取链失败：总预算耗尽");
    expect(d.requestMusicUrl).not.toHaveBeenCalled();
  });

  it("超时守卫的拒绝按取链失败记录", async () => {
    const d = deps({
      withTimeout: ((_task: Promise<unknown>, timeoutMs: number, label: string) =>
        Promise.reject(new Error(`${label}超时（${timeoutMs}ms）`))) as CustomSourceDeepTestDeps["withTimeout"],
    });
    const { result } = await runCustomSourceDeepTestPlatforms({ sources: { wy: music() } }, ["wy"], d);
    expect(result.message).toContain("wy 失败:取链失败：取链测试超时（20000ms）");
  });

  it("操作被取消时原样抛出，不记成某个平台测试失败", async () => {
    const cancelled = new Error("已取消");
    let active = true;
    const d = deps({
      requestMusicUrl: vi.fn(async () => {
        active = false;
        throw new Error("脚本请求被中断");
      }),
      assertActive: () => {
        if (!active) throw cancelled;
      },
    });
    await expect(runCustomSourceDeepTestPlatforms({ sources: { wy: music(), tx: music() } }, ["wy", "tx"], d)).rejects.toBe(cancelled);
    expect(d.requestMusicUrl).toHaveBeenCalledTimes(1);
  });

  it("搜索阶段被取消同样抛出", async () => {
    const cancelled = new Error("已取消");
    const kw = searcher("kw", [kwTrack]);
    let active = true;
    kw.search.mockImplementation(async () => {
      active = false;
      return [kwTrack];
    });
    const d = deps({
      searchers: [kw],
      assertActive: () => {
        if (!active) throw cancelled;
      },
    });
    await expect(runCustomSourceDeepTestPlatforms({ sources: { kw: music() } }, ["kw"], d)).rejects.toBe(cancelled);
    expect(d.requestMusicUrl).not.toHaveBeenCalled();
  });
});

describe("buildCustomSourceDeepTestInitFailure", () => {
  it("把初始化错误写进结果，不带能力清单", () => {
    expect(buildCustomSourceDeepTestInitFailure(new Error("自定义音源初始化超时"))).toEqual({
      ok: false,
      message: "初始化失败：自定义音源初始化超时",
      sources: undefined,
      updateAlert: undefined,
    });
    expect(buildCustomSourceDeepTestInitFailure("字符串错误").message).toBe("初始化失败：字符串错误");
  });
});
