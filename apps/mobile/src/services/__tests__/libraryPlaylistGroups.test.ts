import { describe, expect, it } from "vitest";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import { buildWyPlaylistGroups } from "@/services/libraryPlaylistGroups";

function playlist(id: string, subscribed?: boolean): WyPlaylistInfo {
  return {
    id,
    name: `歌单-${id}`,
    author: "user",
    source: "wy",
    trackCount: 1,
    subscribed,
  };
}

describe("library playlist groups", () => {
  it("splits WY playlists into owned and collected groups while preserving order", () => {
    const groups = buildWyPlaylistGroups([
      playlist("owned-1", false),
      playlist("collected-1", true),
      playlist("legacy-owned"),
      playlist("collected-2", true),
    ]);

    expect(groups).toEqual([
      {
        key: "owned",
        title: "网易云自建歌单",
        count: 2,
        playlists: [playlist("owned-1", false), playlist("legacy-owned")],
        emptyText: "还没有网易云自建歌单",
      },
      {
        key: "collected",
        title: "收藏的歌单",
        count: 2,
        playlists: [playlist("collected-1", true), playlist("collected-2", true)],
        emptyText: "还没有收藏的网易云歌单",
      },
    ]);
  });
});
