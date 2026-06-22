import { create } from 'zustand';
import type { MusicInfo } from '@lx/core';
import {
  getDailyRecommend,
  getPersonalFm,
  fmTrash,
} from '@/services/wyAccountService';

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
  fmError: string;

  loadDaily: (force?: boolean) => Promise<void>;
  refreshDaily: () => Promise<void>;

  loadFm: () => Promise<void>;
  fmNext: () => Promise<MusicInfo | null>;
  fmDislike: (track: MusicInfo) => Promise<void>;
  fmReset: () => void;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const useDiscoveryStore = create<DiscoveryState>((set, get) => ({
  daily: [],
  dailyDate: '',
  dailyLoading: false,
  dailyError: '',

  fmQueue: [],
  fmIndex: 0,
  fmLoading: false,
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

  loadFm: async () => {
    if (get().fmLoading) return;
    set({ fmLoading: true, fmError: '' });
    try {
      const tracks = (await getPersonalFm()) as MusicInfo[];
      set({ fmQueue: tracks, fmIndex: 0, fmLoading: false });
    } catch (e) {
      set({
        fmError: e instanceof Error ? e.message : String(e),
        fmLoading: false,
      });
    }
  },

  /** 取下一首；剩余 ≤1 时后台拉一批拼接 */
  fmNext: async () => {
    const { fmQueue, fmIndex } = get();

    if (fmIndex < fmQueue.length) {
      const track = fmQueue[fmIndex];
      set({ fmIndex: fmIndex + 1 });

      // 预拉取
      if (fmQueue.length - fmIndex <= 2) {
        void (async () => {
          try {
            const more = (await getPersonalFm()) as MusicInfo[];
            const seen = new Set(get().fmQueue.map((t) => `${t.source}:${t.id}`));
            const additions = more.filter((t) => !seen.has(`${t.source}:${t.id}`));
            if (additions.length > 0) {
              set((state) => ({ fmQueue: [...state.fmQueue, ...additions] }));
            }
          } catch {
            // 预拉取失败不影响当前
          }
        })();
      }

      return track;
    }

    // 队列已耗尽：阻塞拉一批
    set({ fmLoading: true, fmError: '' });
    try {
      const tracks = (await getPersonalFm()) as MusicInfo[];
      set({ fmQueue: tracks, fmIndex: 1, fmLoading: false });
      return tracks[0] ?? null;
    } catch (e) {
      set({
        fmError: e instanceof Error ? e.message : String(e),
        fmLoading: false,
      });
      return null;
    }
  },

  /** 不感兴趣：调垃圾桶接口 + 跳过该首 */
  fmDislike: async (track) => {
    if (track.source !== 'wy') return;
    try {
      await fmTrash(String(track.id));
    } catch (e) {
      console.warn('[fm] trash failed', e);
    }
    // 跳过当前歌（如果它正好是 fmQueue[fmIndex-1]，等于直接进入下一首）
  },

  fmReset: () => {
    set({ fmQueue: [], fmIndex: 0, fmError: '' });
  },
}));
