import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  DEFAULT_PLAYBACK_QUALITY,
  normalizePlaybackQuality,
  type PlaybackQuality,
} from "@/services/playbackQualityModel";
import { normalizePauseOnExternalPlayback } from "@/services/audioInterruptionPolicy";

export const PLAYBACK_SETTINGS_KEY = "auralflow.mobile.playbackSettings";

interface PersistedPlaybackSettings {
  v?: number;
  defaultQuality?: string;
  pauseOnExternalPlayback?: boolean;
}

interface PlaybackSettingsState {
  defaultQuality: PlaybackQuality;
  pauseOnExternalPlayback: boolean;
  loaded: boolean;
}

interface PlaybackSettingsActions {
  loadFromStorage: () => Promise<void>;
  setDefaultQuality: (quality: string) => Promise<void>;
  setPauseOnExternalPlayback: (enabled: boolean) => Promise<void>;
}

type PlaybackSettingsStore = PlaybackSettingsState & PlaybackSettingsActions;

function serialize(defaultQuality: PlaybackQuality, pauseOnExternalPlayback: boolean, version = 1): string {
  return JSON.stringify({ v: version, defaultQuality, pauseOnExternalPlayback });
}

export const usePlaybackSettingsStore = create<PlaybackSettingsStore>((set) => ({
  defaultQuality: DEFAULT_PLAYBACK_QUALITY,
  // 默认「降音量」：其他应用播放音频时压低本应用音量（duck），而非暂停。
  // 旧版本默认 true（暂停），存量用户在 loadFromStorage 里通过版本迁移统一改回 false。
  pauseOnExternalPlayback: false,
  loaded: false,

  loadFromStorage: async () => {
    if (usePlaybackSettingsStore.getState().loaded) return;
    try {
      const raw = await AsyncStorage.getItem(PLAYBACK_SETTINGS_KEY);
      const data = raw ? (JSON.parse(raw) as PersistedPlaybackSettings) : {};
      // 版本迁移：旧版本默认 pauseOnExternalPlayback=true（外部音频→暂停）。
      // 现默认改为 duck（降音量）。对从未显式选择过的存量用户（无 v 标记），
      // 统一迁移到新默认 false；已显式选择过的用户保留其选择。
      let pauseOnExternalPlayback = normalizePauseOnExternalPlayback(data.pauseOnExternalPlayback);
      if (data.pauseOnExternalPlayback == null || data.v !== 1) {
        pauseOnExternalPlayback = false;
      }
      const next = {
        defaultQuality: normalizePlaybackQuality(data.defaultQuality),
        pauseOnExternalPlayback,
        loaded: true,
      };
      set(next);
      await AsyncStorage.setItem(PLAYBACK_SETTINGS_KEY, serialize(next.defaultQuality, next.pauseOnExternalPlayback, 1));
    } catch (error) {
      set({ defaultQuality: DEFAULT_PLAYBACK_QUALITY, pauseOnExternalPlayback: false, loaded: true });
    }
  },

  setDefaultQuality: async (quality: string) => {
    const defaultQuality = normalizePlaybackQuality(quality);
    let pauseOnExternalPlayback = false;
    set((state) => {
      pauseOnExternalPlayback = state.pauseOnExternalPlayback;
      return { defaultQuality, loaded: true };
    });
    await AsyncStorage.setItem(PLAYBACK_SETTINGS_KEY, serialize(defaultQuality, pauseOnExternalPlayback));
  },

  setPauseOnExternalPlayback: async (enabled: boolean) => {
    const pauseOnExternalPlayback = normalizePauseOnExternalPlayback(enabled);
    let defaultQuality = DEFAULT_PLAYBACK_QUALITY;
    set((state) => {
      defaultQuality = state.defaultQuality;
      return { pauseOnExternalPlayback, loaded: true };
    });
    await AsyncStorage.setItem(PLAYBACK_SETTINGS_KEY, serialize(defaultQuality, pauseOnExternalPlayback));
  },
}));
