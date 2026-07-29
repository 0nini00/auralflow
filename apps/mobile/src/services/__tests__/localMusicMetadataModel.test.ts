import { describe, expect, it } from "vitest";

import { buildLocalMusicMetadataUpdate } from "@/services/localMusicMetadataModel";

describe("local music metadata model", () => {
  it("trims editable local music metadata", () => {
    expect(buildLocalMusicMetadataUpdate({
      name: "  新标题  ",
      singer: "  新歌手  ",
      albumName: "  新专辑  ",
      coverUrl: "  https://img.example/cover.jpg  ",
      localLyrics: "  [00:01.00]第一句歌词  ",
    })).toEqual({
      name: "新标题",
      singer: "新歌手",
      albumName: "新专辑",
      picUrl: "https://img.example/cover.jpg",
      img: "https://img.example/cover.jpg",
      localLyrics: "[00:01.00]第一句歌词",
    });
  });

  it("keeps local music display usable when optional fields are blank", () => {
    expect(buildLocalMusicMetadataUpdate({
      name: "本地歌曲",
      singer: " ",
      albumName: " ",
      coverUrl: " ",
      localLyrics: " ",
    })).toEqual({
      name: "本地歌曲",
      singer: "未知艺术家",
      albumName: "未知专辑",
      picUrl: undefined,
      img: undefined,
      localLyrics: undefined,
    });
  });

  it("rejects blank titles", () => {
    expect(() => buildLocalMusicMetadataUpdate({
      name: " ",
      singer: "歌手",
      albumName: "专辑",
    })).toThrow("歌曲标题不能为空");
  });
});
