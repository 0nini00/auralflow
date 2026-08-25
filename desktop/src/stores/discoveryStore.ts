import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import {
  getDailyRecommend,
  getPersonalFm,
  fmTrash,
} from "@/services/wyAccountService";
import {
  loadDailyRecommendHistory,
  normalizeDailySongs,
  saveDailyRecommendSnapshot,
  type DailyRecommendSnapshot,
} from "@/services/dailyRecommendCache";
import { createPersonalFmQueueController } from "@/services/personalFmQueue";

interface DiscoveryState {
  daily: MusicInfo[];
  dailyDate: string;
  dailyLoading: boolean;
  dailyError: string;
  dailyHistory: DailyRecommendSnapshot[];
  dailySelectedDate: string;
  dailyAccountUid: string;
  dailyHydrated: boolean;

  fmQueue: MusicInfo[];
  fmIndex: number;
  fmLoading: boolean;
  fmPrefetching: boolean;
  fmError: string;

  initializeDaily: (uid: string) => Promise<void>;
  loadDaily: (force?: boolean) => Promise<void>;
  refreshDaily: () => Promise<void>;
  selectDailyDate: (date: string) => void;
  selectToday: () => void;

  loadFm: (force?: boolean) => Promise<void>;
  fmNext: () => Promise<MusicInfo | null>;
  fmDislike: (track: MusicInfo) => Promise<void>;
  fmReset: () => void;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function selectedSnapshot(history: DailyRecommendSnapshot[], date: string): DailyRecommendSnapshot | undefined {
  return history.find((snapshot) => snapshot.date === date) ?? history[0];
}

export const useDiscoveryStore = create<DiscoveryState>((set, get) => {
  const fmController = createPersonalFmQueueController({
    getState: () => {
      const { fmQueue, fmIndex, fmLoading, fmPrefetching, fmError } = get();
      return { fmQueue, fmIndex, fmLoading, fmPrefetching, fmError };
    },
    setState: (patch) => {
      if (typeof patch === "function") {
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
  });

  return {
    daily: [],
    dailyDate: "",
    dailyLoading: false,
    dailyError: "",
    dailyHistory: [],
    dailySelectedDate: "",
    dailyAccountUid: "",
    dailyHydrated: false,

    fmQueue: [],
    fmIndex: 0,
    fmLoading: false,
    fmPrefetching: false,
    fmError: "",

    initializeDaily: async (uid) => {
      const normalizedUid = uid.trim();
      if (!normalizedUid) {
        set({
          daily: [],
          dailyDate: "",
          dailyLoading: false,
          dailyError: "",
          dailyHistory: [],
          dailySelectedDate: "",
          dailyAccountUid: "",
          dailyHydrated: false,
        });
        return;
      }
      if (get().dailyAccountUid === normalizedUid && get().dailyHydrated) {
        await get().loadDaily();
        return;
      }

      set({
        daily: [],
        dailyDate: "",
        dailyLoading: true,
        dailyError: "",
        dailyHistory: [],
        dailySelectedDate: "",
        dailyAccountUid: normalizedUid,
        dailyHydrated: false,
      });

      try {
        const history = await loadDailyRecommendHistory(normalizedUid);
        if (get().dailyAccountUid !== normalizedUid) return;
        const today = todayStr();
        const initial = selectedSnapshot(history, today);
        set({
          daily: initial?.songs ?? [],
          dailyDate: initial?.date ?? "",
          dailyHistory: history,
          dailySelectedDate: initial?.date ?? "",
          dailyHydrated: true,
          dailyLoading: false,
        });
        if (!history.some((snapshot) => snapshot.date === today)) {
          await get().loadDaily();
        }
      } catch (error) {
        if (get().dailyAccountUid !== normalizedUid) return;
        set({
          dailyHydrated: true,
          dailyLoading: false,
          dailyError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    loadDaily: async (force = false) => {
      const { dailyAccountUid, dailyHistory, dailyLoading } = get();
      if (!dailyAccountUid || dailyLoading) return;
      const today = todayStr();
      const cachedToday = dailyHistory.find((snapshot) => snapshot.date === today);
      if (!force && cachedToday) {
        set({ daily: cachedToday.songs, dailyDate: today, dailySelectedDate: today, dailyError: "" });
        return;
      }

      const requestUid = dailyAccountUid;
      set({ dailyLoading: true, dailyError: "" });
      try {
        const songs = normalizeDailySongs(await getDailyRecommend());
        if (songs.length === 0) throw new Error("每日推荐返回了空数据，已保留现有缓存");
        const history = await saveDailyRecommendSnapshot(requestUid, {
          date: today,
          songs,
          cachedAt: Date.now(),
        });
        if (get().dailyAccountUid !== requestUid) return;
        set({
          daily: songs,
          dailyDate: today,
          dailyHistory: history,
          dailySelectedDate: today,
          dailyLoading: false,
          dailyError: "",
        });
      } catch (error) {
        if (get().dailyAccountUid !== requestUid) return;
        const fallback = selectedSnapshot(get().dailyHistory, get().dailySelectedDate);
        set({
          daily: fallback?.songs ?? [],
          dailyDate: fallback?.date ?? "",
          dailySelectedDate: fallback?.date ?? "",
          dailyError: error instanceof Error ? error.message : String(error),
          dailyLoading: false,
        });
      }
    },

    refreshDaily: () => get().loadDaily(true),

    selectDailyDate: (date) => {
      const snapshot = get().dailyHistory.find((item) => item.date === date);
      if (!snapshot) return;
      set({ daily: snapshot.songs, dailyDate: snapshot.date, dailySelectedDate: snapshot.date });
    },

    selectToday: () => {
      const today = todayStr();
      const snapshot = get().dailyHistory.find((item) => item.date === today);
      if (snapshot) {
        set({ daily: snapshot.songs, dailyDate: today, dailySelectedDate: today });
        return;
      }
      void get().loadDaily();
    },

    loadFm: fmController.load,
    fmNext: fmController.next,
    fmDislike: fmController.dislike,
    fmReset: fmController.reset,
  };
});
