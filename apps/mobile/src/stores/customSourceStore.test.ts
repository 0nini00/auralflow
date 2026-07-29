import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    clear: () => data.clear(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));

vi.mock("react-native-fs", () => ({
  default: {
    readFile: vi.fn(() => Promise.resolve("")),
  },
}));

vi.mock("@/services/customSourceRuntime", () => ({
  checkCustomSourceUpdate: vi.fn(() => Promise.resolve({ sources: {} })),
  invalidateRuntimeCache: vi.fn(),
  parseDesktopUserApiInfo: vi.fn(() => ({
    name: "测试音源",
    description: "测试描述",
    author: "",
    homepage: "",
    version: "1.0.0",
  })),
  testCustomSource: vi.fn(() => Promise.resolve({ sources: {} })),
}));

import { useCustomSourceStore, type CustomSourceItem } from "@/stores/customSourceStore";

const CUSTOM_SOURCE_STORAGE_KEY = "auralflow.mobile.customSources";

function source(overrides: Partial<CustomSourceItem> = {}): CustomSourceItem {
  const now = 1_700_000_000_000;
  return {
    id: "source-1",
    name: "测试音源",
    description: "测试描述",
    script: "/* @name 测试音源 */\nlx.send(lx.EVENT_NAMES.inited, { sources: {} })",
    enabled: true,
    allowShowUpdateAlert: true,
    testStatus: "idle",
    updateStatus: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("custom source store startup update settings", () => {
  beforeEach(() => {
    storage.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    useCustomSourceStore.setState({
      sources: [],
      loaded: false,
      customSourceAutoCheck: true,
    } as any);
  });

  it("loads the persisted startup auto-check setting", async () => {
    storage.data.set(
      CUSTOM_SOURCE_STORAGE_KEY,
      JSON.stringify({ sources: [source()], customSourceAutoCheck: false }),
    );

    await useCustomSourceStore.getState().loadFromStorage();

    expect(useCustomSourceStore.getState().customSourceAutoCheck).toBe(false);
    expect(useCustomSourceStore.getState().sources).toHaveLength(1);
  });

  it("keeps startup auto-check enabled for legacy source-array storage", async () => {
    storage.data.set(CUSTOM_SOURCE_STORAGE_KEY, JSON.stringify([source()]));

    await useCustomSourceStore.getState().loadFromStorage();

    expect(useCustomSourceStore.getState().customSourceAutoCheck).toBe(true);
    expect(useCustomSourceStore.getState().sources).toHaveLength(1);
  });

  it("persists startup auto-check changes with the source list", async () => {
    useCustomSourceStore.setState({ sources: [source()], loaded: true } as any);

    await useCustomSourceStore.getState().setCustomSourceAutoCheck(false);

    expect(useCustomSourceStore.getState().customSourceAutoCheck).toBe(false);
    expect(storage.setItem).toHaveBeenCalledWith(
      CUSTOM_SOURCE_STORAGE_KEY,
      JSON.stringify({
        sources: [
          {
            ...source(),
            testMessage: undefined,
            updateMessage: undefined,
          },
        ],
        customSourceAutoCheck: false,
      }),
    );
  });

  it("runs startup update checks only when auto-check is enabled", async () => {
    const checkAllUpdates = vi.fn(() => Promise.resolve());
    useCustomSourceStore.setState({
      sources: [source()],
      loaded: true,
      customSourceAutoCheck: true,
      checkAllUpdates,
    } as any);

    await useCustomSourceStore.getState().checkStartupUpdates();

    expect(checkAllUpdates).toHaveBeenCalledTimes(1);

    checkAllUpdates.mockClear();
    useCustomSourceStore.setState({ customSourceAutoCheck: false } as any);

    await useCustomSourceStore.getState().checkStartupUpdates();

    expect(checkAllUpdates).not.toHaveBeenCalled();
  });
});
