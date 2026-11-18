import { usePlayerStore } from "@/stores/playerStore";
import { buildPlaybackSnapshot, type PlaybackSnapshot } from "./playbackSnapshotModel";

export { buildPlaybackSnapshot } from "./playbackSnapshotModel";
export type {
  PlaybackSnapshot,
  PlaybackSnapshotSource,
  PlaybackSnapshotStatus,
  PlaybackSnapshotTrack,
} from "./playbackSnapshotModel";

export function getPlaybackSnapshotFromStore(updatedAt = Date.now()): PlaybackSnapshot {
  return buildPlaybackSnapshot(usePlayerStore.getState(), updatedAt);
}
