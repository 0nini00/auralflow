import type { BiliCollectionInfo } from "./biliService";

export interface BiliCollectionVisibilityModelInput {
  collections: BiliCollectionInfo[];
  hiddenCollectionIds: string[];
  newCollectionIds: string[];
  autoShowNewCollections: boolean;
}

export interface BiliCollectionVisibilityModel {
  visibleCollections: BiliCollectionInfo[];
  totalCount: number;
  hiddenCount: number;
  newCount: number;
  hasHiddenCollections: boolean;
  hasNewCollections: boolean;
  autoShowNewCollections: boolean;
  emptyText: string;
}

export function getBiliCollectionVisibilityModel({
  collections,
  hiddenCollectionIds,
  newCollectionIds,
  autoShowNewCollections,
}: BiliCollectionVisibilityModelInput): BiliCollectionVisibilityModel {
  const collectionIds = new Set(collections.map((collection) => collection.id));
  const hiddenIds = new Set(hiddenCollectionIds.filter((id) => collectionIds.has(id)));
  const newCount = newCollectionIds.filter((id) => collectionIds.has(id)).length;
  const visibleCollections = collections.filter((collection) => !hiddenIds.has(collection.id));

  return {
    visibleCollections,
    totalCount: collections.length,
    hiddenCount: hiddenIds.size,
    newCount,
    hasHiddenCollections: hiddenIds.size > 0,
    hasNewCollections: newCount > 0,
    autoShowNewCollections,
    emptyText:
      collections.length > 0 && visibleCollections.length === 0
        ? "已隐藏全部 B站合集，可以在管理里重新显示"
        : "暂无可见合集",
  };
}
