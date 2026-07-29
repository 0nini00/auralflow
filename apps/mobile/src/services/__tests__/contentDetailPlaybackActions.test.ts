import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  buildContentDetailPlaybackActions,
  findContentDetailCurrentSongIndex,
  getContentDetailLocateScrollOffset,
  shuffleContentDetailSongs,
} from "@/services/contentDetailPlaybackActions";

function song(id: string, source: MusicInfo["source"] = "wy"): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source,
  };
}

describe("content detail playback actions", () => {
  it("shows playback actions only when songs exist", () => {
    expect(buildContentDetailPlaybackActions(0)).toEqual({
      show: false,
      playAllLabel: "播放全部",
      shuffleLabel: "随机播放",
      locateLabel: "定位当前播放",
      canLocateCurrentSong: false,
      songSectionTitle: "歌曲",
      emptySongsText: "暂无歌曲",
    });
    expect(buildContentDetailPlaybackActions(2)).toEqual({
      show: true,
      playAllLabel: "播放全部",
      shuffleLabel: "随机播放",
      locateLabel: "定位当前播放",
      canLocateCurrentSong: false,
      songSectionTitle: "歌曲",
      emptySongsText: "暂无歌曲",
    });
  });

  it("supports artist-oriented labels", () => {
    expect(
      buildContentDetailPlaybackActions(5, {
        playAllLabel: "播放热门",
        songSectionTitle: "热门歌曲",
        emptySongsText: "暂无热门歌曲",
      }),
    ).toMatchObject({
      playAllLabel: "播放热门",
      songSectionTitle: "热门歌曲",
      emptySongsText: "暂无热门歌曲",
    });
  });

  it("enables locating only when the current song is in the detail list", () => {
    expect(buildContentDetailPlaybackActions(3, { currentSongIndex: 1 })).toMatchObject({
      canLocateCurrentSong: true,
    });
    expect(buildContentDetailPlaybackActions(3, { currentSongIndex: -1 })).toMatchObject({
      canLocateCurrentSong: false,
    });
  });

  it("finds the current song index by source and id", () => {
    const songs = [song("1"), song("2"), song("2", "tx")];
    expect(findContentDetailCurrentSongIndex(songs, song("2"))).toBe(1);
    expect(findContentDetailCurrentSongIndex(songs, song("2", "tx"))).toBe(2);
    expect(findContentDetailCurrentSongIndex(songs, song("9"))).toBe(-1);
    expect(findContentDetailCurrentSongIndex(songs, null)).toBe(-1);
  });

  it("calculates the scroll offset for locating a song in a nested detail list", () => {
    expect(getContentDetailLocateScrollOffset(3)).toBe(512);
    expect(getContentDetailLocateScrollOffset(0, { headerOffset: 180, rowHeight: 72 })).toBe(180);
  });

  it("shuffles detail songs without mutating the input", () => {
    const songs = [song("1"), song("2"), song("3")];
    const shuffled = shuffleContentDetailSongs(songs, () => 0);

    expect(shuffled.map((item) => item.id)).toEqual(["2", "3", "1"]);
    expect(songs.map((item) => item.id)).toEqual(["1", "2", "3"]);
  });
});
