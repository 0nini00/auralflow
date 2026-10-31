import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";
import { createCustomSourceAccess } from "../src/services/customSourceAccess";

const fixture = vi.hoisted(() => ({
  store: {
    featureEnabled: true,
    featureReady: true,
    sources: [] as Array<Record<string, unknown>>,
  },
  search: vi.fn(),
  requestMusicUrl: vi.fn(),
  probe: vi.fn(),
  logs: [] as string[],
  ready: Promise.resolve(),
}));

vi.mock("../src/services/sources/hidden/hiddenSearchers", () => ({
  hiddenSourceSearchers: [{ id: "kw", search: (keyword: string) => fixture.search(keyword) }],
}));
vi.mock("../src/services/customSourceRuntime", () => ({
  requestCustomSourceMusicUrl: (...args: unknown[]) => fixture.requestMusicUrl(...args),
}));
vi.mock("../src/services/playback/streamProbe", () => ({
  probeStreamUrl: (...args: unknown[]) => fixture.probe(...args),
}));
vi.mock("../src/stores/customSourceStore", () => ({
  useCustomSourceStore: { getState: () => fixture.store },
  customSourcePersistence: { ready: fixture.ready },
}));
vi.mock("@lx/tauri-bridge", () => ({
  debugLog: (message: string) => {
    fixture.logs.push(message);
  },
}));

import {
  resolveHiddenFromGroups,
  startHiddenSearch,
  type HiddenCandidateGroup,
} from "../src/services/playback/hiddenFallbackService";

const song: MusicInfo = {
  id: "2034742057",
  source: "wy",
  name: "江南",
  singer: "林俊杰",
  interval: 267,
};

function kwSource(qualitys: string[] = ["320k"]): Record<string, unknown> {
  return {
    id: "kw-script",
    name: "酷我源",
    enabled: true,
    sources: { kw: { actions: ["musicUrl"], qualitys } },
  };
}

function kwTrack(id: string, singer: string, interval?: number) {
  return { source: "kw" as const, id, name: "江南", singer, interval };
}

let access: ReturnType<typeof createCustomSourceAccess>;

beforeEach(() => {
  access = createCustomSourceAccess(() => true);
  fixture.store = { featureEnabled: true, featureReady: true, sources: [kwSource()] };
  fixture.search.mockReset();
  fixture.requestMusicUrl.mockReset();
  fixture.probe.mockReset();
  // 默认候选地址可用：绝大多数用例不关心候选内层探活。
  fixture.probe.mockResolvedValue({ ok: true });
});

afterEach(() => {
  access.invalidate();
});

describe("隐藏兜底：搜索阶段", () => {
  it("没有脚本声明对应平台时不发起搜索", async () => {
    fixture.store.sources = [];

    const groups = await startHiddenSearch(song, Date.now() + 5_000);

    expect(groups).toEqual([]);
    expect(fixture.search).not.toHaveBeenCalled();
    expect(fixture.requestMusicUrl).not.toHaveBeenCalled();
  });

  it("功能关闭时不发起搜索", async () => {
    fixture.store.featureEnabled = false;

    await expect(startHiddenSearch(song, Date.now() + 5_000)).resolves.toEqual([]);
    expect(fixture.search).not.toHaveBeenCalled();
  });

  it("按歌名 / 歌手 / 时长严格匹配，搜索阶段不触碰脚本", async () => {
    fixture.search.mockResolvedValue([
      kwTrack("93157", "林俊杰", 267),
      kwTrack("2", "其他歌手", 267),
      kwTrack("3", "林俊杰", 300),
    ]);

    const groups = await startHiddenSearch(song, Date.now() + 5_000);

    expect(groups).toHaveLength(1);
    expect(groups[0].platform).toBe("kw");
    expect(groups[0].tracks.map((track) => track.id)).toEqual(["93157"]);
    expect(fixture.requestMusicUrl).not.toHaveBeenCalled();
  });

  it("预算不足时直接返回空结果，不发起搜索", async () => {
    await expect(startHiddenSearch(song, Date.now() - 5_000)).resolves.toEqual([]);
    expect(fixture.search).not.toHaveBeenCalled();
  });
});

