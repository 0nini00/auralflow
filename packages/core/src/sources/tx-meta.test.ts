import { describe, expect, it, vi } from "vitest";
import {
  TX_SONG_DETAIL_API,
  extractTxTrackMeta,
  fetchTxTrackMeta,
} from "./tx-meta";

describe("extractTxTrackMeta", () => {
  it("从歌单/搜索条目提取媒体 mid、专辑 mid 与数字 songId", () => {
    expect(
      extractTxTrackMeta({
        id: 97773,
        mid: "0039MnYb0qxYhV",
        album: { mid: "000MkMni19ClKG" },
        file: { media_mid: "003Qui1q2u1Zho" },
      }),
    ).toEqual({
      strMediaMid: "003Qui1q2u1Zho",
      albumMid: "000MkMni19ClKG",
      songId: "97773",
    });
  });

  it("没有 file 时退回条目自身的 media_mid / strMediaMid", () => {
    expect(extractTxTrackMeta({ media_mid: "media" })).toEqual({ strMediaMid: "media" });
    expect(extractTxTrackMeta({ strMediaMid: "media" })).toEqual({ strMediaMid: "media" });
  });
});

describe("fetchTxTrackMeta", () => {
  it("按 songmid 查询歌曲详情并提取媒体元数据", async () => {
    const fetchJson = vi.fn(async () => ({
      code: 0,
      request: {
        code: 0,
        data: {
          track_info: {
            id: 97773,
            mid: "0039MnYb0qxYhV",
            album: { mid: "000MkMni19ClKG" },
            file: { media_mid: "003Qui1q2u1Zho" },
          },
        },
      },
    }));

    await expect(fetchTxTrackMeta(" 0039MnYb0qxYhV ", fetchJson)).resolves.toEqual({
      strMediaMid: "003Qui1q2u1Zho",
      albumMid: "000MkMni19ClKG",
      songId: "97773",
    });
    expect(fetchJson).toHaveBeenCalledWith(
      TX_SONG_DETAIL_API,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"song_mid":"0039MnYb0qxYhV"'),
      }),
    );
  });

  it("兼容 songinfo.data 包裹并拒绝非零业务码", async () => {
    const wrapped = vi.fn(async () => ({
      code: 0,
      songinfo: { data: { track_info: { file: { media_mid: "m" } } } },
    }));
    await expect(fetchTxTrackMeta("mid", wrapped)).resolves.toEqual({ strMediaMid: "m" });

    const failed = vi.fn(async () => ({ code: 1000, request: { code: 1000 } }));
    await expect(fetchTxTrackMeta("mid", failed)).rejects.toThrow("code=1000");
  });

  it("空 songmid 不发请求", async () => {
    const fetchJson = vi.fn();
    await expect(fetchTxTrackMeta("   ", fetchJson)).resolves.toBeUndefined();
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
