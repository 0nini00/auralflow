import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  isLyricOverlaySupported,
  isLyricOverlayVisible,
  setLyricNotificationButtonEnabled,
} from "@/services/lyricOverlayService";

/**
 * 桌面歌词悬浮窗的可见/锁定状态（对应桌面端 lyric window state）。
 * 仅持久化状态，悬浮窗本身的生命周期由原生层管理。
 */
interface LyricOverlayState {
  visible: boolean;
  locked: boolean;
  pinned: boolean;
  notificationButtonEnabled: boolean;
  notificationButtonUpdating: boolean;
  loaded: boolean;
  error: string | null;
  loadFromStorage: () => Promise<void>;
  syncVisibleFromNative: () => Promise<void>;
  setVisible: (v: boolean) => Promise<void>;
  setNotificationButtonEnabled: (v: boolean) => Promise<void>;
  setLocked: (v: boolean) => Promise<void>;
  setPinned: (v: boolean) => Promise<void>;
}

const STORAGE_KEY = "auralflow.mobile.lyricOverlay";
let initializationPromise: Promise<void> | null = null;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function persist(state: LyricOverlayState): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      visible: state.visible,
      locked: state.locked,
      pinned: state.pinned,
      notificationButtonEnabled: state.notificationButtonEnabled,
    }),
  );
}

export const useLyricOverlayStore = create<LyricOverlayState>((set, get) => ({
  visible: false,
  locked: false,
  pinned: false,
  notificationButtonEnabled: true,
  notificationButtonUpdating: false,
  loaded: false,
  error: null,

  loadFromStorage: () => {
    if (get().loaded) return Promise.resolve();
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<LyricOverlayState>;
          set({
            visible: Boolean(parsed.visible),
            locked: Boolean(parsed.locked),
            pinned: Boolean(parsed.pinned),
            notificationButtonEnabled: parsed.notificationButtonEnabled !== false,
          });
        }

        if (isLyricOverlaySupported()) {
          try {
            await setLyricNotificationButtonEnabled(get().notificationButtonEnabled);
          } catch (error) {
            set({ error: getErrorMessage(error) });
          }
          try {
            await get().syncVisibleFromNative();
          } catch (error) {
            set({ error: getErrorMessage(error) });
          }
        }
      } catch (error) {
        set({ error: getErrorMessage(error) });
      } finally {
        set({ loaded: true });
      }
    })();

    return initializationPromise;
  },

  syncVisibleFromNative: async () => {
    if (!isLyricOverlaySupported()) return;
    const visible = await isLyricOverlayVisible();
    if (visible === get().visible) return;
    set({ visible });
    await persist(get());
  },

  setVisible: async (visible) => {
    set({ visible });
    await persist(get());
  },

  setNotificationButtonEnabled: async (notificationButtonEnabled) => {
    if (!isLyricOverlaySupported()) {
      const error = new Error("当前设备不支持播放通知歌词按钮");
      set({ error: error.message });
      throw error;
    }

    set({ notificationButtonUpdating: true, error: null });
    try {
      await setLyricNotificationButtonEnabled(notificationButtonEnabled);
      set({ notificationButtonEnabled });
      await persist(get());
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    } finally {
      set({ notificationButtonUpdating: false });
    }
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
