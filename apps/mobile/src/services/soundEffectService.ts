import { NativeModules, Platform } from "react-native";

/**
 * Android 原生音效桥接。
 *
 * 通过 `android.media.audiofx.Equalizer` / `PresetReverb` / MediaPlayer#setVolume（左右声道）
 * 挂到当前 ExoPlayer 的 audio session id 上。桌面端的 SoundEffectPanel 完全对齐。
 *
 * 平台不支持时（非 Android 或未连接原生模块），所有调用都退化为 no-op，
 * 让上层 UI 依然可用但不产生副作用。
 */

interface NativeSoundEffectModule {
  attach(): Promise<boolean>;
  detach(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  /** 5 段 EQ 增益，单位 dB（-15..+15）；数组长度不足会补零 */
  setEqGains(gainsDb: number[]): Promise<void>;
  /** 声像：-1 全左 / 0 中 / 1 全右 */
  setPan(pan: number): Promise<void>;
  /** 混响湿度：0 关闭 / 0.01..1 打开并按比例调节，>0 时启用 PresetReverb */
  setReverbMix(mix: number): Promise<void>;
  /** 变调半音数（-12..12，0=旁路）；Android 原生 AudioFx 不支持，返回 false */
  setPitch(semitones: number): Promise<boolean>;
  /** 查询原生能力（EQ 段数、Reverb 是否可用） */
  getCapabilities(): Promise<SoundEffectCapabilities>;
}

export interface SoundEffectCapabilities {
  supportsEqualizer: boolean;
  supportsReverb: boolean;
  supportsPan: boolean;
  supportsPitch: boolean;
  eqBandCount: number;
  eqFrequencies: number[];
}

const DEFAULT_CAPABILITIES: SoundEffectCapabilities = {
  supportsEqualizer: false,
  supportsReverb: false,
  supportsPan: false,
  supportsPitch: false,
  eqBandCount: 0,
  eqFrequencies: [],
};

function getNativeModule(): NativeSoundEffectModule | null {
  if (Platform.OS !== "android") return null;
  const mod = (NativeModules as Record<string, unknown>).SoundEffectModule as
    | NativeSoundEffectModule
    | undefined;
  return mod ?? null;
}

let attachPromise: Promise<boolean> | null = null;

/**
 * 首次调用时把音效链路挂到当前 ExoPlayer；重复调用会复用同一次 Promise。
 * 播放器还没启动时 attach 会返回 false——此时不记忆结果，下次调用重新尝试，
 * 避免“播放器就绪后音效永远挂不上”的假失效。
 */
export async function attachSoundEffects(): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod) return false;
  if (!attachPromise) {
    attachPromise = mod.attach().then((ok) => {
      if (!ok) attachPromise = null;
      return ok;
    }).catch((error) => {
      attachPromise = null;
      return false;
    });
  }
  return attachPromise;
}

export async function detachSoundEffects(): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  attachPromise = null;
  try {
    await mod.detach();
  } catch {}
}

export async function setSoundEffectsEnabled(enabled: boolean): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  try {
    await mod.setEnabled(enabled);
  } catch {}
}

export async function setEqGains(gainsDb: number[]): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  try {
    await mod.setEqGains(gainsDb);
  } catch {}
}

export async function setPan(pan: number): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  try {
    await mod.setPan(pan);
  } catch {}
}

export async function setReverbMix(mix: number): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  try {
    await mod.setReverbMix(mix);
  } catch {}
}

export async function setPitch(semitones: number): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod) return false;
  try {
    return await mod.setPitch(semitones);
  } catch (error) {
    return false;
  }
}

export async function getSoundEffectCapabilities(): Promise<SoundEffectCapabilities> {
  const mod = getNativeModule();
  if (!mod) return DEFAULT_CAPABILITIES;
  try {
    return await mod.getCapabilities();
  } catch (error) {
    return DEFAULT_CAPABILITIES;
  }
}

export function isSoundEffectSupported(): boolean {
  return getNativeModule() != null;
}
