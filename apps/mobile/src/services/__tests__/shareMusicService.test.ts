import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  buildMusicShareLink,
  buildMusicSharePayload,
  buildMusicShareText,
} from "@/services/shareMusicService";

function song(source: MusicInfo["source"], id: string): MusicInfo {
  return {
    id,
    name: "歌曲名",
    singer: "歌手名",
    albumName: "专辑名",
    source,
  };
}

describe("share music service", () => {
  it("builds platform share links", () => {
    expect(buildMusicShareLink(song("wy", "123"))).toBe("https://music.163.com/#/song?id=123");
    expect(buildMusicShareLink(song("tx", "0039MnYb0qxYhV"))).toBe("https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV");
    expect(buildMusicShareLink(song("bili", "BV1xx411c7mD"))).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(buildMusicShareLink(song("local", "local-id"))).toBeNull();
  });

  it("falls back to song title and artist when no public link is available", () => {
    expect(buildMusicShareText(song("local", "local-id"))).toBe("歌曲名 - 歌手名");
  });

  it("builds React Native Share payload", () => {
    expect(buildMusicSharePayload(song("wy", "123"))).toEqual({
      title: "分享歌曲",
      message: "https://music.163.com/#/song?id=123",
      url: "https://music.163.com/#/song?id=123",
    });
  });
});
