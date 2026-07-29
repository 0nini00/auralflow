import { describe, expect, it } from "vitest";
import type { CustomSourceItem } from "@/stores/customSourceStore";
import {
  buildCustomSourceUpdateDismissKey,
  getCustomSourceUpdateLog,
  selectCustomSourceUpdateNotice,
} from "@/services/customSourceUpdateNoticeModel";

function source(overrides: Partial<CustomSourceItem> = {}): CustomSourceItem {
  const now = 1_700_000_000_000;
  return {
    id: "source-1",
    name: "测试音源",
    description: "测试描述",
    script: "/* @name 测试音源 */",
    enabled: true,
    allowShowUpdateAlert: true,
    testStatus: "idle",
    updateStatus: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("custom source update notice model", () => {
  it("selects the first available custom source update that allows alerts", () => {
    const blocked = source({
      id: "blocked",
      updateStatus: "available",
      allowShowUpdateAlert: false,
    });
    const available = source({
      id: "available",
      updateStatus: "available",
      updateLog: "修复播放地址解析",
    });

    expect(selectCustomSourceUpdateNotice([blocked, available], new Set())?.id).toBe("available");
  });

  it("does not reselect a dismissed update until its update payload changes", () => {
    const current = source({
      updateStatus: "available",
      updateLog: "修复播放地址解析",
      updateCheckedAt: 100,
    });
    const dismissed = new Set([buildCustomSourceUpdateDismissKey(current)]);

    expect(selectCustomSourceUpdateNotice([current], dismissed)).toBeNull();
    expect(selectCustomSourceUpdateNotice([
      { ...current, updateLog: "新增音质映射" },
    ], dismissed)?.id).toBe(current.id);
  });

  it("falls back to a clear update log when the source does not provide one", () => {
    expect(getCustomSourceUpdateLog(source({ updateStatus: "available" }))).toBe(
      "自定义音源提示有新版本",
    );
  });
});
