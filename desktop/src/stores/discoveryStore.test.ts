import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const mocks = vi.hoisted(() => ({
  getDailyRecommend: vi.fn(),
  loadDailyRecommendHistory: vi.fn(),
  saveDailyRecommendSnapshot: vi.fn(),
}));

vi.mock("@/services/wyAccountService", () => ({
  getDailyRecommend: mocks.getDailyRecommend,
  getPersonalFm: vi.fn(async () => []),
  fmTrash: vi.fn(async () => undefined),
}));

vi.mock("@/services/dailyRecommendCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/dailyRecommendCache")>();
  return {
    ...actual,
    loadDailyRecommendHistory: mocks.loadDailyRecommendHistory,
    saveDailyRecommendSnapshot: mocks.saveDailyRecommendSnapshot,
  };
});

import { useDiscoveryStore } from "./discoveryStore";

function song(id: string): MusicInfo {
  return { id, name: `Song ${id}`, singer: "Singer", albumName: "Album", source: "wy" };
}

function snapshot(date: string, id: string) {
  return { date, songs: [song(id)], cachedAt: 1 };
}

describe("daily recommendation discovery state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDiscoveryStore.setState({
      daily: [],
      dailyDate: "",
      dailyLoading: false,
      dailyError: "",
      dailyHistory: [],
      dailySelectedDate: "",
      dailyAccountUid: "",
      dailyHydrated: false,
    });
  });

  it("hydrates today's snapshot without requesting it again", async () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    mocks.loadDailyRecommendHistory.mockResolvedValue([snapshot(date, "cached")]);

    await useDiscoveryStore.getState().initializeDaily("account-a");

    expect(useDiscoveryStore.getState().daily[0]?.id).toBe("cached");
    expect(mocks.getDailyRecommend).not.toHaveBeenCalled();
  });

  it("falls back to the newest cached snapshot when the request fails", async () => {
    mocks.loadDailyRecommendHistory.mockResolvedValue([snapshot("2026-08-18", "fallback")]);
    mocks.getDailyRecommend.mockRejectedValue(new Error("network down"));

    await useDiscoveryStore.getState().initializeDaily("account-a");

    expect(useDiscoveryStore.getState().dailyDate).toBe("2026-08-18");
    expect(useDiscoveryStore.getState().daily[0]?.id).toBe("fallback");
    expect(useDiscoveryStore.getState().dailyError).toBe("network down");
  });

  it("does not replace history when refresh returns no valid songs", async () => {
    const cached = snapshot("2026-08-18", "cached");
    mocks.loadDailyRecommendHistory.mockResolvedValue([cached]);
    mocks.getDailyRecommend.mockResolvedValue([]);
    await useDiscoveryStore.getState().initializeDaily("account-a");

    await useDiscoveryStore.getState().refreshDaily();

    expect(useDiscoveryStore.getState().daily[0]?.id).toBe("cached");
    expect(mocks.saveDailyRecommendSnapshot).not.toHaveBeenCalled();
  });

  it("selects a retained historical date", () => {
    const history = [snapshot("2026-08-19", "today"), snapshot("2026-08-18", "past")];
    useDiscoveryStore.setState({ dailyHistory: history });

    useDiscoveryStore.getState().selectDailyDate("2026-08-18");

    expect(useDiscoveryStore.getState().dailyDate).toBe("2026-08-18");
    expect(useDiscoveryStore.getState().daily[0]?.id).toBe("past");
  });
});
