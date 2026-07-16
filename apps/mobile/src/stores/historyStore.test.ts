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
    removeItem: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
    clear: () => data.clear(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));

import { useHistoryStore } from "@/stores/historyStore";

const HISTORY_KEY = "auralflow.mobile.playHistory";

describe("history store loadHistory", () => {
  beforeEach(() => {
    storage.clear();
    storage.getItem.mockClear();
    useHistoryStore.setState({ history: [], loading: false });
  });

  it("loads a valid persisted history array", async () => {
    storage.data.set(
      HISTORY_KEY,
      JSON.stringify([{ id: "1", name: "s1", singer: "a", albumName: "al", source: "wy" }]),
    );

    await useHistoryStore.getState().loadHistory();

    expect(useHistoryStore.getState().history).toHaveLength(1);
    expect(useHistoryStore.getState().loading).toBe(false);
  });

  it("falls back to an empty array when persisted data is corrupted into a non-array", async () => {
    // 损坏存储：合法 JSON 但不是数组。旧实现会把它直接写入 history，
    // 导致 SearchScreen 的 history.map 在渲染期崩溃。
    storage.data.set(HISTORY_KEY, JSON.stringify({ oops: true }));

    await useHistoryStore.getState().loadHistory();

    expect(Array.isArray(useHistoryStore.getState().history)).toBe(true);
    expect(useHistoryStore.getState().history).toHaveLength(0);
  });

  it("falls back to an empty array when stored JSON is invalid", async () => {
    storage.data.set(HISTORY_KEY, "{not-json");

    await useHistoryStore.getState().loadHistory();

    expect(Array.isArray(useHistoryStore.getState().history)).toBe(true);
    expect(useHistoryStore.getState().history).toHaveLength(0);
    expect(useHistoryStore.getState().loading).toBe(false);
  });
});
