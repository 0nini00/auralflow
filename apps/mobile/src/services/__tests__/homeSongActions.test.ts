import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import { buildHomeSongActions } from "@/services/homeSongActions";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source: "wy",
  };
}

describe("home song actions", () => {
  it("uses recent history as the preview and keeps the full play all queue", () => {
    const history = Array.from({ length: 12 }, (_, index) => song(String(index + 1)));

    const model = buildHomeSongActions(history);

    expect(model.title).toBe("最近播放");
    expect(model.showPlayAll).toBe(true);
    expect(model.songs.map((item) => item.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(model.playAllSongs.map((item) => item.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
    expect(model.showViewAll).toBe(true);
    expect(model.viewAllLabel).toBe("查看全部");
  });

  it("hides view all when history fits in the preview", () => {
    const history = Array.from({ length: 3 }, (_, index) => song(String(index + 1)));
    const model = buildHomeSongActions(history);
    expect(model.showViewAll).toBe(false);
    expect(model.songs).toHaveLength(3);
  });

  it("shows the recent playback empty state without fallback songs", () => {
    const model = buildHomeSongActions([]);

    expect(model.title).toBe("最近播放");
    expect(model.showPlayAll).toBe(false);
    expect(model.songs).toEqual([]);
    expect(model.playAllSongs).toEqual([]);
    expect(model.showViewAll).toBe(false);
    expect(model.emptyText).toBe("还没有播放过歌曲");
  });
});
