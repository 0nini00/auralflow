import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo, SearchPage } from "@lx/core";

const api = vi.hoisted(() => ({ fetch: vi.fn(), warn: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: api.fetch }));
vi.mock("@/services/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: api.warn, error: vi.fn() },
}));

import {
  resolveBuiltinMusicApiUrl,
  searchBuiltinMusicApiSongs,
} from "../src/services/builtinMusicApiClient";
import { searchSongsPage } from "../src/services/search/searchSongsPage";

const textResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const primarySong = { id: "1", name: "主链", singer: "歌手", source: "wy" } as MusicInfo;
const page = (result: MusicInfo[]): SearchPage<MusicInfo[]> => ({ result, hasMore: false });
const gatewayPage = async (): Promise<SearchPage<MusicInfo[]>> =>
  page(await searchBuiltinMusicApiSongs("netease", "alpha", 1, 30, "wy"));

beforeEach(() => {
  api.fetch.mockReset();
  api.warn.mockReset();
});

describe("桌面网关客户端复用 @lx/core 的实现", () => {
  it("数组响应映射为歌曲，并带上后续解析要用的 gateway 身份", async () => {
    api.fetch.mockResolvedValue(textResponse([
      { id: 7, name: "Song", artist: ["A", "B"], album: "Album", source: "netease", pic_id: "p7" },
      { id: "", name: "无 id 的条目被丢弃" },
    ]));

    const songs = await searchBuiltinMusicApiSongs("netease", "alpha", 2, 30, "wy");

    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      id: "7",
      name: "Song",
      singer: "A、B",
      source: "wy",
      gateway: { source: "netease", trackId: "7", lyricId: "7", picId: "p7" },
    });
    const requested = new URL(api.fetch.mock.calls[0][0]);
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({
      types: "search", source: "netease", name: "alpha", count: "30", pages: "2",
    });
  });

  it("非数组响应是网关异常：抛错，而不是伪装成空结果", async () => {
    api.fetch.mockResolvedValue(textResponse({ code: 429, msg: "rate limited" }));

    await expect(searchBuiltinMusicApiSongs("netease", "alpha", 1, 30, "wy"))
      .rejects.toThrow(/内置音乐 API 搜索响应异常.*rate limited/);
  });

  it("取链沿用 core 的档位换算：网关回更低码率时诚实降档", async () => {
    api.fetch.mockResolvedValue(textResponse({ url: "https://cdn.example/a.mp3", br: 128 }));

    const resolved = await resolveBuiltinMusicApiUrl(primarySong, "flac");

    expect(resolved).toEqual({ url: "https://cdn.example/a.mp3", quality: "128k" });
    expect(new URL(api.fetch.mock.calls[0][0]).searchParams.get("br")).toBe("740");
  });
});

describe("网关异常在搜索编排里的去向", () => {
  it("主链为空时网关异常直接上抛，搜索页显示错误而不是「无结果」", async () => {
    api.fetch.mockResolvedValue(textResponse({ code: 500, msg: "boom" }));

    await expect(searchSongsPage(async () => page([]), gatewayPage))
      .rejects.toThrow(/内置音乐 API 搜索响应异常/);
  });

  it("主链有结果时网关只是元数据增强：保留主链结果，但失败写入日志", async () => {
    api.fetch.mockResolvedValue(textResponse({ code: 500, msg: "boom" }));

    const result = await searchSongsPage(async () => page([primarySong]), gatewayPage);

    expect(result.songs).toEqual([primarySong]);
    expect(api.warn).toHaveBeenCalledTimes(1);
    expect(api.warn.mock.calls[0][0]).toContain("元数据来源失败");
    expect(String(api.warn.mock.calls[0][1])).toContain("内置音乐 API 搜索响应异常");
  });

  it("主链失败、网关可用时返回网关结果，主链错误写入日志", async () => {
    api.fetch.mockResolvedValue(textResponse([{ id: 9, name: "Gateway" }]));

    const result = await searchSongsPage(async () => { throw new Error("official down"); }, gatewayPage);

    expect(result.songs?.map((song) => song.id)).toEqual(["9"]);
    expect(api.warn).toHaveBeenCalledTimes(1);
    expect(String(api.warn.mock.calls[0][1])).toContain("official down");
  });
});
