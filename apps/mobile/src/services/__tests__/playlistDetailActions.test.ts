import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  buildPlaylistDetailActions,
  canRemoveSongsFromPlaylistDetail,
  findPlaylistCurrentSongIndex,
  shufflePlaylistSongs,
} from "@/services/playlistDetailActions";

function song(id: string, source: MusicInfo["source"] = "wy"): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source,
  };
}

describe("playlist detail actions", () => {
  it("shows play actions only when the playlist has songs", () => {
    expect(buildPlaylistDetailActions(0)).toEqual({
      show: false,
      playAllLabel: "播放全部",
      shuffleLabel: "随机播放",
      showRefresh: false,
      refreshLabel: "刷新",
    });
    expect(buildPlaylistDetailActions(3)).toEqual({
      show: true,
      playAllLabel: "播放全部",
      shuffleLabel: "随机播放",
      showRefresh: false,
      refreshLabel: "刷新",
    });
  });

  it("shows refresh actions for supported remote playlists", () => {
    expect(buildPlaylistDetailActions(0, { source: "wy", refreshing: false })).toMatchObject({
      showRefresh: true,
      refreshLabel: "刷新",
    });
    expect(buildPlaylistDetailActions(3, { source: "tx", refreshing: true })).toMatchObject({
      showRefresh: true,
      refreshLabel: "刷新中",
    });
    expect(buildPlaylistDetailActions(3, { source: "local", refreshing: false })).toMatchObject({
      showRefresh: false,
      refreshLabel: "刷新",
    });
  });

  it("allows removing songs only from owned WY playlist details", () => {
    expect(canRemoveSongsFromPlaylistDetail({ source: "wy", subscribed: false })).toBe(true);
    expect(canRemoveSongsFromPlaylistDetail({ source: "wy", subscribed: true })).toBe(false);
    expect(canRemoveSongsFromPlaylistDetail({ source: "tx", subscribed: false })).toBe(false);
    expect(canRemoveSongsFromPlaylistDetail({ source: "local", subscribed: false })).toBe(false);
  });

  it("finds the current song by source and id", () => {
    const songs = [song("1"), song("2", "tx"), song("2", "wy")];

    expect(findPlaylistCurrentSongIndex(songs, song("2", "wy"))).toBe(2);
    expect(findPlaylistCurrentSongIndex(songs, song("2", "bili"))).toBe(-1);
    expect(findPlaylistCurrentSongIndex(songs, null)).toBe(-1);
  });

  it("shuffles playlist songs without mutating the input", () => {
    const songs = [song("1"), song("2"), song("3")];
    const shuffled = shufflePlaylistSongs(songs, () => 0);

    expect(shuffled.map((item) => item.id)).toEqual(["2", "3", "1"]);
    expect(songs.map((item) => item.id)).toEqual(["1", "2", "3"]);
  });
});
