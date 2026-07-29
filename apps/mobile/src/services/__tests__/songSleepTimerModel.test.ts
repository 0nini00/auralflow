import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  DESKTOP_ALIGNED_SLEEP_TIMER_MINUTES,
  DESKTOP_ALIGNED_SLEEP_TIMER_SONG_COUNTS,
  buildMobileSleepTimerControl,
  buildSleepTimerLabel,
  getNextSongSleepTimerState,
  normalizeSongSleepTimerCount,
  type SongSleepTimerState,
} from "@/services/songSleepTimerModel";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source: "wy",
  };
}

describe("song sleep timer model", () => {
  it("normalizes song-count sleep timer input", () => {
    expect(normalizeSongSleepTimerCount(0)).toBe(1);
    expect(normalizeSongSleepTimerCount(2.8)).toBe(2);
    expect(normalizeSongSleepTimerCount(99)).toBe(50);
  });

  it("does not decrement while the current track key is unchanged", () => {
    const state: SongSleepTimerState = {
      isActive: true,
      remainingSongs: 2,
      lastTrackKey: "wy:1",
    };

    expect(getNextSongSleepTimerState(state, song("1"))).toEqual(state);
  });

  it("decrements on track change and stops when count is exhausted", () => {
    const state: SongSleepTimerState = {
      isActive: true,
      remainingSongs: 2,
      lastTrackKey: "wy:1",
    };

    expect(getNextSongSleepTimerState(state, song("2"))).toEqual({
      isActive: true,
      remainingSongs: 1,
      lastTrackKey: "wy:2",
      shouldPause: false,
    });

    expect(getNextSongSleepTimerState({ ...state, remainingSongs: 1 }, song("2"))).toEqual({
      isActive: false,
      remainingSongs: 0,
      lastTrackKey: null,
      shouldPause: true,
    });
  });

  it("formats minute and song-count sleep timer labels", () => {
    expect(buildSleepTimerLabel({ minuteActive: false, minuteRemaining: null, songActive: false, songRemaining: 0 })).toBe("睡眠");
    expect(buildSleepTimerLabel({ minuteActive: true, minuteRemaining: 30, songActive: false, songRemaining: 0 })).toBe("睡眠 剩余30分钟");
    expect(buildSleepTimerLabel({ minuteActive: false, minuteRemaining: null, songActive: true, songRemaining: 3 })).toBe("睡眠 剩余3首");
  });

  it("builds the mobile sleep timer control with desktop-aligned presets", () => {
    expect(DESKTOP_ALIGNED_SLEEP_TIMER_MINUTES).toEqual([15, 30, 45, 60]);
    expect(DESKTOP_ALIGNED_SLEEP_TIMER_SONG_COUNTS).toEqual([1, 10]);

    expect(buildMobileSleepTimerControl({
      minuteActive: false,
      minuteRemaining: null,
      songActive: false,
      songRemaining: 0,
    })).toEqual({
      label: "睡眠",
      active: false,
      minutePresets: [15, 30, 45, 60],
      songCountPresets: [1, 10],
    });

    expect(buildMobileSleepTimerControl({
      minuteActive: false,
      minuteRemaining: null,
      songActive: true,
      songRemaining: 10,
    })).toEqual({
      label: "睡眠 剩余10首",
      active: true,
      minutePresets: [15, 30, 45, 60],
      songCountPresets: [1, 10],
    });
  });
});
