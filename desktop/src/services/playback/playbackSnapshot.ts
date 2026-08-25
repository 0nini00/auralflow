import { usePlayerStore } from "@/stores/playerStore";
import { buildPlaybackSnapshot, type PlaybackSnapshot } from "./playbackSnapshotModel";

export {
  applyPlaybackSnapshotToStorePatch,
  buildPlaybackSnapshot,
} from "./playbackSnapshotModel";
export type {
  PlaybackSnapshot,
  PlaybackSnapshotSource,
  PlaybackSnapshotStatus,
  PlaybackSnapshotStorePatch,
  PlaybackSnapshotTrack,
} from "./playbackSnapshotModel";

export function getPlaybackSnapshotFromStore(updatedAt = Date.now()): PlaybackSnapshot {
  return buildPlaybackSnapshot(usePlayerStore.getState(), updatedAt);
}