describe("隐藏兜底：取链阶段", () => {
  async function groupsOf(): Promise<HiddenCandidateGroup[]> {
    fixture.search.mockResolvedValue([kwTrack("93157", "林俊杰", 267)]);
    return startHiddenSearch(song, Date.now() + 5_000);
  }

  it("用调用方令牌取链，保留原曲并回传平台元数据", async () => {
    const operation = access.capture();
    fixture.requestMusicUrl.mockResolvedValue({
      url: "https://kw.example/a.mp3",
      quality: "320k",
    });

    const resolved = await resolveHiddenFromGroups(
      await groupsOf(),
      song,
      ["320k"],
      Date.now() + 5_000,
      operation,
    );

    expect(resolved).toMatchObject({
      url: "https://kw.example/a.mp3",
      quality: "320k",
      backend: "hiddenSource",
      resolverName: "kw/酷我源",
    });
    // UI / 歌词 / 历史都保持用户点的歌
    expect(resolved?.music).toBe(song);

    const [apiArg, musicArg, qualityArg, operationArg, alertArg, platformArg] =
      fixture.requestMusicUrl.mock.calls[0];
    expect(apiArg).toMatchObject({ id: "kw-script" });
    expect(musicArg).toBe(song);
    expect(qualityArg).toBe("320k");
    // 取链与结果校验必须是同一个令牌
    expect(operationArg).toBe(operation);
    expect(alertArg).toBeUndefined();
    expect(platformArg).toMatchObject({ source: "kw", songmid: "93157", interval: 267 });
  });

  it("令牌已失效时不再调脚本", async () => {
    const operation = access.capture();
    access.invalidate();

    const resolved = await resolveHiddenFromGroups(
      await groupsOf(),
      song,
      ["320k"],
      Date.now() + 5_000,
      operation,
    );

    expect(resolved).toBeNull();
    expect(fixture.requestMusicUrl).not.toHaveBeenCalled();
  });

  it("预算耗尽时不再调脚本", async () => {
    const resolved = await resolveHiddenFromGroups(
      await groupsOf(),
      song,
      ["320k"],
      Date.now() - 5_000,
      access.capture(),
    );

    expect(resolved).toBeNull();
    expect(fixture.requestMusicUrl).not.toHaveBeenCalled();
  });

  it("脚本失败时换下一个候选，全部失败返回 null", async () => {
    fixture.search.mockResolvedValue([
      kwTrack("93157", "林俊杰", 267),
      kwTrack("93158", "林俊杰", 267),
    ]);
    fixture.requestMusicUrl
      .mockRejectedValueOnce(new Error("脚本不支持 kw"))
      .mockResolvedValueOnce({ url: "https://kw.example/b.mp3", quality: "320k" });

    const resolved = await resolveHiddenFromGroups(
      await startHiddenSearch(song, Date.now() + 5_000),
      song,
      ["320k"],
      Date.now() + 5_000,
      access.capture(),
    );

    expect(resolved?.url).toBe("https://kw.example/b.mp3");
    expect(fixture.requestMusicUrl).toHaveBeenCalledTimes(2);
  });

  it("候选地址被判死链时换下一个候选，而不是把结果定稿", async () => {
    fixture.search.mockResolvedValue([
      kwTrack("93157", "林俊杰", 267),
      kwTrack("93158", "林俊杰", 267),
    ]);
    fixture.requestMusicUrl
      .mockResolvedValueOnce({ url: "https://kw.example/dead.mp3", quality: "320k" })
      .mockResolvedValueOnce({ url: "https://kw.example/alive.mp3", quality: "320k" });
    fixture.probe
      .mockResolvedValueOnce({ ok: false, definitive: true, reason: "HTTP 403" })
      .mockResolvedValueOnce({ ok: true });

    const resolved = await resolveHiddenFromGroups(
      await startHiddenSearch(song, Date.now() + 5_000),
      song,
      ["320k"],
      Date.now() + 5_000,
      access.capture(),
    );

    expect(resolved?.url).toBe("https://kw.example/alive.mp3");
    expect(fixture.requestMusicUrl).toHaveBeenCalledTimes(2);
    expect(fixture.probe).toHaveBeenCalledTimes(2);
    // 死链那条不能出现在成功的 trace 里
    expect(resolved?.trace.at(-1)).toMatchObject({ status: "success" });
  });

  it("探活无结论（超时 / 抖动 / 5xx）时不否掉候选", async () => {
    fixture.requestMusicUrl.mockResolvedValue({
      url: "https://kw.example/slow.mp3",
      quality: "320k",
    });
    fixture.probe.mockResolvedValue({ ok: false, definitive: false, reason: "无响应（>2.5s）" });

    const resolved = await resolveHiddenFromGroups(
      await groupsOf(),
      song,
      ["320k"],
      Date.now() + 5_000,
      access.capture(),
    );

    expect(resolved?.url).toBe("https://kw.example/slow.mp3");
    expect(fixture.requestMusicUrl).toHaveBeenCalledTimes(1);
  });
});
