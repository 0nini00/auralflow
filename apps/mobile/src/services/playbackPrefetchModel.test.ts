import { describe, expect, it } from "vitest";
import { buildPlaybackPrefetchKey, isPlaybackPrefetchKeyForSong } from "./playbackPrefetchModel";

const SONG = { source: "wy", id: "1" };

describe("playbackPrefetchModel", () => {
  it("音质参与预读缓存键", () => {
    expect(buildPlaybackPrefetchKey(SONG, "320k")).not.toBe(
      buildPlaybackPrefetchKey(SONG, "flac"),
    );
  });

  it("按歌曲识别所有音质的预读键", () => {
    expect(isPlaybackPrefetchKeyForSong("wy:1:flac", SONG)).toBe(true);
    expect(isPlaybackPrefetchKeyForSong("wy:2:flac", SONG)).toBe(false);
  });
});
