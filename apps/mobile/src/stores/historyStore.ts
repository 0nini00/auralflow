import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

const HISTORY_KEY = "auralflow.mobile.playHistory";
const MAX_HISTORY_ITEMS = 200;

export interface HistoryState {
  history: MusicInfo[];
  loading: boolean;
}

interface HistoryActions {
  loadHistory: () => Promise<void>;
  addToHistory: (song: MusicInfo) => Promise<void>;
  clearHistory: () => Promise<void>;
  removeFromHistory: (songId: string, source: string) => Promise<void>;
  /** WebDAV 同步覆盖：用远端历史替换本地播放历史。 */
  replaceAllHistory: (history: MusicInfo[]) => Promise<void>;
}

type HistoryStore = HistoryState & HistoryActions;

function dedupeSongs(songs: MusicInfo[]): MusicInfo[] {
  const seen = new Set<string>();
  const result: MusicInfo[] = [];
  for (const song of songs) {
    const key = `${song.source}:${song.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(song);
  }
  return result;
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  history: [],
  loading: false,

  loadHistory: async () => {
    try {
      set({ loading: true });
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      // 损坏的存储可能是合法 JSON 但非数组（如 {}），会让 history.map 渲染崩溃，这里兜底。
      const history = Array.isArray(parsed) ? parsed : [];
      set({ history, loading: false });
    } catch (error) {
      console.error("Load history error:", error);
      set({ loading: false });
    }
  },

  addToHistory: async (song: MusicInfo) => {
    try {
      const { history } = get();
      const next = dedupeSongs([song, ...history]).slice(0, MAX_HISTORY_ITEMS);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      set({ history: next });
    } catch (error) {
      console.error("Add to history error:", error);
    }
  },

  clearHistory: async () => {
    try {
      await AsyncStorage.removeItem(HISTORY_KEY);
      set({ history: [] });
    } catch (error) {
      console.error("Clear history error:", error);
    }
  },

  removeFromHistory: async (songId: string, source: string) => {
    try {
      const { history } = get();
      const next = history.filter(
        (song) => !(song.id === songId && song.source === source)
      );
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      set({ history: next });
    } catch (error) {
      console.error("Remove from history error:", error);
    }
  },

  replaceAllHistory: async (history) => {
    try {
      const next = dedupeSongs(history).slice(0, MAX_HISTORY_ITEMS);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      set({ history: next });
    } catch (error) {
      console.error("Replace history error:", error);
    }
  },
}));
