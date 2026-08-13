import TrackPlayer, { State } from "react-native-track-player";

import { usePlayerStore } from "@/stores/playerStore";

export interface MvAudioSessionSnapshot {
  activeTrackId: string | null;
  activeTrackUrl: string | null;
  activeTrackIndex: number | null;
  wasPlaying: boolean;
}

export interface MvAudioSession {
  snapshot: MvAudioSessionSnapshot;
  close(): Promise<void>;
}

function normalizeTrackValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function startMvAudioSession(): Promise<MvAudioSession> {
  const [activeTrack, activeTrackIndex, playbackState] = await Promise.all([
    TrackPlayer.getActiveTrack().catch(() => undefined),
    TrackPlayer.getActiveTrackIndex().catch(() => undefined),
    TrackPlayer.getPlaybackState().catch(() => ({ state: State.None })),
  ]);
  const wasPlaying =
    playbackState.state === State.Playing || playbackState.state === State.Buffering;
  const snapshot: MvAudioSessionSnapshot = {
    activeTrackId: normalizeTrackValue(activeTrack?.id),
    activeTrackUrl: normalizeTrackValue(activeTrack?.url),
    activeTrackIndex: typeof activeTrackIndex === "number" ? activeTrackIndex : null,
    wasPlaying,
  };

  if (wasPlaying) {
    await usePlayerStore.getState().pause();
  }

  let closed = false;
  return {
    snapshot,
    async close() {
      if (closed) return;
      closed = true;
      if (!snapshot.wasPlaying) return;

      const [currentTrack, currentTrackIndex] = await Promise.all([
        TrackPlayer.getActiveTrack().catch(() => undefined),
        TrackPlayer.getActiveTrackIndex().catch(() => undefined),
      ]);
      const unchanged =
        normalizeTrackValue(currentTrack?.id) === snapshot.activeTrackId &&
        normalizeTrackValue(currentTrack?.url) === snapshot.activeTrackUrl &&
        (typeof currentTrackIndex === "number" ? currentTrackIndex : null) ===
          snapshot.activeTrackIndex;
      if (unchanged) {
        await usePlayerStore.getState().resume();
      }
    },
  };
}
