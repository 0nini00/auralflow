import { beforeEach, describe, expect, it, vi } from "vitest";

const trackPlayer = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  add: vi.fn(() => Promise.resolve()),
  pause: vi.fn(() => Promise.resolve()),
  play: vi.fn(() => Promise.resolve()),
  reset: vi.fn(() => Promise.resolve()),
  seekTo: vi.fn(() => Promise.resolve()),
  setRate: vi.fn(() => Promise.resolve()),
  setRepeatMode: vi.fn(() => Promise.resolve()),
  setVolume: vi.fn(() => Promise.resolve()),
  setupPlayer: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
  updateOptions: vi.fn(() => Promise.resolve()),
}));

vi.mock("react-native-track-player", () => ({
  default: trackPlayer,
  AppKilledPlaybackBehavior: { ContinuePlayback: "continue" },
  Capability: {
    Play: "play",
    Pause: "pause",
    Stop: "stop",
    SkipToNext: "next",
    SkipToPrevious: "previous",
    SeekTo: "seek",
  },
  Event: {
    PlaybackProgressUpdated: "progress",
    PlaybackState: "state",
    PlaybackError: "error",
    PlaybackQueueEnded: "ended",
  },
  RepeatMode: { Track: "track", Off: "off", Queue: "queue" },
  State: { Playing: "playing", Buffering: "buffering" },
}));

import { usePlayerStore } from "@/stores/playerStore";
import type { MusicInfo } from "@lx/core";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: `artist-${id}`,
    albumName: "album",
    source: "wy",
  };
}

describe("player store playback rate", () => {
  beforeEach(() => {
    trackPlayer.setRate.mockClear();
    usePlayerStore.setState({ playbackRate: 1 } as any);
  });

  it("clamps playback rate before sending it to TrackPlayer", async () => {
    await usePlayerStore.getState().setPlaybackRate(3);

    // TrackPlayer v5 的 setRate 使用单参数；倍速被钳到上限 2。
    expect(trackPlayer.setRate).toHaveBeenCalledWith(2);
    expect(usePlayerStore.getState().playbackRate).toBe(2);
  });
});

describe("player store seek guards", () => {
  beforeEach(() => {
    trackPlayer.seekTo.mockClear();
    usePlayerStore.setState({ position: 0 } as any);
  });

  it("ignores non-finite seek positions before hitting TrackPlayer", async () => {
    // ProgressBar 误算可能传入 NaN；入原生前必须被拦截，否则 seekTo(NaN) 会崩原生。
    await usePlayerStore.getState().seekTo(Number.NaN);

    expect(trackPlayer.seekTo).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().position).toBe(0);
  });
});

describe("player store playback failures", () => {
  beforeEach(() => {
    trackPlayer.play.mockReset();
    trackPlayer.play.mockResolvedValue(undefined);
    trackPlayer.reset.mockClear();
    trackPlayer.add.mockClear();
    usePlayerStore.setState({ loading: false, error: null } as any);
  });

  it("rejects when TrackPlayer cannot start playback", async () => {
    trackPlayer.play.mockRejectedValueOnce(new Error("native playback failed"));

    await expect(
      usePlayerStore.getState().play(song("failed"), "https://audio.example.com/song.mp3"),
    ).rejects.toThrow("native playback failed");
    expect(usePlayerStore.getState().error).toBe("native playback failed");
  });
});

describe("player store queue management", () => {
  beforeEach(() => {
    trackPlayer.stop.mockClear();
    usePlayerStore.setState({
      currentSong: song("2"),
      currentUrl: "https://example.test/2.mp3",
      isPlaying: true,
      position: 12,
      queue: [song("1"), song("2")],
      currentIndex: 1,
      shuffleHistory: [0],
      playbackContext: { type: "queue" },
    } as any);
  });

  it("clears queue and stops playback", async () => {
    await usePlayerStore.getState().clearQueue();

    expect(trackPlayer.stop).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState()).toMatchObject({
      currentSong: null,
      currentUrl: null,
      isPlaying: false,
      position: 0,
      queue: [],
      currentIndex: -1,
      shuffleHistory: [],
      playbackContext: { type: "queue" },
    });
  });

  it("adjusts current index when removing a queued song before the current one", () => {
    usePlayerStore.getState().removeFromQueue(0);

    expect(usePlayerStore.getState()).toMatchObject({
      queue: [song("2")],
      currentIndex: 0,
      shuffleHistory: [],
    });
  });
});

describe("player store personal fm context", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentSong: song("2"),
      currentUrl: "https://example.test/2.mp3",
      isPlaying: true,
      position: 0,
      queue: [song("1"), song("2"), song("3")],
      currentIndex: 1,
      shuffleHistory: [],
      playbackContext: {
        type: "personalFm",
        currentBatch: [song("1"), song("2"), song("3")],
        currentBatchIndex: 1,
        buffer: [song("4")],
        hasMore: true,
      },
    } as any);
  });

  it("keeps personal fm batch index aligned when selecting a previous fm track", () => {
    usePlayerStore.getState().setPersonalFmBatchIndex(0);

    expect(usePlayerStore.getState()).toMatchObject({
      currentIndex: 0,
      playbackContext: {
        type: "personalFm",
        currentBatchIndex: 0,
      },
    });
  });
});
