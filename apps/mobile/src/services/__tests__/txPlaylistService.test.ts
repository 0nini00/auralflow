import { describe, expect, it, vi } from "vitest";
import {
  getTxPlaylistDetail,
  mapTxPlaylistResult,
  mapTxPlaylistSong,
  resolveTxSongUrl,
  searchTxPlaylists,
} from "@/services/txPlaylistService";

describe("tx playlist service", () => {
  it("maps QQ playlist search items to mobile search playlist results", () => {
    expect(mapTxPlaylistResult({
      dissid: "123",
      dissname: "华语精选",
      creator: { name: "QQ 编辑" },
      imgurl: "//y.qq.com/cover.jpg",
      song_count: "25",
      listennum: 120000,
    })).toEqual({
      id: "123",
      name: "华语精选",
      creatorName: "QQ 编辑",
      coverUrl: "https://y.qq.com/cover.jpg",
      trackCount: 25,
      playCount: 120000,
      source: "tx",
    });
  });

  it("maps QQ playlist tracks to playable mobile music info", () => {
    expect(mapTxPlaylistSong({
      songmid: "song-mid",
      songname: "歌曲名",
      singer: [{ name: "歌手 A" }, { name: "歌手 B" }],
      albumname: "专辑名",
      interval: 245,
      albummid: "album-mid",
      file: { media_mid: "media-mid", size_320mp3: 1 },
    })).toEqual({
      id: "song-mid",
      name: "歌曲名",
      singer: "歌手 A、歌手 B",
      albumName: "专辑名",
      source: "tx",
      interval: 245,
      quality: "320k",
      picUrl: "https://y.gtimg.cn/music/photo_new/T002R300x300M000album-mid.jpg",
      img: "https://y.gtimg.cn/music/photo_new/T002R300x300M000album-mid.jpg",
    });
  });

  it("searches QQ playlists through the mobile musicu endpoint", async () => {
    const fetchJson = vi.fn(async () => ({
      body: {
        item_song: [
          { dissid: "123", dissname: "华语精选", creator: { nick: "QQ 编辑" } },
        ],
      },
    }));

    await expect(searchTxPlaylists("周杰伦", { fetchJson })).resolves.toEqual([
      {
        id: "123",
        name: "华语精选",
        creatorName: "QQ 编辑",
        coverUrl: undefined,
        trackCount: undefined,
        playCount: undefined,
        source: "tx",
      },
    ]);
    expect(fetchJson).toHaveBeenCalledWith(
      "https://u.y.qq.com/cgi-bin/musicu.fcg",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("resolves QQ playlist songs through vkey", async () => {
    const fetchJson = vi.fn(async () => ({
      req_0: {
        data: {
          midurlinfo: [{ purl: "C400song-mid.m4a" }],
          sip: ["https://dl.stream.qqmusic.qq.com/"],
        },
      },
    }));

    await expect(resolveTxSongUrl({ id: "song-mid", source: "tx" }, { fetchJson })).resolves.toBe("https://dl.stream.qqmusic.qq.com/C400song-mid.m4a");
    expect(fetchJson).toHaveBeenCalledWith(
      "https://u.y.qq.com/cgi-bin/musicu.fcg",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("loads QQ playlist detail with legacy API first", async () => {
    const fetchJson = vi.fn(async () => ({
      cdlist: [
        {
          songlist: [
            { songmid: "song-mid", songname: "歌曲名", singer: [{ name: "歌手" }] },
          ],
        },
      ],
    }));

    await expect(getTxPlaylistDetail({ id: "123", name: "华语精选", source: "tx" }, { fetchJson })).resolves.toMatchObject([
      { id: "song-mid", name: "歌曲名", source: "tx" },
    ]);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("fcg_ucc_getcdinfo_byids_cp.fcg"),
      undefined
    );
  });
});
