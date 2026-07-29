import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  buildCurrentSongActions,
  buildImmersiveCurrentSongActions,
  buildPersonalFmSongActions,
} from "@/services/currentSongActions";

function song(): MusicInfo {
  return {
    id: "1",
    name: "song",
    singer: "artist",
    albumName: "album",
    source: "wy",
  };
}

describe("current song actions", () => {
  it("hides actions when no song is playing", () => {
    expect(buildCurrentSongActions(null, false)).toEqual({
      show: false,
      likeLabel: "喜欢",
      shareLabel: "分享歌曲",
      addToPlaylistLabel: "加入歌单",
    });
  });

  it("builds labels for the current song", () => {
    expect(buildCurrentSongActions(song(), false)).toEqual({
      show: true,
      likeLabel: "喜欢",
      shareLabel: "分享歌曲",
      addToPlaylistLabel: "加入歌单",
    });
    expect(buildCurrentSongActions(song(), true)).toEqual({
      show: true,
      likeLabel: "已喜欢",
      shareLabel: "分享歌曲",
      addToPlaylistLabel: "加入歌单",
    });
  });

  it("builds labels for personal fm current song actions", () => {
    expect(buildPersonalFmSongActions(null, false)).toEqual({
      show: false,
      likeLabel: "喜欢",
      shareLabel: "分享歌曲",
      addToPlaylistLabel: "加入歌单",
    });

    expect(buildPersonalFmSongActions(song(), false)).toEqual({
      show: true,
      likeLabel: "喜欢",
      shareLabel: "分享歌曲",
      addToPlaylistLabel: "加入歌单",
    });

    expect(buildPersonalFmSongActions(song(), true)).toEqual({
      show: true,
      likeLabel: "已喜欢",
      shareLabel: "分享歌曲",
      addToPlaylistLabel: "加入歌单",
    });
  });

  it("builds labels for immersive lyrics current song actions", () => {
    expect(buildImmersiveCurrentSongActions(null, false)).toEqual({
      show: false,
      likeLabel: "喜欢",
      shareLabel: "分享歌曲",
      addToPlaylistLabel: "加入歌单",
    });

    expect(buildImmersiveCurrentSongActions(song(), false)).toEqual({
      show: true,
      likeLabel: "喜欢",
      shareLabel: "分享歌曲",
      addToPlaylistLabel: "加入歌单",
    });

    expect(buildImmersiveCurrentSongActions(song(), true)).toEqual({
      show: true,
      likeLabel: "已喜欢",
      shareLabel: "分享歌曲",
      addToPlaylistLabel: "加入歌单",
    });
  });
});
