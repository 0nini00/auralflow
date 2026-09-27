/**
 * Library 持久化 helper（B-mid）
 *
 * 用于把 zustand store 的数据从浏览器 localStorage 迁到 Rust 侧的
 * AppData/library/<namespace>.json。
 *
 * 用法：在 store 工厂里调用 `attachLibraryPersistence(useStore, {...})`，
 *  - 启动时一次性读 Rust 侧数据 + 检测 localStorage 旧数据并迁移。
 *  - 每次 setState 后 debounce 写盘。
 */

import { libraryLoad, librarySave, type LibraryNamespace } from "@lx/tauri-bridge";
import type { StoreApi, UseBoundStore } from "zustand";

interface AttachOptions<T, S> {
  namespace: LibraryNamespace;
  /** 从 store state 抽取要持久化的子集 */
  pick: (state: T) => S;
  /** 将盘上的 S 合并回 store state */
  apply: (slice: S, set: (partial: Partial<T>) => void) => void;
  /** 旧 localStorage key —— 用于一次性迁移；可选 */
  legacyLocalStorageKey?: string;
  /** 从 localStorage 读到的 JSON 中抽取要保存的 slice；默认假设结构是 zustand-persist 的 { state, version } */
  extractLegacy?: (parsed: unknown) => S | null;
  /** debounce 写盘毫秒数；默认 300 */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE = 300;

/** 默认从 zustand-persist 格式 {state, version} 中提取 state */
function defaultExtractLegacy<S>(parsed: unknown): S | null {
  if (parsed && typeof parsed === "object" && "state" in (parsed as object)) {
    return (parsed as { state: S }).state ?? null;
  }
  return (parsed as S) ?? null;
}

export interface LibraryPersistenceController {
  /** 启动后等候首次加载完成；UI 可在 hydrate 后再渲染 */
  ready: Promise<void>;
  /** 立刻写盘，跳过 debounce */
  flush: () => Promise<void>;
}

/**
 * 已挂载的持久化控制器注册表。
 *
 * 写盘是 debounce 的：进程被直接结束（托盘退出 → `app.exit(0)`）时，最后一次
 * 修改还躺在定时器里，会静默丢失。退出/隐藏前用 `flushLibraryPersistence()`
 * 把所有 store 的待写内容一把落盘。
 */
const persistenceControllers = new Set<LibraryPersistenceController>();

/** 立刻把所有 debounce 中的写盘落盘；单个失败不影响其余。 */
export async function flushLibraryPersistence(): Promise<void> {
  await Promise.allSettled(
    [...persistenceControllers].map((controller) => controller.flush()),
  );
}

/** 读盘失败（磁盘上已有数据但读不出来）的命名空间。 */
const degradedNamespaces = new Set<LibraryNamespace>();
const degradedListeners = new Set<() => void>();
/** 快照必须保持引用稳定，否则 useSyncExternalStore 会无限重渲染。 */
let degradedSnapshot: LibraryNamespace[] = [];

/** 命名空间的中文名，供 UI 提示使用。 */
export const LIBRARY_NAMESPACE_LABELS: Record<LibraryNamespace, string> = {
  favorites: "我喜欢的音乐",
  playlists: "本地歌单",
  library: "本地曲库",
  customSources: "自定义音源",
  recent: "最近播放",
  cache: "缓存",
  dailyRecommend: "每日推荐",
};

/** 当前因读盘失败而停用写盘的命名空间（引用稳定，可直接给 useSyncExternalStore）。 */
export function getDegradedLibraryNamespaces(): LibraryNamespace[] {
  return degradedSnapshot;
}

export function subscribeDegradedLibraryNamespaces(listener: () => void): () => void {
  degradedListeners.add(listener);
  return () => {
    degradedListeners.delete(listener);
  };
}

function markNamespaceDegraded(namespace: LibraryNamespace): void {
  if (degradedNamespaces.has(namespace)) return;
  degradedNamespaces.add(namespace);
  degradedSnapshot = [...degradedNamespaces];
  for (const listener of degradedListeners) listener();
}

export function attachLibraryPersistence<T, S>(
  store: UseBoundStore<StoreApi<T>> | StoreApi<T>,
  opts: AttachOptions<T, S>,
): LibraryPersistenceController {
  const {
    namespace,
    pick,
    apply,
    legacyLocalStorageKey,
    extractLegacy = defaultExtractLegacy,
    debounceMs = DEFAULT_DEBOUNCE,
  } = opts;

  const api: StoreApi<T> = "getState" in store ? (store as StoreApi<T>) : (store as any);

  let suppressed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: S | null = null;
  /**
   * 磁盘上已有数据但读不出来（损坏/权限）时为 true。
   *
   * 此时内存里是空数据，若继续写盘就会把用户数据整个覆盖掉；
   * 宁可本轮不写，也不能用「读失败后的空状态」落盘。
   */
  let loadFailed = false;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const writeNow = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending == null) return;
    const snapshot = pending;
    pending = null;
    try {
      await librarySave(namespace, snapshot as unknown);
    } catch (err) {
      // 必须留痕：用户数据（收藏/歌单/历史）静默不落盘比报错更难排查
      console.error(`[library] 写入 ${namespace} 失败`, err);
    }
  };

  const schedule = (slice: S) => {
    if (loadFailed) return;
    pending = slice;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void writeNow();
    }, debounceMs);
  };

  // 订阅状态变化
  api.subscribe((state) => {
    if (suppressed) return;
    schedule(pick(state));
  });

  // 启动加载
  void (async () => {
    try {
      let slice: S | null = (await libraryLoad<S>(namespace)) ?? null;

      // 一次性 localStorage → Rust 迁移
      if (slice == null && legacyLocalStorageKey) {
        const raw = typeof localStorage !== "undefined"
          ? localStorage.getItem(legacyLocalStorageKey)
          : null;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            const extracted = extractLegacy(parsed);
            if (extracted != null) {
              slice = extracted;
              await librarySave(namespace, extracted as unknown);
              localStorage.removeItem(legacyLocalStorageKey);
            }
          } catch (err) {
            console.error(`[library] 迁移 localStorage(${legacyLocalStorageKey}) 失败`, err);
          }
        }
      }

      if (slice != null) {
        suppressed = true;
        try {
          apply(slice, (partial) => api.setState(partial as any));
        } finally {
          suppressed = false;
        }
      }
    } catch (err) {
      loadFailed = true;
      markNamespaceDegraded(namespace);
      console.error(
        `[library] 加载 ${namespace} 失败：已停用本命名空间的写盘，避免用空数据覆盖磁盘上的用户数据`,
        err,
      );
    } finally {
      resolveReady();
    }
  })();

  const controller: LibraryPersistenceController = {
    ready,
    flush: writeNow,
  };
  persistenceControllers.add(controller);
  return controller;
}
