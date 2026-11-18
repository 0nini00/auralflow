/**
 * 队列编辑：整队替换、追加、插到下一首、移除 / 撤销移除、清空。
 * 只改队列与下标；需要出声时回头调 store 自己的 play。
 */
import type { MusicInfo } from "@lx/core";
import { prefetchTracks } from "@/services/playback/prefetchService";
import { playerEngine } from "@/services/playerEngine";
import { invalidatePlayRequest } from "./playRequestState";
import type { PlayerGet, PlayerSet, PlayerStore } from "./types";

type QueueActions = Pick<PlayerStore, "playQueue" | "addToQueue" | "playNext" | "removeFromQueue" | "insertQueueAt" | "clearQueue">;

export function createQueueActions(set: PlayerSet, get: PlayerGet): QueueActions {
  return {
    playQueue: async (queue, startIndex = 0) => {
      // 用户主动选了别的歌单/队列，自动退出 FM 模式，清空播放历史
      set({ queue, currentIndex: startIndex, fmMode: false, playHistory: [], pinnedNextSong: null });
      const music = queue[startIndex];
      if (music) await get().play(music);
    },

    addToQueue: (music) => {
      set((state) => ({ queue: [...state.queue, music] }));
    },

    playNext: (music) => {
      const { queue, currentIndex } = get();
      // 空队列 / 无当前曲：插入后立即开播，避免只改 index 不出声
      if (queue.length === 0 || currentIndex < 0) {
        set({ queue: [music], currentIndex: 0, playHistory: [] });
        void get().play(music).catch(() => undefined);
        return;
      }

      set((state) => {
        const nextIndex = Math.min(state.currentIndex + 1, state.queue.length);
        const nextQueue = [...state.queue];
        nextQueue.splice(nextIndex, 0, music);
        // 与 removeFromQueue 对称：插入点及之后的 history 下标整体 +1
        const playHistory = state.playHistory.map((h) => (h >= nextIndex ? h + 1 : h));
        // 同时记下锚点：随机播放与 FM 模式下 next() 不会走到插入位置，需要它兜底
        return { queue: nextQueue, playHistory, pinnedNextSong: music };
      });
      // 立即预取该曲播放 URL/歌词/封面：播到它时命中预取缓存秒开（对齐移动端）。
      void prefetchTracks([music]).catch(() => undefined);
    },

    removeFromQueue: (index) => {
      let resumeTrack: MusicInfo | null = null;

      set((state) => {
        const newQueue = state.queue.filter((_, i) => i !== index);
        let newIndex = state.currentIndex;

        // Keep playHistory in sync: drop hit index, shift larger indices down
        const newHistory = state.playHistory
          .filter((h) => h !== index)
          .map((h) => (h > index ? h - 1 : h));

        if (index < state.currentIndex) {
          newIndex = state.currentIndex - 1;
          return { queue: newQueue, currentIndex: newIndex, playHistory: newHistory };
        }

        if (index === state.currentIndex) {
          // Removing current track: resume next (same index after delete), else previous; stop if empty
          if (newQueue.length === 0) {
            invalidatePlayRequest();
            playerEngine.stop();
            return {
              queue: [],
              currentIndex: -1,
              playHistory: [],
              current: null,
              status: "idle" as const,
            };
          }
          newIndex = index < newQueue.length ? index : newQueue.length - 1;
          resumeTrack = newQueue[newIndex] ?? null;
          return { queue: newQueue, currentIndex: newIndex, playHistory: newHistory };
        }

        return { queue: newQueue, currentIndex: newIndex, playHistory: newHistory };
      });

      if (resumeTrack) {
        void get().play(resumeTrack).catch(() => undefined);
      }
    },

    insertQueueAt: (index, music) => {
      set((state) => {
        const at = Math.max(0, Math.min(index, state.queue.length));
        const queue = [...state.queue];
        queue.splice(at, 0, music);
        const shift = (value: number) => (value >= at ? value + 1 : value);
        return {
          queue,
          currentIndex: at <= state.currentIndex ? state.currentIndex + 1 : state.currentIndex,
          playHistory: state.playHistory.map(shift),
        };
      });
    },

    clearQueue: () => {
      invalidatePlayRequest();
      playerEngine.stop();
      set({
        queue: [],
        currentIndex: -1,
        current: null,
        status: "idle",
        playHistory: [],
        pinnedNextSong: null,
      });
    },
  };
}
