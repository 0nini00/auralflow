import { useCallback } from "react";
import type { MusicInfo } from "@lx/core";

import { showToast } from "@/components/ui/Toast";
import { usePlayerStore } from "@/stores/playerStore";

/** 「下一首播放」的统一反馈：插入队列时给可见确认，空队列时会直接开播。 */
export function usePlayNextAction() {
  const playNext = usePlayerStore((s) => s.playNext);
  return useCallback((music: MusicInfo) => {
    const before = usePlayerStore.getState();
    const startsNow = before.queue.length === 0 || before.currentIndex < 0;
    playNext(music);
    showToast(
      startsNow ? `开始播放「${music.name}」` : `已加入下一首：${music.name}`,
      { kind: "success" },
    );
  }, [playNext]);
}
