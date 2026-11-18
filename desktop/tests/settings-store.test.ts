import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RustAppSettings } from "@lx/tauri-bridge";

type SettingsChangedHandler = (payload: { changedKeys: string[] }) => void;

const bridge = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  patchSettings: vi.fn(),
  resetSettings: vi.fn(),
  listenTauriEvent: vi.fn(),
  unlisten: vi.fn(),
}));
const warn = vi.hoisted(() => vi.fn());

vi.mock("@lx/tauri-bridge", () => ({
  TAURI_EVENTS: { settingsChanged: "settings-changed" },
  loadSettings: bridge.loadSettings,
  patchSettings: bridge.patchSettings,
  resetSettings: bridge.resetSettings,
  listenTauriEvent: bridge.listenTauriEvent,
}));
vi.mock("@/services/logger", () => ({ logger: { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  __resetSettingsStoreForTests,
  ensureSettingsLoaded,
  resetSettingsToDefault,
  updateSettings,
  useSettingsStore,
} from "../src/stores/settingsStore";

function settingsOf(overrides: Partial<RustAppSettings>): RustAppSettings {
  return { volume: 80, lyricFontSize: 28, cursorEffect: "off", ...overrides } as RustAppSettings;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 取 store 订阅 settings-changed 时交给桥的那个处理函数。 */
function settingsChangedHandler(): SettingsChangedHandler {
  return bridge.listenTauriEvent.mock.calls[0][1] as SettingsChangedHandler;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __resetSettingsStoreForTests();
  vi.clearAllMocks();
  bridge.listenTauriEvent.mockResolvedValue(bridge.unlisten);
  bridge.loadSettings.mockResolvedValue(settingsOf({}));
});

describe("settingsStore：加载", () => {
  it("加载完成之前 settings 是 null，不给任何占位默认值", async () => {
    const pending = deferred<RustAppSettings>();
    bridge.loadSettings.mockReturnValue(pending.promise);

    const loading = ensureSettingsLoaded();
    await flush();
    expect(useSettingsStore.getState()).toEqual({ settings: null, loadError: null });

    pending.resolve(settingsOf({ volume: 35 }));
    await expect(loading).resolves.toMatchObject({ volume: 35 });
    expect(useSettingsStore.getState().settings).toMatchObject({ volume: 35 });
  });

  it("同一个窗口里反复调用只读一次盘、只订阅一次事件", async () => {
    await Promise.all([ensureSettingsLoaded(), ensureSettingsLoaded()]);
    await ensureSettingsLoaded();

    expect(bridge.loadSettings).toHaveBeenCalledTimes(1);
    expect(bridge.listenTauriEvent).toHaveBeenCalledTimes(1);
    expect(bridge.listenTauriEvent).toHaveBeenCalledWith("settings-changed", expect.any(Function));
  });

  it("先订阅事件再读盘", async () => {
    const order: string[] = [];
    bridge.listenTauriEvent.mockImplementation(async () => {
      order.push("listen");
      return bridge.unlisten;
    });
    bridge.loadSettings.mockImplementation(async () => {
      order.push("load");
      return settingsOf({});
    });

    await ensureSettingsLoaded();
    expect(order).toEqual(["listen", "load"]);
  });

  it("读取失败：settings 仍是 null，错误写进 loadError 并抛给调用方；下次调用会重试", async () => {
    bridge.loadSettings.mockRejectedValueOnce(new Error("解析配置文件失败"));

    await expect(ensureSettingsLoaded()).rejects.toThrow("解析配置文件失败");
    expect(useSettingsStore.getState()).toEqual({ settings: null, loadError: "解析配置文件失败" });

    await expect(ensureSettingsLoaded()).resolves.toMatchObject({ volume: 80 });
    expect(useSettingsStore.getState().loadError).toBeNull();
    expect(bridge.listenTauriEvent).toHaveBeenCalledTimes(1);
  });
});

describe("settingsStore：settings-changed", () => {
  it("收到事件后重新读盘并刷新", async () => {
    await ensureSettingsLoaded();
    bridge.loadSettings.mockResolvedValue(settingsOf({ cursorEffect: "trail" }));

    settingsChangedHandler()({ changedKeys: ["cursorEffect"] });
    await flush();

    expect(bridge.loadSettings).toHaveBeenCalledTimes(2);
    expect(useSettingsStore.getState().settings?.cursorEffect).toBe("trail");
  });

  it("只涉及 Rust 自己读写的窗口几何时不读盘", async () => {
    await ensureSettingsLoaded();

    settingsChangedHandler()({ changedKeys: ["lyricWindowX", "lyricWindowY"] });
    settingsChangedHandler()({ changedKeys: ["mainWindowX", "miniPlayerY"] });
    await flush();
    expect(bridge.loadSettings).toHaveBeenCalledTimes(1);

    settingsChangedHandler()({ changedKeys: ["lyricWindowX", "lyricPinned"] });
    await flush();
    expect(bridge.loadSettings).toHaveBeenCalledTimes(2);
  });

  it("重读尚未开始时连续到达的事件并成一次读盘", async () => {
    await ensureSettingsLoaded();
    const write = deferred<RustAppSettings>();
    bridge.patchSettings.mockReturnValue(write.promise);
    void updateSettings({ volume: 10 });

    const notify = settingsChangedHandler();
    notify({ changedKeys: ["volume"] });
    notify({ changedKeys: ["cursorEffect"] });
    notify({ changedKeys: ["lyricFontSize"] });
    write.resolve(settingsOf({ volume: 10 }));
    await flush();

    expect(bridge.loadSettings).toHaveBeenCalledTimes(2);
  });

  it("重读失败：保留上一份值，记下 loadError 并留日志", async () => {
    await ensureSettingsLoaded();
    bridge.loadSettings.mockRejectedValueOnce(new Error("读取配置文件失败"));

    settingsChangedHandler()({ changedKeys: ["volume"] });
    await flush();

    expect(useSettingsStore.getState()).toMatchObject({ settings: { volume: 80 }, loadError: "读取配置文件失败" });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("settingsStore：写入", () => {
  it("先按 patch 显示，随后以 Rust 的返回值为准", async () => {
    await ensureSettingsLoaded();
    const write = deferred<RustAppSettings>();
    bridge.patchSettings.mockReturnValue(write.promise);

    const saving = updateSettings({ lyricFontSize: 99 });
    expect(useSettingsStore.getState().settings?.lyricFontSize).toBe(99);

    // Rust 可以返回与 patch 不同的值（例如别的窗口同时改了别的字段）。
    write.resolve(settingsOf({ lyricFontSize: 52, cursorEffect: "trail" }));
    await expect(saving).resolves.toMatchObject({ lyricFontSize: 52 });

    expect(bridge.patchSettings).toHaveBeenCalledWith({ lyricFontSize: 99 });
    expect(useSettingsStore.getState().settings).toMatchObject({ lyricFontSize: 52, cursorEffect: "trail" });
  });

  it("写入失败：错误抛给调用方，界面回到重新读到的真实值", async () => {
    await ensureSettingsLoaded();
    bridge.patchSettings.mockRejectedValue(new Error("磁盘已满"));

    await expect(updateSettings({ volume: 5 })).rejects.toThrow("磁盘已满");

    expect(bridge.loadSettings).toHaveBeenCalledTimes(2);
    expect(useSettingsStore.getState().settings?.volume).toBe(80);
  });

  it("较早发出的写入晚返回，也不会盖掉其后读到的结果", async () => {
    await ensureSettingsLoaded();
    const write = deferred<RustAppSettings>();
    bridge.patchSettings.mockReturnValue(write.promise);
    bridge.loadSettings.mockResolvedValue(settingsOf({ volume: 10, cursorEffect: "trail" }));

    const saving = updateSettings({ volume: 10 });
    // 事件在写入返回之前到达：重读排在写入之后，最后进 store 的是重读结果。
    settingsChangedHandler()({ changedKeys: ["volume", "cursorEffect"] });
    await flush();
    expect(bridge.loadSettings).toHaveBeenCalledTimes(1);

    write.resolve(settingsOf({ volume: 10 }));
    await saving;
    await flush();

    expect(useSettingsStore.getState().settings).toMatchObject({ volume: 10, cursorEffect: "trail" });
  });

  it("连续写入：较早一次的返回值不会把界面拉回旧值，全部确认后以 Rust 为准", async () => {
    await ensureSettingsLoaded();
    const first = deferred<RustAppSettings>();
    const second = deferred<RustAppSettings>();
    bridge.patchSettings.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const savingFirst = updateSettings({ lyricFontSize: 30 });
    const savingSecond = updateSettings({ lyricFontSize: 31 });
    expect(useSettingsStore.getState().settings?.lyricFontSize).toBe(31);

    first.resolve(settingsOf({ lyricFontSize: 30 }));
    await savingFirst;
    expect(useSettingsStore.getState().settings?.lyricFontSize).toBe(31);

    second.resolve(settingsOf({ lyricFontSize: 31, volume: 12 }));
    await savingSecond;
    expect(useSettingsStore.getState().settings).toMatchObject({ lyricFontSize: 31, volume: 12 });
  });

  it("未加载完时写入：不凭空造出一份设置，写完后用返回值", async () => {
    bridge.patchSettings.mockResolvedValue(settingsOf({ pactAccepted: true }));

    const saving = updateSettings({ pactAccepted: true });
    expect(useSettingsStore.getState().settings).toBeNull();

    await saving;
    expect(useSettingsStore.getState().settings).toMatchObject({ pactAccepted: true, volume: 80 });
  });

  it("恢复默认只传字段名，值用 Rust 返回的", async () => {
    await ensureSettingsLoaded();
    bridge.resetSettings.mockResolvedValue(settingsOf({ lyricFontSize: 28, lyricAlign: "center" }));

    await resetSettingsToDefault(["lyricFontSize", "lyricAlign"]);

    expect(bridge.resetSettings).toHaveBeenCalledWith(["lyricFontSize", "lyricAlign"]);
    expect(bridge.patchSettings).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings).toMatchObject({ lyricFontSize: 28, lyricAlign: "center" });
  });
});
