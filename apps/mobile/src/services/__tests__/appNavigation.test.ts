import { describe, expect, it } from "vitest";
import {
  APP_SETTINGS_TAB,
  APP_TABS,
  DEFAULT_APP_TAB,
  getNextAppTab,
  isVisibleTabId,
  openPlayerTab,
  shouldShowNestedBackButton,
  type AppTabId,
} from "@/services/appNavigation";

describe("app navigation", () => {
  it("defines desktop-aligned drawer items and labels", () => {
    expect(DEFAULT_APP_TAB).toBe("home");
    expect(APP_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "search",
      "daily",
      "fm",
      "playlists",
      "downloads",
      "local",
    ]);
    expect(APP_TABS.map((tab) => tab.label)).toEqual([
      "发现",
      "搜索",
      "每日推荐",
      "私人 FM",
      "歌单",
      "下载",
      "本地音乐",
    ]);
    expect(APP_SETTINGS_TAB).toMatchObject({ id: "settings", label: "设置" });
  });

  it("opens only known visible tabs", () => {
    expect(getNextAppTab("home", "search")).toBe("search");
    expect(getNextAppTab("playlists", "settings")).toBe("settings");
    expect(getNextAppTab("home", "daily")).toBe("daily");
    expect(getNextAppTab("home", "local")).toBe("local");
    // player / download 不在可见列表中，保持当前 tab
    expect(getNextAppTab("home", "player")).toBe("home");
    expect(getNextAppTab("home", "download")).toBe("home");
    expect(getNextAppTab("library", "missing" as AppTabId)).toBe("library");
  });

  it("centralizes player navigation", () => {
    expect(openPlayerTab()).toBe("player");
  });

  it("shows nested back navigation only when a back handler exists", () => {
    expect(shouldShowNestedBackButton(() => undefined)).toBe(true);
    expect(shouldShowNestedBackButton(undefined)).toBe(false);
  });

  it("recognizes visible tab ids", () => {
    expect(isVisibleTabId("home")).toBe(true);
    expect(isVisibleTabId("downloads")).toBe(true);
    expect(isVisibleTabId("player")).toBe(false);
  });
});
