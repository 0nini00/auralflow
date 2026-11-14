import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import RNFS from "react-native-fs";
import { createSerialTaskQueue } from "@/utils/serialTaskQueue";
import {
  checkCustomSourceUpdate,
  parseDesktopUserApiInfo,
  testCustomSourceDeep,
  invalidateRuntimeCache,
  type DesktopUserApiHeaderInfo,
  type CustomSourceUpdateAlert,
} from "@/services/customSourceRuntime";
import { clearCrossSourceVariantCache } from "@/services/crossSourceFallbackService";
import { moveSourceItem } from "@/services/sourceReorderModel";

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
  removeSource: (id: string) => Promise<void>;
  toggleSource: (id: string, enabled: boolean) => Promise<void>;
  moveSource: (id: string, direction: "up" | "down") => Promise<void>;
  /** 拖拽排序落库：按槽位搬移（from/to 越界时原样返回） */
  reorderSource: (from: number, to: number) => Promise<void>;
  testSource: (id: string) => Promise<void>;
  checkSourceUpdate: (id: string) => Promise<void>;
  applyRuntimeUpdateAlert: (id: string, alert: CustomSourceUpdateAlert) => Promise<void>;
  checkAllUpdates: () => Promise<void>;
  checkStartupUpdates: () => Promise<void>;
  toggleUpdateAlert: (id: string, enabled: boolean) => Promise<void>;
  setCustomSourceAutoCheck: (enabled: boolean) => Promise<void>;
  replaceAll: (sources: CustomSourceItem[]) => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

interface PersistedCustomSourceState {
  sources?: CustomSourceItem[];
  customSourceAutoCheck?: boolean;
}

// 远端更新检查节流间隔：同一源距上次远端检查不足 24 小时不再重复拉取（对齐桌面端）
const REMOTE_CHECK_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sources)) {
    throw new Error("音源数据格式错误");
  }
  return {
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    customSourceAutoCheck: parsed.customSourceAutoCheck !== false,
  };
}

/** 持久化到 AsyncStorage：写盘前剔除瞬态测试态 */
async function persistState(sources: CustomSourceItem[], customSourceAutoCheck: boolean): Promise<void> {
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
}

