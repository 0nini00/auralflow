import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
    clear: () => data.clear(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));

vi.mock("react-native-track-player", () => ({
  default: {
    addEventListener: vi.fn(),
    add: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    reset: vi.fn(),
    seekTo: vi.fn(),
    setRate: vi.fn(),
    setRepeatMode: vi.fn(),
    setVolume: vi.fn(),
    setupPlayer: vi.fn(),
    stop: vi.fn(),
    updateOptions: vi.fn(),
  },
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

import { loadPlaybackSnapshot } from "@/services/playbackSnapshot";
import { usePlayerStore } from "@/stores/playerStore";

const SNAPSHOT_KEY = "auralflow:playback-snapshot:v1";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: "artist",
    albumName: "album",
    source: "wy",
  };
}

describe("playback snapshot", () => {
  beforeEach(() => {
    storage.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    storage.removeItem.mockClear();
    usePlayerStore.setState({
      currentSong: null,
      queue: [],
      currentIndex: -1,
      shuffleHistory: [],
      position: 0,
      duration: 0,
      playMode: "list",
      playbackRate: 1,
      volume: 0.8,
      previousVolume: 0.8,
      isMuted: false,
      playbackContext: { type: "queue" },
      isPlaying: false,
    } as any);
  });

  it("clamps persisted playback rate when restoring a snapshot", async () => {
    storage.data.set(SNAPSHOT_KEY, JSON.stringify({
      currentSong: song("1"),
      queue: [song("1")],
      currentIndex: 0,
      shuffleHistory: [],
      position: 12,
      duration: 180,
      playMode: "list",
      playbackRate: 3,
      volume: 0.8,
      previousVolume: 0.8,
      isMuted: false,
      playbackContext: { type: "queue" },
      savedAt: 1000,
    }));

    const snapshot = await loadPlaybackSnapshot();

    expect(snapshot?.playbackRate).toBe(2);
    expect(usePlayerStore.getState().playbackRate).toBe(2);
  });
});
