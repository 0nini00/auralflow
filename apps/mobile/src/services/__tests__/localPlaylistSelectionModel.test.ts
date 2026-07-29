import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import type { LocalPlaylist } from "@/services/localPlaylistModel";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import {
  buildOwnedWyPlaylistSongOptions,
  buildLocalPlaylistSongOptions,
  getAddToWyPlaylistEmptyText,
  getAddToLocalPlaylistEmptyText,
} from "@/services/localPlaylistSelectionModel";

function song(id: string, source: MusicInfo["source"] = "wy"): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source,
  };
}

function playlist(id: string, name: string, songs: MusicInfo[]): LocalPlaylist {
  return {
    id,
    name,
    songs,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function wyPlaylist(id: string, name: string, subscribed: boolean, trackCount = 0): WyPlaylistInfo {
  return {
    id,
    name,
    author: "me",
    source: "wy",
    trackCount,
    subscribed,
  };
}

describe("local playlist selection model", () => {
  it("marks playlists that already contain the song by source and id", () => {
    const target = song("1", "wy");
    const options = buildLocalPlaylistSongOptions([
      playlist("local-1", "已添加", [target]),
      playlist("local-2", "同 id 不同来源", [song("1", "tx")]),
      playlist("local-3", "空歌单", []),
    ], target);

    expect(options).toEqual([
      { id: "local-1", name: "已添加", trackCount: 1, containsSong: true },
      { id: "local-2", name: "同 id 不同来源", trackCount: 1, containsSong: false },
      { id: "local-3", name: "空歌单", trackCount: 0, containsSong: false },
    ]);
  });

  it("returns clear empty text for no playlists and all-added states", () => {
    expect(getAddToLocalPlaylistEmptyText([])).toBe("还没有本地歌单，请先在我的音乐中新建");
    expect(getAddToLocalPlaylistEmptyText([
      { id: "local-1", name: "默认", trackCount: 1, containsSong: true },
    ])).toBe("这首歌已在全部本地歌单中");
    expect(getAddToLocalPlaylistEmptyText([
      { id: "local-1", name: "默认", trackCount: 0, containsSong: false },
    ])).toBeNull();
  });

  it("builds owned WY playlist options only for WY songs", () => {
    expect(buildOwnedWyPlaylistSongOptions([
      wyPlaylist("owned-1", "自建歌单", false, 2),
      wyPlaylist("sub-1", "收藏歌单", true, 5),
    ], song("1", "wy"))).toEqual([
      { id: "owned-1", name: "自建歌单", trackCount: 2 },
    ]);

    expect(buildOwnedWyPlaylistSongOptions([
      wyPlaylist("owned-1", "自建歌单", false, 2),
    ], song("1", "tx"))).toEqual([]);
  });

  it("returns clear empty text for WY playlist add states", () => {
    expect(getAddToWyPlaylistEmptyText([], song("1", "wy"))).toBe("暂无网易云自建歌单");
    expect(getAddToWyPlaylistEmptyText([], song("1", "tx"))).toBe("仅网易云歌曲可添加到网易云歌单");
    expect(getAddToWyPlaylistEmptyText([
      { id: "owned-1", name: "自建歌单", trackCount: 2 },
    ], song("1", "wy"))).toBeNull();
  });
});
