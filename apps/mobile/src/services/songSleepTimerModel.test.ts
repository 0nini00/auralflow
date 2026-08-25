import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  getNextSongSleepTimerState,
  getSongSleepTimerTrackKey,
  normalizeSongSleepTimerCount,
} from "./songSleepTimerModel";

function song(id: string): MusicInfo {
  return {
    id,
    name: id,
    singer: "singer",
    albumName: "album",
    source: "tx",
  };
}

describe("songSleepTimerModel", () => {
  it("将歌曲计数限制在 1 到 50", () => {
    expect(normalizeSongSleepTimerCount(0)).toBe(1);
    expect(normalizeSongSleepTimerCount(12.9)).toBe(12);
    expect(normalizeSongSleepTimerCount(99)).toBe(50);
    expect(normalizeSongSleepTimerCount(Number.NaN)).toBe(1);
  });

  it("使用来源和歌曲 id 生成稳定轨道 key", () => {
    expect(getSongSleepTimerTrackKey(song("42"))).toBe("tx:42");
    expect(getSongSleepTimerTrackKey(null)).toBeNull();
  });

  it("同一首歌重复上报时不重复扣减", () => {
    const state = { isActive: true, remainingSongs: 2, lastTrackKey: "tx:42" };
    expect(getNextSongSleepTimerState(state, song("42"))).toBe(state);
  });

  it("最后一首开始播放时关闭计时并要求暂停", () => {
    expect(getNextSongSleepTimerState(
      { isActive: true, remainingSongs: 1, lastTrackKey: "tx:old" },
      song("next"),
    )).toEqual({
      isActive: false,
      remainingSongs: 0,
      lastTrackKey: null,
      shouldPause: true,
    });
  });
});
