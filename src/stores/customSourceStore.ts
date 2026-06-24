import { create } from 'zustand';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import {
  checkCustomSourceUpdate,
  parseDesktopUserApiInfo,
  testCustomSource,
  invalidateRuntimeCache,
  type DesktopUserApiHeaderInfo,
  type CustomSourceUpdateAlert,
} from '@/services/customSourceRuntime';
import { attachLibraryPersistence } from './libraryPersistence';

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
  replaceAll: (sources: CustomSourceItem[]) => void;
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
      sources: [],

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
          testStatus: 'idle',
          updateStatus: 'idle',
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ sources: [...state.sources, item] }));
        return item;
      },

      importFromFile: async () => {
        const selected = await open({
          multiple: false,
          filters: [{ name: 'LX 自定义音源', extensions: ['js', 'txt'] }],
          title: '导入 LX Music 自定义音源',
        });
        const path = typeof selected === 'string' ? selected : null;
        if (!path) return null;
        const script = await readTextFile(path);
        return get().importScript(script);
      },

      removeSource: (id) => {
        invalidateRuntimeCache(id);
        set((state) => ({ sources: state.sources.filter((source) => source.id !== id) }));
      },

      toggleSource: (id, enabled) => {
        set((state) => ({ sources: patchSource(state.sources, id, { enabled }) }));
      },

      toggleUpdateAlert: (id, enabled) => {
        set((state) => ({ sources: patchSource(state.sources, id, { allowShowUpdateAlert: enabled }) }));
      },

      moveSource: (id, direction) => {
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
        const source = get().sources.find((item) => item.id === id);
        if (!source) return;
        set((state) => ({
          sources: patchSource(state.sources, id, { testStatus: 'testing', testMessage: '测试中...' }),
        }));

        try {
          const result = await testCustomSource(source);
          set((state) => ({
            sources: patchSource(state.sources, id, {
              sources: result.sources,
              testStatus: 'ok',
              testMessage: '初始化正常',
              ...buildUpdatePatch(result.updateAlert),
            }),
          }));
        } catch (error) {
          set((state) => ({
            sources: patchSource(state.sources, id, {
              testStatus: 'failed',
              testMessage: formatError(error),
            }),
          }));
        }
      },

      checkSourceUpdate: async (id) => {
        const source = get().sources.find((item) => item.id === id);
        if (!source) return;
        set((state) => ({
          sources: patchSource(state.sources, id, {
            updateStatus: 'checking',
            updateMessage: '检测中...',
          }),
        }));

        try {
          const result = await checkCustomSourceUpdate(source);
          set((state) => ({
            sources: patchSource(state.sources, id, {
              sources: result.sources,
              testStatus: 'ok',
              testMessage: '初始化正常',
              ...buildUpdatePatch(result.updateAlert),
            }),
          }));
        } catch (error) {
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
        const ids = get().sources.map((source) => source.id);
        await Promise.allSettled(ids.map((id) => get().checkSourceUpdate(id)));
      },

      replaceAll: (sources) => {
        set({ sources: (sources ?? []).map(normalizeCustomSourceForStore) });
      },
}));

// 持久化：写盘前剔除瞬态测试态；读盘后兜底复位
export const customSourcePersistence = attachLibraryPersistence<CustomSourceStore, { sources: CustomSourceItem[] }>(
  useCustomSourceStore,
  {
    namespace: 'customSources',
    pick: (state) => ({
      sources: state.sources.map((source) => ({
        ...source,
        testStatus: 'idle' as CustomSourceTestStatus,
        testMessage: undefined,
        updateStatus: source.updateStatus === 'checking' ? 'idle' : source.updateStatus,
        updateMessage: source.updateStatus === 'checking' ? undefined : source.updateMessage,
      })),
    }),
    apply: (slice, set) =>
      set({
        sources: (slice.sources ?? []).map(normalizeCustomSourceForStore),
      }),
    legacyLocalStorageKey: 'custom-source-storage',
  },
);
