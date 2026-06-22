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
      console.error(`[library:${namespace}] save failed`, err);
    }
  };

  const schedule = (slice: S) => {
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
            console.warn(`[library:${namespace}] legacy parse failed`, err);
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
      console.error(`[library:${namespace}] load failed`, err);
    } finally {
      resolveReady();
    }
  })();

  return {
    ready,
    flush: writeNow,
  };
}
