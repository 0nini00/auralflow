import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "@/services/logger";

/**
 * 本端「首选版本」偏好（pin）——对齐桌面端 variantPinStore：
 * 把歌曲主键映射到用户选定的变体主键，仅存本机 AsyncStorage，
 * 不参与 WebDAV 同步（两端可各自喜好不同版本）；解析候选链时把选定变体提到最前。
 */

const STORAGE_KEY = "auralflow.mobile.variantPins.v1";

type VariantPins = Record<string, string>;

let loadPromise: Promise<void> | null = null;
let hydrated = false;

function parsePins(raw: string): VariantPins {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("首选版本数据格式错误");
  }
  return parsed as VariantPins;
}

async function persistPins(pins: VariantPins): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch (error) {
    logger.error("[variantPins] 首选版本写盘失败", error);
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
        // 键不存在是正常的空状态；键存在但读不懂就抛错，hydrated 保持 false，
        // 之后的写入一律被拒——在空表上写盘会把读不出来的原数据覆盖掉。
        if (raw !== null) set({ pins: parsePins(raw) });
        hydrated = true;
      })
      .catch((error) => {
        logger.error("[variantPins] 首选版本读盘失败，已停止写入以免覆盖原数据", error);
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
    return loadPromise;
  },

  getPinnedVariantKey: (songKey) => get().pins[songKey] ?? null,

  togglePinnedVariant: async (songKey, variantKey) => {
    // 解析链与菜单都可能早于首次读取：写前确保已完成水合，避免覆盖已存偏好。
    // 读盘失败时这里直接抛给调用方，不继续写。
    if (!hydrated) await get().loadFromStorage();
    const next = { ...get().pins };
    if (next[songKey] === variantKey) delete next[songKey];
    else next[songKey] = variantKey;
    set({ pins: next });
    await persistPins(next);
  },
}));

// 启动即水合：service 层同步读 getState()，等到首个 pin 使用时再加载会错过播放排序。
// 失败已在 loadFromStorage 里落盘日志；这里的 catch 只是不让它再变成一条未处理拒绝。
void useVariantPinStore.getState().loadFromStorage().catch(() => undefined);
