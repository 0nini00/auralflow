import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  applyPlaybackSnapshotToStorePatch,
  buildPlaybackSnapshot,
} from "./playbackSnapshotModel";

const song: MusicInfo = {
  id: "1",
  name: "Song",
  singer: "Singer",
  albumName: "Album",
  source: "wy",
};

describe("playback snapshot clock", () => {
  it("carries the engine progress sample timestamp across lyric windows", () => {
    const snapshot = buildPlaybackSnapshot({
      current: song,
      queue: [song],
      currentIndex: 0,
      status: "playing",
      progress: 12,
      progressSampledAt: 3456.5,
      duration: 180,
      volume: 0.8,
      isMuted: false,
      playbackRate: 1,
      repeatMode: "off",
      isShuffle: false,
      fmMode: false,
      error: null,
    });

    expect(snapshot.progressSampledAt).toBe(3456.5);
    expect(applyPlaybackSnapshotToStorePatch(snapshot).progressSampledAt).toBe(3456.5);
  });
});
