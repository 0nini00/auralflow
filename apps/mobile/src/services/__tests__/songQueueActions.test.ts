import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  buildSongQueueActionLabels,
  dequeueTempPlayList,
  enqueueTempPlayList,
  insertSongAtQueueEnd,
  insertSongToPlayNext,
  removeFromTempPlayList,
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

describe("temp play list (稍后播放)", () => {
  it("appends a song to the temp play list", () => {
    const result = enqueueTempPlayList({
      tempPlayList: [song("1")],
      song: song("2"),
    });

    expect(result.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("does not add a duplicate song and keeps its original position", () => {
    const existing = [song("1"), song("2")];
    const result = enqueueTempPlayList({
      tempPlayList: existing,
      song: song("1"),
    });

    expect(result.map((item) => item.id)).toEqual(["1", "2"]);
    // 去重时应原样返回同一引用，避免无意义的 state 变更
    expect(result).toBe(existing);
  });

  it("dequeues the first song and returns the remaining list", () => {
    const result = dequeueTempPlayList([song("1"), song("2"), song("3")]);

    expect(result.nextSong?.id).toBe("1");
    expect(result.tempPlayList.map((item) => item.id)).toEqual(["2", "3"]);
  });

  it("returns null when dequeuing an empty temp play list", () => {
    const result = dequeueTempPlayList([]);

    expect(result.nextSong).toBeNull();
    expect(result.tempPlayList).toEqual([]);
  });

  it("removes a song at the given index", () => {
    const result = removeFromTempPlayList([song("1"), song("2"), song("3")], 1);

    expect(result.map((item) => item.id)).toEqual(["1", "3"]);
  });

  it("returns the list unchanged when removing an out-of-range index", () => {
    const list = [song("1"), song("2")];
    const result = removeFromTempPlayList(list, 5);

    expect(result).toBe(list);
  });
});