export const useCustomSourceStore = create<CustomSourceStore>()((set, get) => {
  const enqueue = createSerialTaskQueue();

  async function hydrateSources(): Promise<void> {
    if (get().loaded) return;
    const persisted = parsePersistedState(await AsyncStorage.getItem(STORAGE_KEY));
    set({
      sources: (persisted.sources ?? []).map(normalizeCustomSourceForStore),
      customSourceAutoCheck: persisted.customSourceAutoCheck !== false,
      loaded: true,
    });
  }

  function withSources<T>(operation: () => Promise<T>): Promise<T> {
    return enqueue(async () => {
      await hydrateSources();
      return operation();
    });
  }

  function commitSources(
    update: (sources: CustomSourceItem[]) => CustomSourceItem[],
    onCommitted?: (previous: CustomSourceItem[]) => void,
  ): Promise<void> {
    return withSources(async () => {
      const previous = get().sources;
      const sources = update(previous);
      if (sources === previous) return;
      await persistState(sources, get().customSourceAutoCheck);
      set({ sources });
      onCommitted?.(previous);
    });
  }

  async function runSourceCheck(id: string, deep: boolean): Promise<void> {
    const source = await withSources(async () => {
      const current = get().sources.find((item) => item.id === id);
      if (!current) return undefined;
      set({ sources: patchSource(get().sources, id, deep
        ? { testStatus: "testing", testMessage: "测试中..." }
        : { updateStatus: "checking", updateMessage: "检测中..." }) });
      return current;
    });
    if (!source) return;

    let patch: Partial<CustomSourceItem>;
    try {
      if (deep) {
        const result = await testCustomSourceDeep(source);
        patch = { sources: result.sources, testStatus: result.ok ? "ok" : "failed",
          testMessage: result.message, ...buildUpdatePatch(result.updateAlert) };
      } else {
        const result = await checkCustomSourceUpdate(source);
        patch = { sources: result.sources, testStatus: "ok", testMessage: "初始化正常",
          ...buildUpdatePatch(result.updateAlert) };
      }
    } catch (error) {
      patch = deep
        ? { testStatus: "failed", testMessage: formatError(error) }
        : { updateStatus: "failed", updateMessage: formatError(error), updateCheckedAt: Date.now() };
    }

    const isCurrentSource = (sources: CustomSourceItem[]) => sources.some((item) => item.id === id && item.script === source.script);
    try {
      await commitSources((sources) => isCurrentSource(sources) ? patchSource(sources, id, patch) : sources);
    } catch (error) {
      // 检测态不落盘；写盘失败也要退出检测态，同时将失败交回 UI/同步调用方。
      await withSources(async () => {
        if (!isCurrentSource(get().sources)) return;
        set({ sources: patchSource(get().sources, id, deep
          ? { testStatus: "failed", testMessage: formatError(error) }
          : { updateStatus: "failed", updateMessage: formatError(error) }) });
      });
      throw error;
    }
  }

  return ({
  sources: [],
  loaded: false,
  customSourceAutoCheck: true,

  loadFromStorage: () => enqueue(hydrateSources),

  importScript: (script) => withSources(async () => {
    const info = parseDesktopUserApiInfo(script);
    const existing = get().sources.find((source) => source.script === script);
    if (existing) throw new Error(`导入失败，脚本内容与已有的音源「${existing.name}」相同`);

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
    await persistState(next, get().customSourceAutoCheck);
    set({ sources: next });
    // 脚本集合变更会改变可解析的候选版本，清掉降级搜索缓存
    clearCrossSourceVariantCache();
    return item;
  }),

  importFromFile: async (filePath) => {
    if (!filePath) return null;
    const script = await RNFS.readFile(filePath, "utf8");
    return get().importScript(script);
  },

  removeSource: (id) => commitSources((sources) => sources.filter((source) => source.id !== id), () => {
    invalidateRuntimeCache(id);
    clearCrossSourceVariantCache();
  }),

  toggleSource: (id, enabled) => commitSources((sources) => patchSource(sources, id, { enabled }), () => {
    if (!enabled) invalidateRuntimeCache(id);
    clearCrossSourceVariantCache();
  }),

  toggleUpdateAlert: (id, enabled) => commitSources((sources) => patchSource(sources, id, { allowShowUpdateAlert: enabled })),

  setCustomSourceAutoCheck: (enabled) => withSources(async () => {
    const customSourceAutoCheck = Boolean(enabled);
    await persistState(get().sources, customSourceAutoCheck);
    set({ customSourceAutoCheck });
  }),

  moveSource: (id, direction) => commitSources((sources) => {
    const index = sources.findIndex((source) => source.id === id);
    if (index < 0) return sources;
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= sources.length) return sources;
    return moveSourceItem(sources, index, nextIndex);
  }, clearCrossSourceVariantCache),

  reorderSource: (from, to) => commitSources((sources) => {
    if (from === to) return sources;
    const next = moveSourceItem(sources, from, to);
    // 越界时 moveSourceItem 返回等长副本；只有真的换位才落库，避免无意义写盘
    return next.every((source, index) => source === sources[index]) ? sources : next;
  }, clearCrossSourceVariantCache),

  testSource: (id) => runSourceCheck(id, true),

  checkSourceUpdate: (id) => runSourceCheck(id, false),

  // 运行时上报：正常播放/下载取链时脚本主动 send(updateAlert)，写入后由
  // CustomSourceUpdateModal 按 updateStatus === "available" 自动弹出。
  // 正在检测中的源忽略，避免与 checkSourceUpdate 的结果互相覆盖
  applyRuntimeUpdateAlert: (id, alert) => commitSources((sources) => {
    const source = sources.find((item) => item.id === id);
    if (!source || source.updateStatus === "checking") return sources;
    return patchSource(sources, id, {
      updateStatus: "available",
      updateMessage: "音源检测到新版本",
      updateLog: alert.log,
      updateUrl: alert.updateUrl,
      updateCheckedAt: Date.now(),
    });
  }),

  checkAllUpdates: async () => {
    await get().loadFromStorage();
    const now = Date.now();
    // 距上次远端检查不足 24 小时且上次未失败的源跳过检查，保留现有状态（不写盘）
    const ids = get().sources
      .filter(
        (source) =>
          !source.updateCheckedAt ||
          source.updateStatus === "failed" ||
          now - source.updateCheckedAt >= REMOTE_CHECK_MIN_INTERVAL_MS,
      )
      .map((source) => source.id);
    // 限制并发，避免一次拉起过多自定义音源更新请求（对齐桌面端 CONCURRENCY = 2）
    const CONCURRENCY = 2;
    // 单批失败不能中断其余批次：全部跑完再统一上报首个失败原因，
    // 否则一次写盘抖动就会让排在后面的音源永远得不到检查。
    let firstFailure: PromiseRejectedResult | undefined;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map((id) => get().checkSourceUpdate(id)));
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failed && !firstFailure) firstFailure = failed;
    }
    if (firstFailure) throw firstFailure.reason;
  },

  checkStartupUpdates: async () => {
    if (!get().loaded) {
      await get().loadFromStorage();
    }
    if (!get().customSourceAutoCheck || get().sources.length === 0) return;
    await get().checkAllUpdates();
  },

  replaceAll: (sources) => commitSources(() => sources.map(normalizeCustomSourceForStore), (previous) => {
    for (const source of previous) invalidateRuntimeCache(source.id);
    clearCrossSourceVariantCache();
  }),
  });
});
