import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const trackPlayer = vi.hoisted(() => ({
  add: vi.fn(() => Promise.resolve()),
  addEventListener: vi.fn(),
  pause: vi.fn(() => Promise.resolve()),
  play: vi.fn(() => Promise.resolve()),
  reset: vi.fn(() => Promise.resolve()),
  seekTo: vi.fn(() => Promise.resolve()),
  setRate: vi.fn(() => Promise.resolve()),
  setRepeatMode: vi.fn(() => Promise.resolve()),
  setVolume: vi.fn(() => Promise.resolve()),
  getVolume: vi.fn(() => Promise.resolve(1)),
  setupPlayer: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
  updateOptions: vi.fn(() => Promise.resolve()),
}));

const storage = vi.hoisted(() => ({
  getItem: vi.fn(() => Promise.resolve(null)),
  setItem: vi.fn(() => Promise.resolve()),
  removeItem: vi.fn(() => Promise.resolve()),
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

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));

vi.mock("@/services/musicApi", () => ({
  getLyrics: vi.fn(() => Promise.resolve([])),
  parseUrl: vi.fn((song: MusicInfo) => Promise.resolve(`https://audio.example.com/${song.id}.mp3`)),
}));

vi.mock("@/services/biliService", () => ({
  resolveBiliSongUrl: vi.fn(),
}));

vi.mock("@/services/cacheService", () => ({
  cacheCover: vi.fn(() => Promise.resolve(null)),
  cacheLyrics: vi.fn(() => Promise.resolve()),
  getCachedLyrics: vi.fn(() => Promise.resolve(null)),
  cacheAudioFile: vi.fn(() => Promise.resolve(undefined)),
  isLocalFilePlayable: vi.fn(() => Promise.resolve(true)),
  CACHEABLE_AUDIO_SOURCES: new Set(["wy", "tx"]),
}));

vi.mock("@/services/customSourceRuntime", () => ({
  requestCustomSourceMusicUrl: vi.fn(),
}));

vi.mock("@/stores/customSourceStore", () => ({
  useCustomSourceStore: {
    getState: () => ({ sources: [] }),
  },
}));

vi.mock("@/stores/playbackSettingsStore", () => ({
  usePlaybackSettingsStore: {
    getState: () => ({ defaultQuality: "320k" }),
  },
}));

vi.mock("@/services/wyPlaylistService", () => ({
  getPersonalFmSongs: vi.fn(),
  trashPersonalFmSong: vi.fn(),
}));

import { playFromQueue } from "@/services/playerService";
import { usePlayerStore } from "@/stores/playerStore";

function song(id: string): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: `artist-${id}`,
    albumName: "album",
    source: "wy",
  };
}

describe("player service personal fm playback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const songs = [song("1"), song("2"), song("3")];
    usePlayerStore.setState({
      currentSong: songs[1],
      currentUrl: "https://audio.example.com/2.mp3",
      isPlaying: true,
      loading: false,
      error: null,
      position: 0,
      duration: 0,
      queue: songs,
      currentIndex: 1,
      shuffleHistory: [],
      playMode: "list",
      playbackRate: 1,
      volume: 0.8,
      playbackContext: {
        type: "personalFm",
        currentBatch: songs,
        currentBatchIndex: 1,
        buffer: [song("4")],
        hasMore: true,
      },
      lyrics: [],
    } as any);
  });

  it("keeps personal fm batch index aligned when playing an earlier fm queue item", async () => {
    await playFromQueue(0);

    const state = usePlayerStore.getState();
    expect(state.currentIndex).toBe(0);
    expect(state.currentSong?.id).toBe("1");
    expect(state.playbackContext).toMatchObject({
      type: "personalFm",
      currentBatchIndex: 0,
    });
  });

  it("rejects when native playback fails", async () => {
    trackPlayer.play.mockRejectedValueOnce(new Error("native playback failed"));

    await expect(playFromQueue(0)).rejects.toThrow("native playback failed");
    expect(usePlayerStore.getState().error).toBe("native playback failed");
  });
});
