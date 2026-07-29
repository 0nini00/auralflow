import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";

import { getLyrics } from "@/services/musicApi";

function localSong(localLyrics?: string): MusicInfo {
  return {
    id: "local-1",
    name: "本地歌曲",
    singer: "本地歌手",
    albumName: "本地专辑",
    source: "local",
    isLocal: true,
    url: "file:///music/local.mp3",
    localLyrics,
  };
}

describe("local music lyrics integration", () => {
  it("uses app-managed local lyrics before trying remote lyric providers", async () => {
    await expect(getLyrics(localSong("[00:01.00]第一句\n[00:02.00]第二句"))).resolves.toEqual([
      { time: 1, text: "第一句", tr: undefined },
      { time: 2, text: "第二句", tr: undefined },
    ]);
  });

  it("treats plain local lyrics as a displayable line", async () => {
    await expect(getLyrics(localSong("纯文本歌词"))).resolves.toEqual([
      { time: 0, text: "纯文本歌词", tr: undefined },
    ]);
  });
});
