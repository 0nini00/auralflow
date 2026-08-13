import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import RNFS from "react-native-fs";
import {
  checkCustomSourceUpdate,
  parseDesktopUserApiInfo,
  testCustomSource,
  invalidateRuntimeCache,
  type DesktopUserApiHeaderInfo,
  type CustomSourceUpdateAlert,
} from "@/services/customSourceRuntime";

const STORAGE_KEY = "auralflow.mobile.customSources";

export type CustomSourceTestStatus = "idle" | "testing" | "ok" | "failed";
export type CustomSourceUpdateStatus = "idle" | "checking" | "latest" | "available" | "failed";

export interface CustomSourceItem {
  id: string;
  name: string;
  description: string;
  script: string;
  enabled: boolean;
  allowShowUpdateAlert: boolean;
  author?: string;
  homepage?: string;
  version?: string;
  sources?: Record<string, CustomSourceSourceInfo>;
  testStatus: CustomSourceTestStatus;
  testMessage?: string;
  updateStatus?: CustomSourceUpdateStatus;
  updateMessage?: string;
  updateLog?: string;
  updateUrl?: string;
  updateCheckedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CustomSourceSourceInfo {
  type: "music";
  actions: string[];
  qualitys: string[];
}

interface CustomSourceStore {
  sources: CustomSourceItem[];
  loaded: boolean;
  customSourceAutoCheck: boolean;
  importScript: (script: string) => Promise<CustomSourceItem>;
  importFromFile: (filePath: string) => Promise<CustomSourceItem | null>;
  removeSource: (id: string) => void;
  toggleSource: (id: string, enabled: boolean) => void;
  moveSource: (id: string, direction: "up" | "down") => void;
  testSource: (id: string) => Promise<void>;
  checkSourceUpdate: (id: string) => Promise<void>;
  checkAllUpdates: () => Promise<void>;
  checkStartupUpdates: () => Promise<void>;
  toggleUpdateAlert: (id: string, enabled: boolean) => void;
  setCustomSourceAutoCheck: (enabled: boolean) => Promise<void>;
  replaceAll: (sources: CustomSourceItem[]) => void;
  loadFromStorage: () => Promise<void>;
}

interface PersistedCustomSourceState {
  sources?: CustomSourceItem[];
  customSourceAutoCheck?: boolean;
}

function makeId(): string {
  return `user_api_${Math.random().toString().slice(2, 5)}_${Date.now()}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function patchSource(
  sources: CustomSourceItem[],
  id: string,
  patch: Partial<CustomSourceItem>,
): CustomSourceItem[] {
  return sources.map((source) =>
    source.id === id ? { ...source, ...patch, updatedAt: Date.now() } : source,
  );
}

function buildUpdatePatch(updateAlert?: CustomSourceUpdateAlert): Partial<CustomSourceItem> {
  const updateCheckedAt = Date.now();
  if (!updateAlert) {
    return {
      updateStatus: "latest",
      updateMessage: undefined,
      updateLog: undefined,
      updateUrl: undefined,
      updateCheckedAt,
    };
  }
  return {
    updateStatus: "available",
    updateMessage: "发现更新",
    updateLog: updateAlert.log,
    updateUrl: updateAlert.updateUrl,
    updateCheckedAt,
  };
}

function mergeHeaderInfo(source: CustomSourceItem): CustomSourceItem {
  let info: DesktopUserApiHeaderInfo;
  try {
    info = parseDesktopUserApiInfo(source.script);
  } catch {
    return source;
  }

  return {
    ...source,
    name: info.name || source.name,
    description: info.description || source.description,
    author: info.author || undefined,
    homepage: info.homepage || undefined,
    version: info.version || undefined,
  };
}

function normalizeCustomSourceForStore(source: CustomSourceItem): CustomSourceItem {
  const normalized = mergeHeaderInfo(source);
  return {
    ...normalized,
    testStatus:
      normalized.testStatus === "testing" ? "idle" : normalized.testStatus ?? "idle",
    testMessage: normalized.testStatus === "testing" ? undefined : normalized.testMessage,
    updateStatus:
      normalized.updateStatus === "checking" ? "idle" : normalized.updateStatus ?? "idle",
    updateMessage: normalized.updateStatus === "checking" ? undefined : normalized.updateMessage,
    allowShowUpdateAlert: normalized.allowShowUpdateAlert ?? true,
  };
}

function parsePersistedState(raw: string | null): PersistedCustomSourceState {
  if (!raw) return { sources: [], customSourceAutoCheck: true };
  const parsed = JSON.parse(raw) as CustomSourceItem[] | PersistedCustomSourceState;
  if (Array.isArray(parsed)) {
    return { sources: parsed, customSourceAutoCheck: true };
  }
  return {
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    customSourceAutoCheck: parsed.customSourceAutoCheck !== false,
  };
}

/** 持久化到 AsyncStorage：写盘前剔除瞬态测试态 */
async function persistState(sources: CustomSourceItem[], customSourceAutoCheck: boolean): Promise<void> {
  try {
    const serializable = sources.map((source) => ({
      ...source,
      testStatus: "idle" as CustomSourceTestStatus,
      testMessage: undefined,
      updateStatus: source.updateStatus === "checking" ? "idle" : source.updateStatus,
      updateMessage: source.updateStatus === "checking" ? undefined : source.updateMessage,
    }));
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sources: serializable, customSourceAutoCheck }),
    );
  } catch {}
}

export const useCustomSourceStore = create<CustomSourceStore>()((set, get) => ({
  sources: [],
  loaded: false,
  customSourceAutoCheck: true,

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const persisted = parsePersistedState(raw);
      set({
        sources: (persisted.sources ?? []).map(normalizeCustomSourceForStore),
        customSourceAutoCheck: persisted.customSourceAutoCheck !== false,
        loaded: true,
      });
    } catch (error) {
      set({ customSourceAutoCheck: true, loaded: true });
    }
  },

  importScript: async (script) => {
    const info = parseDesktopUserApiInfo(script);
    const existing = get().sources.find((source) => source.script === script);
    if (existing) throw new Error(`导入失败，脚本内容与已有的源「${existing.name}」相同`);

    const now = Date.now();
    const item: CustomSourceItem = {
      id: makeId(),
      name: info.name,
      description: info.description,
      script,
      enabled: true,
      allowShowUpdateAlert: true,
      author: info.author || undefined,
      homepage: info.homepage || undefined,
      version: info.version || undefined,
      testStatus: "idle",
      updateStatus: "idle",
      createdAt: now,
      updatedAt: now,
    };
    const next = [...get().sources, item];
    set({ sources: next });
    await persistState(next, get().customSourceAutoCheck);
    return item;
  },

  importFromFile: async (filePath) => {
    if (!filePath) return null;
    const script = await RNFS.readFile(filePath, "utf8");
    return get().importScript(script);
  },

  removeSource: (id) => {
    invalidateRuntimeCache(id);
    const next = get().sources.filter((source) => source.id !== id);
    set({ sources: next });
    void persistState(next, get().customSourceAutoCheck);
  },

  toggleSource: (id, enabled) => {
    const next = patchSource(get().sources, id, { enabled });
    set({ sources: next });
    void persistState(next, get().customSourceAutoCheck);
  },

  toggleUpdateAlert: (id, enabled) => {
    const next = patchSource(get().sources, id, { allowShowUpdateAlert: enabled });
    set({ sources: next });
    void persistState(next, get().customSourceAutoCheck);
  },

  setCustomSourceAutoCheck: async (enabled) => {
    const customSourceAutoCheck = Boolean(enabled);
    set({ customSourceAutoCheck, loaded: true });
    await persistState(get().sources, customSourceAutoCheck);
  },

  moveSource: (id, direction) => {
    const sources = [...get().sources];
    const index = sources.findIndex((source) => source.id === id);
    if (index < 0) return;
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= sources.length) return;
    const [item] = sources.splice(index, 1);
    sources.splice(nextIndex, 0, item);
    set({ sources });
    void persistState(sources, get().customSourceAutoCheck);
  },

  testSource: async (id) => {
    const source = get().sources.find((item) => item.id === id);
    if (!source) return;
    set((state) => ({
      sources: patchSource(state.sources, id, { testStatus: "testing", testMessage: "测试中..." }),
    }));

    try {
      const result = await testCustomSource(source);
      const next = patchSource(get().sources, id, {
        sources: result.sources,
        testStatus: "ok",
        testMessage: "初始化正常",
        ...buildUpdatePatch(result.updateAlert),
      });
      set({ sources: next });
      await persistState(next, get().customSourceAutoCheck);
    } catch (error) {
      const next = patchSource(get().sources, id, {
        testStatus: "failed",
        testMessage: formatError(error),
      });
      set({ sources: next });
      await persistState(next, get().customSourceAutoCheck);
    }
  },

  checkSourceUpdate: async (id) => {
    const source = get().sources.find((item) => item.id === id);
    if (!source) return;
    set((state) => ({
      sources: patchSource(state.sources, id, {
        updateStatus: "checking",
        updateMessage: "检测中...",
      }),
    }));

    try {
      const result = await checkCustomSourceUpdate(source);
      const next = patchSource(get().sources, id, {
        sources: result.sources,
        testStatus: "ok",
        testMessage: "初始化正常",
        ...buildUpdatePatch(result.updateAlert),
      });
      set({ sources: next });
      await persistState(next, get().customSourceAutoCheck);
    } catch (error) {
      const next = patchSource(get().sources, id, {
        updateStatus: "failed",
        updateMessage: formatError(error),
        updateCheckedAt: Date.now(),
      });
      set({ sources: next });
      await persistState(next, get().customSourceAutoCheck);
    }
  },

  checkAllUpdates: async () => {
    const ids = get().sources.map((source) => source.id);
    // 限制并发，避免一次拉起过多自定义音源更新请求（对齐桌面端 CONCURRENCY = 2）
    const CONCURRENCY = 2;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map((id) => get().checkSourceUpdate(id)));
    }
  },

  checkStartupUpdates: async () => {
    if (!get().loaded) {
      await get().loadFromStorage();
    }
    if (!get().customSourceAutoCheck || get().sources.length === 0) return;
    await get().checkAllUpdates();
  },

  replaceAll: (sources) => {
    const next = (sources ?? []).map(normalizeCustomSourceForStore);
    set({ sources: next });
    void persistState(next, get().customSourceAutoCheck);
  },
}));
