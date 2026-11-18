/**
 * 队列导航：按下标播放、下一首 / 上一首（含连点合并）与私人 FM 续播。
 *
 * 连点队列的状态在 playRequestState，这里只负责登记请求和消费补跳。
 */
import { buildSongKey } from "@lx/core";
import { debugLog } from "@lx/tauri-bridge";
import { playerEngine } from "@/services/playerEngine";
import { useDiscoveryStore } from "@/stores/discoveryStore";
import { playAndDidFail } from "./playbackPipeline";
import { finishQueuedSwitchStep, requestSwitchStep } from "./playRequestState";
import type { PlayerGet, PlayerSet, PlayerStore } from "./types";

/** 当前切歌完成后消费连点补跳（只补一次，防止循环）。 */
function completeQueuedSwitchStep(get: PlayerGet): void {
  const finished = finishQueuedSwitchStep();
  if (finished.shouldStep) {
    void (finished.direction === 'prev' ? get().prev() : get().next()).catch(() => undefined);
  }
}

/** FM 下一首：调 discoveryStore.fmNext 取下一位，解析/播放失败时最多再试 maxAttempts 首（避免卡在死链上）；失败返回 false */
export async function playNextFmTrack(set: PlayerSet, get: PlayerGet, maxAttempts = 5): Promise<boolean> {
  let lastError = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const next = await useDiscoveryStore.getState().fmNext();
      if (!next) {
        // 队列耗尽/拉取失败：不再静默，写入用户可见的错误，避免“点了没反应”
        const fmState = useDiscoveryStore.getState();
        lastError = fmState.fmError || '私人 FM 暂无更多推荐（可能需要重新登录）';
        break;
      }
      const failed = await playAndDidFail(get, next);
      if (!failed) return true;
      lastError = 'FM 曲目解析失败，已自动跳过';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  set({ error: `私人 FM 切歌失败：${lastError}` });
  return false;
}

export function createQueueNavigation(set: PlayerSet, get: PlayerGet): Pick<PlayerStore, "playByIndex" | "next" | "prev"> {
  return {
    playByIndex: async (index) => {
      const { queue } = get();
      if (index < 0 || index >= queue.length) return;
      const previousIndex = get().currentIndex;
      set({ currentIndex: index });
      try {
        const failed = await playAndDidFail(get, queue[index]);
        if (failed) set({ currentIndex: previousIndex });
      } catch {
        set({ currentIndex: previousIndex });
      }
    },

    next: async () => {
      const { queue, currentIndex, repeatMode, isShuffle, fmMode, playHistory } = get();

      // 「下一首播放」锚点：随机抽号与 FM 推荐都会绕过插入位置，导致用户插的歌要等
      // 很久才播。这里记曲目身份而不是下标——队列增删会让下标整体漂移。
      const pinnedSong = get().pinnedNextSong;
      const pinnedIndex = pinnedSong
        ? queue.findIndex((song) => buildSongKey(song) === buildSongKey(pinnedSong))
        : -1;
      // FM 模式：放弃 queue 逻辑，拉下一首推荐
      if (fmMode && pinnedIndex < 0) {
        // 把当前曲压入 FM 历史栈，供 prev() 回退（FM 无 queue，prev 原先是无反应的）
        if (get().current) {
          set((state) => ({ fmHistory: [...state.fmHistory.slice(-49), state.current!] }));
        }
        await playNextFmTrack(set, get);
        return;
      }

      if (queue.length === 0) {
        playerEngine.pauseAtEnd();
        return;
      }

      // 连点合并：切换进行中（解析/播放器加载）时重复点击只补跳一次，不重复解析。
      if (!requestSwitchStep("next")) return;
      try {
        let nextIndex: number;

        if (pinnedIndex >= 0) {
          // 「下一首播放」锚点：随机模式下不再现场抽号，直接播用户刚插的那首
          nextIndex = pinnedIndex;
          set({ pinnedNextSong: null, fmMode: false });
        } else if (isShuffle) {
          // Random mode: pick a random index (excluding current)
          const availableIndices = queue
            .map((_, i) => i)
            .filter((i) => i !== currentIndex);
          if (availableIndices.length === 0) {
            // Only one song in queue, play it again if repeat is on
            if (repeatMode === "all") {
              nextIndex = 0;
            } else {
              playerEngine.pauseAtEnd();
              return;
            }
          } else {
            nextIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
          }
          // 随机模式下把当前索引压入历史，供 prev() 回退
          if (currentIndex >= 0) {
            set({ playHistory: [...playHistory, currentIndex] });
          }
        } else {
          // Sequential mode
          nextIndex = currentIndex + 1;
          if (nextIndex >= queue.length) {
            if (repeatMode === "all") {
              nextIndex = 0;
            } else {
              playerEngine.pauseAtEnd();
              return;
            }
          }
        }

        // 先更新 index，使 play() 内部的 preloadNext 能读到正确的下一首
        const prevIndex = currentIndex;
        const previousPlayHistory = playHistory;
        try {
          set({ currentIndex: nextIndex });
          const failed = await playAndDidFail(get, queue[nextIndex]);
          if (failed) {
            set({ currentIndex: prevIndex, playHistory: previousPlayHistory });
          }
        } catch {
          // play 失败时回滚 index，避免 UI 指向未成功播放的曲目
          set({ currentIndex: prevIndex, playHistory: previousPlayHistory });
          debugLog(`[player] next 失败，已回滚到 index=${prevIndex}`);
        }
      } finally {
        completeQueuedSwitchStep(get);
      }
    },

    prev: async () => {
      const { queue, currentIndex, isShuffle, playHistory, fmMode, fmHistory, current } = get();
      // FM 模式：从 FM 历史栈回退；无历史时回到当前曲开头（对齐移动端语义）
      if (fmMode) {
        const lastTrack = fmHistory.length > 0 ? fmHistory[fmHistory.length - 1] : null;
        if (lastTrack) {
          set({ fmHistory: fmHistory.slice(0, -1) });
          await get().play(lastTrack);
          return;
        }
        if (current) {
          playerEngine.seek(0);
          return;
        }
        return;
      }
      if (queue.length === 0) return;

      // 连点合并：切换进行中（解析/播放器加载）时重复点击只补跳一次，不重复解析。
      if (!requestSwitchStep("prev")) return;
      try {
        let prevIndex: number;

        if (isShuffle && playHistory.length > 0) {
          // 随机模式：从历史栈弹出上一首
          const history = [...playHistory];
          prevIndex = history.pop()!;
          set({ playHistory: history });
        } else {
          prevIndex = Math.max(0, currentIndex - 1);
        }

        if (prevIndex === currentIndex) return;
        const savedIndex = currentIndex;
        const savedPlayHistory = playHistory;
        try {
          set({ currentIndex: prevIndex });
          const failed = await playAndDidFail(get, queue[prevIndex]);
          if (failed) {
            set({ currentIndex: savedIndex, playHistory: savedPlayHistory });
          }
        } catch {
          set({ currentIndex: savedIndex, playHistory: savedPlayHistory });
          debugLog(`[player] prev 失败，已回滚到 index=${savedIndex}`);
        }
      } finally {
        completeQueuedSwitchStep(get);
      }
    },
  };
}
