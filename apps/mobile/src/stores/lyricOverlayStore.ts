import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

/**
 * 桌面歌词悬浮窗的可见/锁定状态（对应桌面端 lyric window state）。
 * 仅持久化状态，悬浮窗本身的生命周期由原生层管理。
 */
interface LyricOverlayState {
  visible: boolean;
  locked: boolean;
  pinned: boolean;
  loaded: boolean;
  loadFromStorage: () => Promise<void>;
  setVisible: (v: boolean) => Promise<void>;
  setLocked: (v: boolean) => Promise<void>;
  setPinned: (v: boolean) => Promise<void>;
}

const STORAGE_KEY = "auralflow.mobile.lyricOverlay";

async function persist(state: LyricOverlayState): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ visible: state.visible, locked: state.locked, pinned: state.pinned }),
  );
}

export const useLyricOverlayStore = create<LyricOverlayState>((set, get) => ({
  visible: false,
  locked: false,
  pinned: false,
  loaded: false,

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LyricOverlayState>;
        set({
          visible: Boolean(parsed.visible),
          locked: Boolean(parsed.locked),
          pinned: Boolean(parsed.pinned),
          loaded: true,
        });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  setVisible: async (visible) => {
    set({ visible });
    await persist(get());
  },

  setLocked: async (locked) => {
    set({ locked });
    await persist(get());
  },

  setPinned: async (pinned) => {
    set({ pinned });
    await persist(get());
  },
}));
