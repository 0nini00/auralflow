import { create } from 'zustand';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import {
  checkCustomSourceUpdate,
  parseDesktopUserApiInfo,
  testCustomSourceDeep,
  invalidateRuntimeCache,
  invalidateAllRuntimeCaches,
  type DesktopUserApiHeaderInfo,
  type CustomSourceUpdateAlert,
} from '@/services/customSourceRuntime';
import { attachLibraryPersistence } from './libraryPersistence';
import { createCustomSourceAccess } from '@/services/customSourceAccess';

export type CustomSourceTestStatus = 'idle' | 'testing' | 'ok' | 'failed';
export type CustomSourceUpdateStatus = 'idle' | 'checking' | 'latest' | 'available' | 'failed';

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
  type: 'music';
  actions: string[];
  qualitys: string[];
}

interface CustomSourceStore {
  featureEnabled: boolean;
  featureReady: boolean;
  featureLoadError: string | null;
  setFeatureEnabled: (enabled: boolean) => Promise<void>;
  sources: CustomSourceItem[];
  importScript: (script: string) => Promise<CustomSourceItem>;
  importFromFile: () => Promise<CustomSourceItem | null>;
  removeSource: (id: string) => void;
  toggleSource: (id: string, enabled: boolean) => void;
  moveSource: (id: string, direction: 'up' | 'down') => void;
  testSource: (id: string) => Promise<void>;
  checkSourceUpdate: (id: string) => Promise<void>;
  checkAllUpdates: () => Promise<void>;
  toggleUpdateAlert: (id: string, enabled: boolean) => void;
  /** 运行时上浮：播放/取链期间脚本上报 updateAlert 时写入，让全局更新弹窗能弹出 */
  applyRuntimeUpdateAlert: (id: string, alert: CustomSourceUpdateAlert) => void;
  replaceAll: (sources: CustomSourceItem[]) => void;
}

