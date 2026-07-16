import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  buildLibrarySongDeleteRequest,
  buildLibrarySongActions,
  getLibrarySongDeleteTarget,
  shuffleLibrarySongs,
} from "@/services/librarySongActions";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source: "wy",
  };
}

describe("library song actions", () => {
  it("enables play actions only when songs exist", () => {
    expect(buildLibrarySongActions("history", 0)).toEqual({
      show: false,
      playAllLabel: "播放全部",
      shuffleLabel: "随机播放",
      canDeleteSongs: true,
      deleteTarget: "history",
    });
    expect(buildLibrarySongActions("history", 3)).toEqual({
      show: true,
      playAllLabel: "播放全部",
      shuffleLabel: "随机播放",
      canDeleteSongs: true,
      deleteTarget: "history",
    });
  });

  it("allows deleting individual songs from play history and local music", () => {
    expect(buildLibrarySongActions("history", 3).canDeleteSongs).toBe(true);
    expect(buildLibrarySongActions("local", 3).canDeleteSongs).toBe(true);
    expect(buildLibrarySongActions("playlists", 3).canDeleteSongs).toBe(false);
  });

  it("maps deletable sections to the matching delete target", () => {
    expect(getLibrarySongDeleteTarget("history")).toBe("history");
    expect(getLibrarySongDeleteTarget("local")).toBe("local");
    expect(getLibrarySongDeleteTarget("playlists")).toBeNull();
    expect(getLibrarySongDeleteTarget("downloads")).toBeNull();
    expect(getLibrarySongDeleteTarget("bili")).toBeNull();
  });

  it("builds section-specific song delete requests", () => {
    const localSong = song("local-1");
    localSong.source = "local";
    localSong.name = "Local Song";

    expect(buildLibrarySongDeleteRequest("history", song("history-1"))).toEqual({
      type: "history",
      songId: "history-1",
      source: "wy",
    });
    expect(buildLibrarySongDeleteRequest("local", localSong)).toEqual({
      type: "local",
      song: { id: "local-1", source: "local" },
      title: "移除本地音乐",
      message: "确定从本地音乐列表中移除「Local Song」？不会删除设备上的文件。",
      confirmLabel: "移除",
    });
    expect(buildLibrarySongDeleteRequest("playlists", song("playlist-1"))).toEqual({ type: "none" });
  });

  it("does not show actions for non-song sections", () => {
    expect(buildLibrarySongActions("playlists", 3)).toMatchObject({ show: false });
    expect(buildLibrarySongActions("downloads", 3)).toMatchObject({ show: false });
  });

  it("shuffles songs without mutating the input and supports deterministic random", () => {
    const songs = [song("1"), song("2"), song("3")];
    const shuffled = shuffleLibrarySongs(songs, () => 0);

    expect(shuffled.map((item) => item.id)).toEqual(["2", "3", "1"]);
    expect(songs.map((item) => item.id)).toEqual(["1", "2", "3"]);
  });
});
