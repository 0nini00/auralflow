import { create } from 'zustand';
import type { MusicInfo } from '@lx/core';
import {
  getDailyRecommend,
  getPersonalFm,
  fmTrash,
} from '@/services/wyAccountService';
import { createPersonalFmQueueController } from '@/services/personalFmQueue';

interface DiscoveryState {
  // 每日推荐
  daily: MusicInfo[];
  dailyDate: string; // YYYY-MM-DD
  dailyLoading: boolean;
  dailyError: string;

  // 私人 FM
  fmQueue: MusicInfo[];
  fmIndex: number;
  fmLoading: boolean;
  fmPrefetching: boolean;
  fmError: string;

  loadDaily: (force?: boolean) => Promise<void>;
  refreshDaily: () => Promise<void>;

  loadFm: (force?: boolean) => Promise<void>;
  fmNext: () => Promise<MusicInfo | null>;
  fmDislike: (track: MusicInfo) => Promise<void>;
  fmReset: () => void;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const useDiscoveryStore = create<DiscoveryState>((set, get) => {
  const fmController = createPersonalFmQueueController({
    getState: () => {
      const { fmQueue, fmIndex, fmLoading, fmPrefetching, fmError } = get();
      return { fmQueue, fmIndex, fmLoading, fmPrefetching, fmError };
    },
    setState: (patch) => {
      if (typeof patch === 'function') {
        set((state) => patch({
          fmQueue: state.fmQueue,
          fmIndex: state.fmIndex,
          fmLoading: state.fmLoading,
          fmPrefetching: state.fmPrefetching,
          fmError: state.fmError,
        }));
        return;
      }
      set(patch);
    },
    fetchTracks: async () => (await getPersonalFm()) as MusicInfo[],
    trashTrack: fmTrash,
    warn: (message, error) => console.warn(message, error),
  });

  return {
    daily: [],
    dailyDate: '',
    dailyLoading: false,
    dailyError: '',

    fmQueue: [],
    fmIndex: 0,
    fmLoading: false,
    fmPrefetching: false,
    fmError: '',

    loadDaily: async (force = false) => {
      const { dailyDate, daily, dailyLoading } = get();
      if (dailyLoading) return;
      // 同一天已加载且不强制刷新，直接复用缓存
      if (!force && dailyDate === todayStr() && daily.length > 0) return;

      set({ dailyLoading: true, dailyError: '' });
      try {
        const songs = (await getDailyRecommend()) as MusicInfo[];
        set({ daily: songs, dailyDate: todayStr(), dailyLoading: false });
      } catch (e) {
        set({
          dailyError: e instanceof Error ? e.message : String(e),
          dailyLoading: false,
        });
      }
    },

    refreshDaily: () => get().loadDaily(true),

    loadFm: fmController.load,

    /** 取下一首；剩余较少时后台拉一批拼接 */
    fmNext: fmController.next,

    /** 不感兴趣：调垃圾桶接口 + 跳过该首 */
    fmDislike: fmController.dislike,

    fmReset: fmController.reset,
  };
});
