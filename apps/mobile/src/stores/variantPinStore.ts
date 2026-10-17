import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 本端「首选版本」偏好（pin）——对齐桌面端 variantPinStore：
 * 把歌曲主键映射到用户选定的变体主键，仅存本机 AsyncStorage，
 * 不参与 WebDAV 同步（两端可各自喜好不同版本）；解析候选链时把选定变体提到最前。
 */

const STORAGE_KEY = "auralflow.mobile.variantPins.v1";

type VariantPins = Record<string, string>;

let loadPromise: Promise<void> | null = null;
let hydrated = false;

function parsePins(raw: string | null): VariantPins {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as VariantPins;
  } catch {
    return {};
  }
}

async function persistPins(pins: VariantPins): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch (error) {
    console.error("[variantPins] 首选版本写盘失败", error);
  }
}

interface VariantPinState {
  pins: VariantPins;
  loadFromStorage: () => Promise<void>;
  /** 返回该歌曲被 pin 的变体主键；无 pin 返回 null */
  getPinnedVariantKey: (songKey: string) => string | null;
  /** 重复 pin 同一变体即解除；pin 另一变体则覆盖 */
  togglePinnedVariant: (songKey: string, variantKey: string) => Promise<void>;
}

export const useVariantPinStore = create<VariantPinState>((set, get) => ({
  pins: {},

  loadFromStorage: async () => {
    if (hydrated) return;
    if (loadPromise) return loadPromise;
    loadPromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        hydrated = true;
        if (raw) set({ pins: parsePins(raw) });
      })
      .catch(() => undefined)
      .finally(() => {
        loadPromise = null;
      });
    return loadPromise;
  },

  getPinnedVariantKey: (songKey) => get().pins[songKey] ?? null,

  togglePinnedVariant: async (songKey, variantKey) => {
    // 解析链与菜单都可能早于首次读取：写前确保已完成水合，避免覆盖已存偏好
    if (!hydrated) await get().loadFromStorage().catch(() => undefined);
    const next = { ...get().pins };
    if (next[songKey] === variantKey) delete next[songKey];
    else next[songKey] = variantKey;
    set({ pins: next });
    await persistPins(next);
  },
}));

// 启动即水合：service 层同步读 getState()，等到首个 pin 使用时再加载会错过播放排序
void useVariantPinStore.getState().loadFromStorage().catch(() => undefined);
