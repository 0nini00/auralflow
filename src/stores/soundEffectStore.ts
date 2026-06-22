import { create } from "zustand";
import { playerEngine } from "@/services/playerEngine";
import { attachLibraryPersistence } from "./libraryPersistence";

export const EQ_FREQS = [60, 230, 910, 3600, 14000];

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
  /** 变调半音数（-12..12，0=旁路），独立于 enabled */
  pitch: number;

  setEnabled: (v: boolean) => void;
  setGain: (index: number, value: number) => void;
  setGains: (values: number[]) => void;
  setPan: (v: number) => void;
  setReverbMix: (v: number) => void;
  setPitch: (v: number) => void;
  applyPreset: (id: string) => void;
  reset: () => void;
}

const FLAT = [0, 0, 0, 0, 0];

function applyToEngine(s: SoundEffectState): void {
  if (!s.enabled) {
    playerEngine.setEqGains(FLAT);
    playerEngine.setPan(0);
    playerEngine.setReverbMix(0);
    return;
  }
  playerEngine.ensureEffectsGraph();
  playerEngine.setEqGains(s.gains);
  playerEngine.setPan(s.pan);
  playerEngine.setReverbMix(s.reverbMix);
}

export const useSoundEffectStore = create<SoundEffectState>((set, get) => ({
  enabled: false,
  gains: [...FLAT],
  pan: 0,
  reverbMix: 0,
  presetId: "flat",
  pitch: 0,

  setEnabled: (v) => {
    set({ enabled: v });
    applyToEngine(get());
  },
  setGain: (index, value) => {
    set((s) => {
      const gains = [...s.gains];
      gains[index] = value;
      return { gains, presetId: "custom" };
    });
    applyToEngine(get());
  },
  setGains: (values) => {
    set({ gains: values });
    applyToEngine(get());
  },
  setPan: (v) => {
    set({ pan: v });
    applyToEngine(get());
  },
  setReverbMix: (v) => {
    set({ reverbMix: v });
    applyToEngine(get());
  },
  setPitch: (v) => {
    set({ pitch: v });
    playerEngine.setPitch(v);
  },
  applyPreset: (id) => {
    const preset = EQ_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    set({ presetId: id, gains: [...preset.gains] });
    applyToEngine(get());
  },
  reset: () => {
    set({ enabled: false, gains: [...FLAT], pan: 0, reverbMix: 0, presetId: "flat", pitch: 0 });
    applyToEngine(get());
    playerEngine.setPitch(0);
  },
}));

attachLibraryPersistence<SoundEffectState, {
  enabled: boolean;
  gains: number[];
  pan: number;
  reverbMix: number;
  presetId: string;
  pitch: number;
}>(useSoundEffectStore, {
  namespace: "soundEffect",
  pick: (s) => ({
    enabled: s.enabled,
    gains: s.gains,
    pan: s.pan,
    reverbMix: s.reverbMix,
    presetId: s.presetId,
    pitch: s.pitch,
  }),
  apply: (slice, set) => {
    set({
      enabled: slice.enabled ?? false,
      gains: slice.gains ?? [...FLAT],
      pan: slice.pan ?? 0,
      reverbMix: slice.reverbMix ?? 0,
      presetId: slice.presetId ?? "flat",
      pitch: slice.pitch ?? 0,
    });
  },
});

// 音频图建好后（首次播放时），把持久化的音效/变调设置回放到引擎。
// hydrate 时图可能还没建，必须等 onGraphReady。
playerEngine.onGraphReady(() => {
  const s = useSoundEffectStore.getState();
  applyToEngine(s);
  if (s.pitch) playerEngine.setPitch(s.pitch);
});
