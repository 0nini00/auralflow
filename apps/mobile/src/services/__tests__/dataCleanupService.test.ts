import { describe, expect, it, vi, beforeEach } from "vitest";

const cacheService = vi.hoisted(() => ({
  clearAllCache: vi.fn(() => Promise.resolve()),
  getCacheSize: vi.fn(() => Promise.resolve(0)),
}));

const historyStore = vi.hoisted(() => ({
  clearHistory: vi.fn(() => Promise.resolve()),
}));

const playerService = vi.hoisted(() => ({
  clearPrefetchCache: vi.fn(),
}));

vi.mock("@/services/cacheService", () => cacheService);
vi.mock("@/services/playerService", () => playerService);
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: {
    getState: () => historyStore,
  },
}));

import {
  clearPlaybackHistoryAndCache,
  getPlaybackHistoryAndCacheCleanupAction,
} from "@/services/dataCleanupService";

describe("data cleanup service", () => {
  beforeEach(() => {
    cacheService.clearAllCache.mockClear();
    cacheService.getCacheSize.mockClear();
    historyStore.clearHistory.mockClear();
    playerService.clearPrefetchCache.mockClear();
  });

  it("clears playback history, stored cache and playback prefetch cache", async () => {
    await expect(clearPlaybackHistoryAndCache()).resolves.toEqual({
      cacheSize: 0,
      message: "已清空播放历史与缓存",
    });

    expect(historyStore.clearHistory).toHaveBeenCalledTimes(1);
    expect(cacheService.clearAllCache).toHaveBeenCalledTimes(1);
    expect(playerService.clearPrefetchCache).toHaveBeenCalledTimes(1);
    expect(cacheService.getCacheSize).toHaveBeenCalledTimes(1);
  });

  it("builds settings action copy for history and cache cleanup", () => {
    expect(getPlaybackHistoryAndCacheCleanupAction()).toEqual({
      title: "清空历史和缓存",
      caption: "清空播放历史、封面、歌词和播放预读缓存",
      confirmTitle: "清空历史和缓存",
      confirmMessage: "将删除播放历史、封面、歌词和播放预读缓存，下次播放时会重新生成。",
      successMessage: "已清空播放历史与缓存",
    });
  });
});
