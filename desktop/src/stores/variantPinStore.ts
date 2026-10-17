import { create } from "zustand";

/**
 * 本端「首选版本」偏好（pin）：把歌曲主键映射到用户选定的变体主键。
 * 仅存本机 localStorage，不参与 WebDAV 同步（两端可各自喜好不同版本）；
 * 播放/下载解析候选链时把选定变体提到最前，未命中 pin 时保持常规顺序。
 */

const STORAGE_KEY = "af-variant-pins";

type VariantPins = Record<string, string>;

function loadPins(): VariantPins {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as VariantPins) : {};
  } catch {
    return {};
  }
}

function persistPins(pins: VariantPins): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // 配额满/隐私模式：pin 只是偏好，写盘失败静默，不影响本次播放
  }
}

interface VariantPinState {
  pins: VariantPins;
  /** 返回该歌曲被 pin 的变体主键；无 pin 返回 null */
  getPinnedVariantKey: (songKey: string) => string | null;
  /** 重复 pin 同一变体即解除；pin 另一变体则覆盖 */
  togglePinnedVariant: (songKey: string, variantKey: string) => void;
}

export const useVariantPinStore = create<VariantPinState>((set, get) => ({
  pins: loadPins(),

  getPinnedVariantKey: (songKey) => get().pins[songKey] ?? null,

  togglePinnedVariant: (songKey, variantKey) => {
    const next = { ...get().pins };
    if (next[songKey] === variantKey) delete next[songKey];
    else next[songKey] = variantKey;
    set({ pins: next });
    persistPins(next);
  },
}));