// 远端更新检查节流间隔：同一源距上次远端检查不足 24 小时不再重复拉取
const REMOTE_CHECK_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function makeId(): string {
  return `user_api_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function patchSource(
  sources: CustomSourceItem[],
  id: string,
  patch: Partial<CustomSourceItem>,
): CustomSourceItem[] {
  return sources.map((source) => (
    source.id === id ? { ...source, ...patch, updatedAt: Date.now() } : source
  ));
}

function buildUpdatePatch(updateAlert?: CustomSourceUpdateAlert): Partial<CustomSourceItem> {
  const updateCheckedAt = Date.now();
  if (!updateAlert) {
    return {
      updateStatus: 'latest',
      updateMessage: undefined,
      updateLog: undefined,
      updateUrl: undefined,
      updateCheckedAt,
    };
  }
  return {
    updateStatus: 'available',
    updateMessage: '发现更新',
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
      normalized.testStatus === 'testing' ? 'idle' : normalized.testStatus ?? 'idle',
    testMessage: normalized.testStatus === 'testing' ? undefined : normalized.testMessage,
    updateStatus: normalized.updateStatus === 'checking' ? 'idle' : normalized.updateStatus ?? 'idle',
    updateMessage: normalized.updateStatus === 'checking' ? undefined : normalized.updateMessage,
    allowShowUpdateAlert: normalized.allowShowUpdateAlert ?? true,
  };
}

export const useCustomSourceStore = create<CustomSourceStore>()((set, get) => ({
      featureEnabled: false,
      featureReady: false,
      featureLoadError: null,
      sources: [],

      setFeatureEnabled: async (enabled) => {
        if (typeof enabled !== 'boolean') throw new Error('自定义音源开关必须是布尔值');
        await customSourcePersistence.ready;
        if (customSourcePersistence.loadError) throw customSourcePersistence.loadError;
        if (get().featureEnabled === enabled) {
          await customSourcePersistence.flush();
          return;
        }
        // 先使旧任务失效，再发布新状态；关闭后重新开启也不能接收旧回调。
        customSourceAccess.invalidate();
        invalidateAllRuntimeCaches();
        set((state) => ({
          featureEnabled: enabled,
          sources: state.sources.map((source) => ({
            ...source,
            ...(source.testStatus === 'testing' ? { testStatus: 'idle' as const, testMessage: undefined } : {}),
            ...(source.updateStatus === 'checking' ? { updateStatus: 'idle' as const, updateMessage: undefined } : {}),
          })),
        }));
        await customSourcePersistence.flush();
      },

      importScript: async (script) => {
        await customSourcePersistence.ready;
        customSourceAccess.capture();
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
          testStatus: 'idle',
          updateStatus: 'idle',
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ sources: [...state.sources, item] }));
        return item;
      },

      importFromFile: async () => {
        await customSourcePersistence.ready;
        const operation = customSourceAccess.capture();
        const selected = await open({
          multiple: false,
          filters: [{ name: 'LX 自定义音源', extensions: ['js', 'txt'] }],
          title: '导入 LX Music 自定义音源',
        });
        operation.assertActive();
        const path = typeof selected === 'string' ? selected : null;
        if (!path) return null;
        const script = await readTextFile(path);
        operation.assertActive();
        return get().importScript(script);
      },

      removeSource: (id) => {
        customSourceAccess.capture();
        invalidateRuntimeCache(id);
        set((state) => ({ sources: state.sources.filter((source) => source.id !== id) }));
      },

      toggleSource: (id, enabled) => {
        customSourceAccess.capture();
        set((state) => ({ sources: patchSource(state.sources, id, { enabled }) }));
      },

      toggleUpdateAlert: (id, enabled) => {
        customSourceAccess.capture();
        set((state) => ({ sources: patchSource(state.sources, id, { allowShowUpdateAlert: enabled }) }));
      },

      // 对齐 LX Music mobile 行为：脚本在任意时刻 send updateAlert 都写入 store。
      // 手动检测（checkSourceUpdate）已在 checking 状态下自行消费同一事件并写入，
      // 这里若也覆盖会把「检测中...」的中问状态提前抹掉，因此 checking 时直接跳过；
      // 复用 buildUpdatePatch 的字段结构，仅换提示语来源区分上报渠道。
      applyRuntimeUpdateAlert: (id, alert) => {
        if (!get().featureEnabled || !get().featureReady) return;
        const source = get().sources.find((item) => item.id === id);
        if (!source) return;
        if (source.updateStatus === 'checking') return;
        set((state) => ({
          sources: patchSource(state.sources, id, {
            updateStatus: 'available',
            updateMessage: '音源运行时上报更新',
            updateLog: alert.log,
            updateUrl: alert.updateUrl,
            updateCheckedAt: Date.now(),
          }),
        }));
      },

      moveSource: (id, direction) => {
        customSourceAccess.capture();
        set((state) => {
          const sources = [...state.sources];
          const index = sources.findIndex((source) => source.id === id);
          if (index < 0) return state;
          const nextIndex = direction === 'up' ? index - 1 : index + 1;
          if (nextIndex < 0 || nextIndex >= sources.length) return state;
          const [item] = sources.splice(index, 1);
          sources.splice(nextIndex, 0, item);
          return { sources };
        });
      },

      testSource: async (id) => {
        await customSourcePersistence.ready;
        const operation = customSourceAccess.capture();
        const source = get().sources.find((item) => item.id === id);
        if (!source) return;
        set((state) => ({
          sources: patchSource(state.sources, id, { testStatus: 'testing', testMessage: '测试中...' }),
        }));

        try {
          // init 通过后自动继续深度取链测试；未声明 musicUrl 能力的脚本仅验证初始化
          const result = await testCustomSourceDeep(source, operation);
          if (!operation.isActive()) return;
          set((state) => ({
            sources: patchSource(state.sources, id, {
              sources: result.sources,
              testStatus: result.ok ? 'ok' : 'failed',
              testMessage: result.message,
              ...buildUpdatePatch(result.updateAlert),
            }),
          }));
        } catch (error) {
          if (!operation.isActive()) return;
          set((state) => ({
            sources: patchSource(state.sources, id, {
              testStatus: 'failed',
              testMessage: formatError(error),
            }),
          }));
        }
      },

      checkSourceUpdate: async (id) => {
        await customSourcePersistence.ready;
        const operation = customSourceAccess.capture();
        const source = get().sources.find((item) => item.id === id);
        if (!source) return;
        set((state) => ({
          sources: patchSource(state.sources, id, {
            updateStatus: 'checking',
            updateMessage: '检测中...',
          }),
        }));

        try {
          const result = await checkCustomSourceUpdate(source, operation);
          if (!operation.isActive()) return;
          set((state) => ({
            sources: patchSource(state.sources, id, {
              sources: result.sources,
              testStatus: 'ok',
              testMessage: '初始化正常',
              ...buildUpdatePatch(result.updateAlert),
            }),
          }));
        } catch (error) {
          if (!operation.isActive()) return;
          set((state) => ({
            sources: patchSource(state.sources, id, {
              updateStatus: 'failed',
              updateMessage: formatError(error),
              updateCheckedAt: Date.now(),
            }),
          }));
        }
      },

      checkAllUpdates: async () => {
        await customSourcePersistence.ready;
        const operation = customSourceAccess.capture();
        const now = Date.now();
        // 距上次远端检查不足 24 小时且上次未失败的源跳过检查，保留现有状态（不写盘）
        const ids = get().sources
          .filter((source) => (
            !source.updateCheckedAt
            || source.updateStatus === 'failed'
            || now - source.updateCheckedAt >= REMOTE_CHECK_MIN_INTERVAL_MS
          ))
          .map((source) => source.id);
        // 限制并发，避免一次拉起过多自定义音源更新请求
        const CONCURRENCY = 2;
        for (let i = 0; i < ids.length; i += CONCURRENCY) {
          if (!operation.isActive()) return;
          const batch = ids.slice(i, i + CONCURRENCY);
          await Promise.allSettled(batch.map((id) => get().checkSourceUpdate(id)));
        }
      },

      replaceAll: (sources) => {
        customSourceAccess.capture();
        invalidateAllRuntimeCaches();
        set({ sources: (sources ?? []).map(normalizeCustomSourceForStore) });
      },
}));

export const customSourceAccess = createCustomSourceAccess(() => {
  const state = useCustomSourceStore.getState();
  return state.featureReady && state.featureEnabled;
});

interface CustomSourceSnapshot {
  featureEnabled?: boolean;
  sources: CustomSourceItem[];
}

// 持久化：总开关只在本机保存，云端 replaceAll 只更新源列表。
export const customSourcePersistence = attachLibraryPersistence<CustomSourceStore, CustomSourceSnapshot>(
  useCustomSourceStore,
  {
    namespace: 'customSources',
    shouldPersist: (state, previous) => state.featureEnabled !== previous.featureEnabled || state.sources !== previous.sources,
    pick: (state) => ({
      featureEnabled: state.featureEnabled,
      sources: state.sources.map((source) => ({
        ...source,
        testStatus: 'idle' as CustomSourceTestStatus,
        testMessage: undefined,
        updateStatus: source.updateStatus === 'checking' ? 'idle' : source.updateStatus,
        updateMessage: source.updateStatus === 'checking' ? undefined : source.updateMessage,
      })),
    }),
    apply: (slice, set) => {
      if (slice.featureEnabled !== undefined && typeof slice.featureEnabled !== 'boolean') {
        throw new Error('自定义音源设置损坏：featureEnabled 必须是布尔值');
      }
      const sources = (slice.sources ?? []).map(normalizeCustomSourceForStore);
      set({
        // 旧版已有音源保留可用性；空数据与新安装默认关闭。
        featureEnabled: slice.featureEnabled ?? sources.length > 0,
        sources,
      });
    },
    legacyLocalStorageKey: 'custom-source-storage',
  },
);

void customSourcePersistence.ready.then(() => {
  const error = customSourcePersistence.loadError;
  useCustomSourceStore.setState({
    featureReady: error === null,
    featureLoadError: error ? `无法恢复自定义音源设置：${error.message}` : null,
  });
});
