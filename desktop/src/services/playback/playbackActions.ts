import { getPlaybackSnapshotFromStore } from "./playbackSnapshot";
import { usePlayerStore } from "@/stores/playerStore";

export type SimplePlaybackAction = "play-pause" | "next" | "prev";

/**
 * 播放/暂停/上下曲的统一分发。
 *
 * 此前托盘（useNativeControls）、歌词窗控制（playerSync）、SMTC 媒体键
 * （smtcService）各写一份「读快照 → playing 则暂停 / paused 则恢复 / 否则
 * 重新解析播放」的 switch，靠复制维持一致。SMTC 的 play/pause 是显式语义、
 * seek/stop 是它独有，所以它只复用 next/prev 与自身保留的部分。
 */
export function dispatchPlaybackAction(action: SimplePlaybackAction): void {
  const store = usePlayerStore.getState();
  const snapshot = getPlaybackSnapshotFromStore();
  switch (action) {
    case "play-pause": {
      if (!snapshot.current) return;
      if (snapshot.status === "playing") store.pause();
      else if (snapshot.status === "paused") store.resume();
      else void store.play(snapshot.current).catch(() => undefined);
      return;
    }
    case "next":
      void store.next().catch(() => undefined);
      return;
    case "prev":
      void store.prev().catch(() => undefined);
  }
}
