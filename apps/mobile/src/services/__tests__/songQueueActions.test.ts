import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  buildSongQueueActionLabels,
  insertSongAtQueueEnd,
  insertSongToPlayNext,
} from "@/services/songQueueActions";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source: "wy",
  };
}

describe("song queue actions", () => {
  it("builds labels for song row queue actions", () => {
    expect(buildSongQueueActionLabels()).toEqual({
      playNextLabel: "下首",
      addToQueueLabel: "队列",
    });
  });

  it("adds songs to the end of the queue without changing current index", () => {
    const currentQueue = [song("1"), song("2")];
    const result = insertSongAtQueueEnd({
      queue: currentQueue,
      currentIndex: 0,
      song: song("3"),
    });

    expect(result.queue.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(result.currentIndex).toBe(0);
    expect(currentQueue.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("inserts songs after the current song for play-next", () => {
    const result = insertSongToPlayNext({
      queue: [song("1"), song("2"), song("3")],
      currentIndex: 0,
      song: song("next"),
    });

    expect(result.queue.map((item) => item.id)).toEqual(["1", "next", "2", "3"]);
    expect(result.currentIndex).toBe(0);
  });

  it("creates a queue when playing next without an active queue", () => {
    const result = insertSongToPlayNext({
      queue: [],
      currentIndex: -1,
      song: song("next"),
    });

    expect(result.queue.map((item) => item.id)).toEqual(["next"]);
    expect(result.currentIndex).toBe(0);
  });
});
