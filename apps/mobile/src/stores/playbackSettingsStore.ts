import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  DEFAULT_PLAYBACK_QUALITY,
  normalizePlaybackQuality,
  type PlaybackQuality,
} from "@/services/playbackQualityModel";
import { normalizePauseOnExternalPlayback } from "@/services/audioInterruptionPolicy";
import { normalizeAutoSkipOnPlaybackError } from "@/services/playbackFailurePolicy";

export const PLAYBACK_SETTINGS_KEY = "auralflow.mobile.playbackSettings";

interface PersistedPlaybackSettings {
  v?: number;
  defaultQuality?: string;
  pauseOnExternalPlayback?: boolean;
  autoSkipOnPlaybackError?: boolean;
}

interface PlaybackSettingsState {
  defaultQuality: PlaybackQuality;
  pauseOnExternalPlayback: boolean;
  autoSkipOnPlaybackError: boolean;
  loaded: boolean;
}

interface PlaybackSettingsActions {
  loadFromStorage: () => Promise<void>;
  setDefaultQuality: (quality: string) => Promise<void>;
  setPauseOnExternalPlayback: (enabled: boolean) => Promise<void>;
  setAutoSkipOnPlaybackError: (enabled: boolean) => Promise<void>;
}

type PlaybackSettingsStore = PlaybackSettingsState & PlaybackSettingsActions;

/**
 * 按整体状态落盘：字段增多后位置参数容易错位，改为取当前状态的快照序列化。
 * version 固定 1：新增字段用「缺省即安全默认」兼容旧数据，无需版本迁移。
 */
function serialize(state: PlaybackSettingsState): string {
  return JSON.stringify({
    v: 1,
    defaultQuality: state.defaultQuality,
    pauseOnExternalPlayback: state.pauseOnExternalPlayback,
    autoSkipOnPlaybackError: state.autoSkipOnPlaybackError,
  });
}

export const usePlaybackSettingsStore = create<PlaybackSettingsStore>((set, get) => ({
  defaultQuality: DEFAULT_PLAYBACK_QUALITY,
  // 默认「降音量」：其他应用播放音频时压低本应用音量（duck），而非暂停。
  // 旧版本默认 true（暂停），存量用户在 loadFromStorage 里通过版本迁移统一改回 false。
  pauseOnExternalPlayback: false,
  // 默认「暂停」：播放失败重试仍不通时停在错误态，由用户决定重试/切歌，不自动往下翻。
  autoSkipOnPlaybackError: false,
  loaded: false,

  loadFromStorage: async () => {
    if (get().loaded) return;
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
      set({
        defaultQuality: normalizePlaybackQuality(data.defaultQuality),
        pauseOnExternalPlayback,
        // 缺省即 false（失败即停）：旧数据没有该字段时落到安全默认，无需版本迁移
        autoSkipOnPlaybackError: normalizeAutoSkipOnPlaybackError(data.autoSkipOnPlaybackError),
        loaded: true,
      });
      await AsyncStorage.setItem(PLAYBACK_SETTINGS_KEY, serialize(get()));
    } catch (error) {
      set({
        defaultQuality: DEFAULT_PLAYBACK_QUALITY,
        pauseOnExternalPlayback: false,
        autoSkipOnPlaybackError: false,
        loaded: true,
      });
    }
  },

  setDefaultQuality: async (quality: string) => {
    set({ defaultQuality: normalizePlaybackQuality(quality), loaded: true });
    await AsyncStorage.setItem(PLAYBACK_SETTINGS_KEY, serialize(get()));
  },

  setPauseOnExternalPlayback: async (enabled: boolean) => {
    set({ pauseOnExternalPlayback: normalizePauseOnExternalPlayback(enabled), loaded: true });
    await AsyncStorage.setItem(PLAYBACK_SETTINGS_KEY, serialize(get()));
  },

  setAutoSkipOnPlaybackError: async (enabled: boolean) => {
    set({ autoSkipOnPlaybackError: normalizeAutoSkipOnPlaybackError(enabled), loaded: true });
    await AsyncStorage.setItem(PLAYBACK_SETTINGS_KEY, serialize(get()));
  },
}));
