import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import {
  attachSoundEffects,
  setEqGains as nativeSetEqGains,
  setPan as nativeSetPan,
  setReverbMix as nativeSetReverbMix,
  setSoundEffectsEnabled,
} from "@/services/soundEffectService";
import { syncPlaybackParameters } from "@/services/androidPitchService";

/**
 * 移动端音效面板 store，与桌面 `src/stores/soundEffectStore.ts` 的接口保持一致。
 *
 * 变调（pitch）在 Android AudioFx 中没有原生实现，`setPitch` 会尝试调用但通常返回
 * false；UI 仍保留控件以便结构与桌面对齐，未来引入 SoundTouch/OboeSonic 时再启用。
 */

export const EQ_FREQS = [60, 230, 910, 3600, 14000];
const FLAT: number[] = [0, 0, 0, 0, 0];

const PITCH_MIN = -12;
const PITCH_MAX = 12;

/** 变调半音数入原生前裁剪到支持区间，避免损坏存储/异常输入算出越界频率比。 */
function clampPitch(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.round(semitones)));
}

export interface EqPreset {
  id: string;
  name: string;
  gains: number[];
}

export const EQ_PRESETS: EqPreset[] = [
  { id: "flat", name: "原声", gains: [0, 0, 0, 0, 0] },
  { id: "pop", name: "流行", gains: [-1, 2, 4, 2, -1] },
  { id: "rock", name: "摇滚", gains: [4, 2, -1, 2, 3] },
  { id: "jazz", name: "爵士", gains: [3, 2, 1, 2, 3] },
  { id: "bass", name: "重低音", gains: [6, 4, 0, 0, 0] },
  { id: "vocal", name: "人声", gains: [-2, -1, 4, 3, 1] },
];

interface SoundEffectState {
  enabled: boolean;
  gains: number[];
  pan: number;
  reverbMix: number;
  presetId: string;
  pitch: number;
  loaded: boolean;
  loadFromStorage: () => Promise<void>;
  setEnabled: (v: boolean) => Promise<void>;
  setGain: (index: number, value: number) => Promise<void>;
  setGains: (values: number[]) => Promise<void>;
  setPan: (v: number) => Promise<void>;
  setReverbMix: (v: number) => Promise<void>;
  setPitch: (v: number) => Promise<void>;
  applyPreset: (id: string) => Promise<void>;
  reset: () => Promise<void>;
}

const STORAGE_KEY = "auralflow.mobile.soundEffect";

async function persist(state: SoundEffectState): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      enabled: state.enabled,
      gains: state.gains,
      pan: state.pan,
      reverbMix: state.reverbMix,
      presetId: state.presetId,
      pitch: state.pitch,
    }),
  );
}

async function applyToNative(state: SoundEffectState): Promise<void> {
  await attachSoundEffects();
  if (!state.enabled) {
    await setSoundEffectsEnabled(false);
    await nativeSetEqGains(FLAT);
    await nativeSetPan(0);
    await nativeSetReverbMix(0);
    return;
  }
  await setSoundEffectsEnabled(true);
  await nativeSetEqGains(state.gains);
  await nativeSetPan(state.pan);
  await nativeSetReverbMix(state.reverbMix);
}

export const useSoundEffectStore = create<SoundEffectState>((set, get) => ({
  enabled: false,
  gains: [...FLAT],
  pan: 0,
  reverbMix: 0,
  presetId: "flat",
  pitch: 0,
  loaded: false,

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SoundEffectState>;
        set({
          enabled: Boolean(parsed.enabled),
          gains: Array.isArray(parsed.gains) && parsed.gains.length === EQ_FREQS.length
            ? parsed.gains.map((v) => (Number.isFinite(v) ? Number(v) : 0))
            : [...FLAT],
          pan: typeof parsed.pan === "number" ? parsed.pan : 0,
          reverbMix: typeof parsed.reverbMix === "number" ? parsed.reverbMix : 0,
          presetId: typeof parsed.presetId === "string" ? parsed.presetId : "flat",
          pitch: typeof parsed.pitch === "number" ? clampPitch(parsed.pitch) : 0,
          loaded: true,
        });
      } else {
        set({ loaded: true });
      }
    } catch (error) {
      set({ loaded: true });
    }
    // hydrate 完成后把设置回放到 native；播放器可能还没启动，attach 会在下一次播放时补上。
    await applyToNative(get());
    await syncPlaybackParameters();
  },

  setEnabled: async (enabled) => {
    set({ enabled });
    await persist(get());
    await applyToNative(get());
  },

  setGain: async (index, value) => {
    if (!Number.isInteger(index) || index < 0 || index >= EQ_FREQS.length) return;
    set((s) => {
      const gains = [...s.gains];
      gains[index] = value;
      return { gains, presetId: "custom" };
    });
    await persist(get());
    await applyToNative(get());
  },

  setGains: async (values) => {
    set({ gains: values });
    await persist(get());
    await applyToNative(get());
  },

  setPan: async (v) => {
    const clamped = Math.max(-1, Math.min(1, v));
    set({ pan: clamped });
    await persist(get());
    await applyToNative(get());
  },

  setReverbMix: async (v) => {
    const clamped = Math.max(0, Math.min(1, v));
    set({ reverbMix: clamped });
    await persist(get());
    await applyToNative(get());
  },

  setPitch: async (v) => {
    set({ pitch: clampPitch(v) });
    await persist(get());
    await syncPlaybackParameters();
  },

  applyPreset: async (id) => {
    const preset = EQ_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    set({ presetId: id, gains: [...preset.gains] });
    await persist(get());
    await applyToNative(get());
  },

  reset: async () => {
    set({
      enabled: false,
      gains: [...FLAT],
      pan: 0,
      reverbMix: 0,
      presetId: "flat",
      pitch: 0,
    });
    await persist(get());
    await applyToNative(get());
  },
}));
