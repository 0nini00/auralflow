import { describe, expect, it } from "vitest";
import type { BiliCollectionInfo } from "@/services/biliService";
import { getBiliCollectionVisibilityModel } from "@/services/biliCollectionVisibilityModel";

function collection(id: string, name = `合集 ${id}`): BiliCollectionInfo {
  return {
    id,
    name,
    source: "bili",
    author: "UP",
    trackCount: 1,
  };
}

describe("bili collection visibility model", () => {
  it("hides collections selected by the visibility preferences", () => {
    const model = getBiliCollectionVisibilityModel({
      collections: [collection("1"), collection("2"), collection("3")],
      hiddenCollectionIds: ["2"],
      newCollectionIds: [],
      autoShowNewCollections: false,
    });

    expect(model.visibleCollections.map((item) => item.id)).toEqual(["1", "3"]);
    expect(model.hiddenCount).toBe(1);
    expect(model.totalCount).toBe(3);
    expect(model.hasHiddenCollections).toBe(true);
  });

  it("counts only existing new collections", () => {
    const model = getBiliCollectionVisibilityModel({
      collections: [collection("1"), collection("2")],
      hiddenCollectionIds: ["2"],
      newCollectionIds: ["2", "missing"],
      autoShowNewCollections: false,
    });

    expect(model.newCount).toBe(1);
    expect(model.hasNewCollections).toBe(true);
  });

  it("uses a management hint when every collection is hidden", () => {
    const model = getBiliCollectionVisibilityModel({
      collections: [collection("1")],
      hiddenCollectionIds: ["1"],
      newCollectionIds: [],
      autoShowNewCollections: true,
    });

    expect(model.visibleCollections).toEqual([]);
    expect(model.emptyText).toBe("已隐藏全部 B站合集，可以在管理里重新显示");
  });
});
