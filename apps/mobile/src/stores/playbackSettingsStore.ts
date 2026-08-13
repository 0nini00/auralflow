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

function serialize(defaultQuality: PlaybackQuality, pauseOnExternalPlayback: boolean): string {
  return JSON.stringify({ defaultQuality, pauseOnExternalPlayback });
}

export const usePlaybackSettingsStore = create<PlaybackSettingsStore>((set) => ({
  defaultQuality: DEFAULT_PLAYBACK_QUALITY,
  pauseOnExternalPlayback: true,
  loaded: false,

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(PLAYBACK_SETTINGS_KEY);
      const data = raw ? (JSON.parse(raw) as PersistedPlaybackSettings) : {};
      set({
        defaultQuality: normalizePlaybackQuality(data.defaultQuality),
        pauseOnExternalPlayback: normalizePauseOnExternalPlayback(data.pauseOnExternalPlayback),
        loaded: true,
      });
    } catch (error) {
      set({ defaultQuality: DEFAULT_PLAYBACK_QUALITY, pauseOnExternalPlayback: true, loaded: true });
    }
  },

  setDefaultQuality: async (quality: string) => {
    const defaultQuality = normalizePlaybackQuality(quality);
    let pauseOnExternalPlayback = true;
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
