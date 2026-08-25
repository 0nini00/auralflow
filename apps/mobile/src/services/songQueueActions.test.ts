import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  dequeueTempPlayList,
  enqueueTempPlayList,
  insertSongAtQueueEnd,
  insertSongToPlayNext,
  removeFromTempPlayList,
} from "./songQueueActions";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "singer",
    albumName: "album",
    source: "wy",
  };
}

describe("songQueueActions", () => {
  it("在当前歌曲之后插入下一首且不修改输入队列", () => {
    const queue = [song("a"), song("b")];
    const result = insertSongToPlayNext({ queue, currentIndex: 0, song: song("c") });

    expect(result.queue.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(result.currentIndex).toBe(0);
    expect(queue.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("空队列或无效当前索引时以目标歌曲建立新队列", () => {
    const result = insertSongToPlayNext({ queue: [song("a")], currentIndex: -1, song: song("c") });

    expect(result.queue.map((item) => item.id)).toEqual(["c"]);
    expect(result.currentIndex).toBe(0);
  });

  it("追加到队尾时保留当前索引", () => {
    const result = insertSongAtQueueEnd({ queue: [song("a")], currentIndex: 0, song: song("b") });

    expect(result.queue.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.currentIndex).toBe(0);
  });

  it("稍后播放按 source 和 id 去重并按先进先出消费", () => {
    const a = song("a");
    const b = song("b");
    const queued = enqueueTempPlayList({ tempPlayList: [a], song: b });
    const duplicate = enqueueTempPlayList({ tempPlayList: queued, song: { ...a, name: "renamed" } });
    const dequeued = dequeueTempPlayList(duplicate);

    expect(duplicate.map((item) => item.id)).toEqual(["a", "b"]);
    expect(dequeued.nextSong?.id).toBe("a");
    expect(dequeued.tempPlayList.map((item) => item.id)).toEqual(["b"]);
  });

  it("移除越界项时返回原数组引用", () => {
    const queue = [song("a")];
    expect(removeFromTempPlayList(queue, 2)).toBe(queue);
  });
});
