import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  TAURI_EVENTS,
  listenTauriEvent,
  loadSettings,
  patchSettings,
  resetSettings,
  type RustAppSettings,
  type TauriEventPayloads,
} from "@lx/tauri-bridge";
import { logger } from "@/services/logger";

/**
 * 设置在前端的唯一持有者。
 *
 * 真相在 Rust 的设置文件里，这里是每个窗口（各自独立的 WebView）对它的一份镜像：
 * - 读：`ensureSettingsLoaded()` 每个窗口读一次；之后只在收到 `settings-changed` 时重读。
 * - 写：只有 `updateSettings` / `resetSettingsToDefault` 两个入口，结果以 Rust 的返回值为准。
 * - 别的窗口或 Rust 自己改了设置：靠 `settings-changed` 事件重读，窗口之间不再互相转发值。
 *
 * 不变量：
 * 1. `settings === null` 表示「还没读到」，不是任何一种用户选择。这里不放占位默认值，
 *    调用方必须自己处理 null（组件不渲染或禁用，服务 `await ensureSettingsLoaded()`）。
 * 2. 对 Rust 的读和写串行执行（见 `enqueue`），所以后写进 store 的一定是更新的值，
 *    不会出现「较早发出的写入返回值盖掉较晚读到的结果」。
 */

/**
 * 只由 Rust 读写的窗口几何字段：拖动歌词窗、主窗口、迷你播放器时由 Rust 落盘，前端从不读取
 * （前端唯一的相关操作是把歌词窗几何写成 null 来「重置位置」）。
 *
 * 它们不属于 store 的状态：只涉及这些字段的 `settings-changed` 不触发重读，否则拖动一次
 * 窗口，每个 WebView 都要跟着反复读盘、解密凭证，却没有任何界面会因此变化。
 */
const RUST_OWNED_GEOMETRY_KEYS = [
  "lyricWindowX",
  "lyricWindowY",
  "lyricWindowWidth",
  "lyricWindowHeight",
  "mainWindowX",
  "mainWindowY",
  "miniPlayerX",
  "miniPlayerY",
] as const satisfies ReadonlyArray<keyof RustAppSettings>;

type RustOwnedGeometryKey = (typeof RUST_OWNED_GEOMETRY_KEYS)[number];

/** 前端可读的设置：不含只由 Rust 读写的窗口几何（那些字段在这里可能是旧值，类型上不可见）。 */
export type AppSettings = Omit<RustAppSettings, RustOwnedGeometryKey>;

/** 写入可以带几何字段（重置歌词窗位置）。 */
export type SettingsPatch = Partial<RustAppSettings>;

interface SettingsStoreState {
  /** null = 还没读到（见文件头的不变量 1）。 */
  settings: AppSettings | null;
  /** 最近一次读取失败的原因；读取成功后清空。 */
  loadError: string | null;
}

const INITIAL_STATE: SettingsStoreState = { settings: null, loadError: null };

export const useSettingsStore = create<SettingsStoreState>(() => INITIAL_STATE);

/**
 * 组件读已加载的设置。只能用在「上层已按 settings !== null 把关」的界面里（设置页、歌词窗）；
 * 未加载时调用即抛错，而不是悄悄给一个占位值。可能在加载前渲染的组件直接用
 * `useSettingsStore` 并自己处理 null。
 */
export function useLoadedSettings<T>(selector: (settings: AppSettings) => T): T {
  return useSettingsStore((state) => {
    if (!state.settings) throw new Error("设置尚未加载：useLoadedSettings 只能用在已确认加载完成的界面里");
    return selector(state.settings);
  });
}

const geometryKeys: ReadonlySet<string> = new Set(RUST_OWNED_GEOMETRY_KEYS);

/** 串行队列的尾巴。只用来排队，永不拒绝：每个操作自己的失败由它返回的 promise 交给调用方。 */
let queueTail: Promise<void> = Promise.resolve();
/** 已排队但尚未开始的重读：其间再来的刷新请求并入它，不重复读盘。 */
let pendingReload: Promise<AppSettings> | null = null;
let initialLoad: Promise<AppSettings> | null = null;
let unlistenSettingsChanged: UnlistenFn | null = null;

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueTail.then(operation);
  queueTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readIntoStore(): Promise<AppSettings> {
  try {
    const settings = await loadSettings();
    useSettingsStore.setState({ settings, loadError: null });
    return settings;
  } catch (error) {
    useSettingsStore.setState({ loadError: errorMessage(error) });
    throw error;
  }
}

/** 重新从 Rust 读一次设置。读取失败时保留上一份值并记下 `loadError`，同时把错误抛给调用方。 */
export function reloadSettings(): Promise<AppSettings> {
  if (pendingReload) return pendingReload;
  const reload = enqueue(() => {
    // 已经开始读了：此后到达的变更可能不在这次结果里，必须另排一次。
    pendingReload = null;
    return readIntoStore();
  });
  pendingReload = reload;
  return reload;
}

function onSettingsChanged({ changedKeys }: TauriEventPayloads[typeof TAURI_EVENTS.settingsChanged]): void {
  if (changedKeys.every((key) => geometryKeys.has(key))) return;
  reloadSettings().catch((error) => {
    logger.warn("[设置] 设置已变更，但重新读取失败，界面可能仍是旧值", error);
  });
}

async function subscribeAndLoad(): Promise<AppSettings> {
  // 先订阅再读：两步之间落盘的修改也会触发一次重读，不会漏掉。
  unlistenSettingsChanged ??= await listenTauriEvent(TAURI_EVENTS.settingsChanged, onSettingsChanged);
  return reloadSettings();
}

/**
 * 取已加载的设置；本窗口第一次调用时订阅 `settings-changed` 并读盘，之后不再读。
 * 每个窗口在启动入口（main.tsx）调用一次；服务层需要设置时也 await 它。
 * 失败不会被记住：下一次调用会重试。
 */
export function ensureSettingsLoaded(): Promise<AppSettings> {
  const { settings } = useSettingsStore.getState();
  if (settings) return Promise.resolve(settings);
  if (initialLoad) return initialLoad;

  const attempt = subscribeAndLoad();
  initialLoad = attempt;
  attempt.catch(() => {
    if (initialLoad === attempt) initialLoad = null;
  });
  return attempt;
}

function commit(write: () => Promise<RustAppSettings>): Promise<AppSettings> {
  return enqueue(async () => {
    const settings = await write();
    useSettingsStore.setState({ settings, loadError: null });
    return settings;
  });
}

/**
 * 修改设置的唯一入口。
 *
 * 界面先按 patch 显示（滑块、输入框不能等一次落盘往返），随后以 Rust 的返回值为准。
 * 写入失败时乐观值作废：重读一次真实值，并把写入错误抛给调用方去提示用户。
 */
export function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  useSettingsStore.setState(({ settings }) => (settings ? { settings: { ...settings, ...patch } } : {}));
  return commit(async () => {
    try {
      return await patchSettings(patch);
    } catch (error) {
      await readIntoStore().catch((reloadError) => {
        logger.warn("[设置] 写入失败后重新读取设置也失败，界面可能停在未保存的值上", reloadError);
      });
      throw error;
    }
  });
}

/** 把指定字段恢复成默认值。默认值只在 Rust 的 `AppSettings::default()` 定义，前端不存默认值表。 */
export function resetSettingsToDefault(keys: ReadonlyArray<keyof RustAppSettings>): Promise<AppSettings> {
  return commit(() => resetSettings(keys));
}

/** 仅供测试：回到「本窗口尚未加载」的初始状态。 */
export function __resetSettingsStoreForTests(): void {
  unlistenSettingsChanged?.();
  unlistenSettingsChanged = null;
  queueTail = Promise.resolve();
  pendingReload = null;
  initialLoad = null;
  useSettingsStore.setState(INITIAL_STATE);
}
