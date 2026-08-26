import type { CustomSourceItem } from "@/stores/customSourceStore";

export function buildCustomSourceUpdateDismissKey(source: CustomSourceItem): string {
  return [
    source.id,
    source.updateCheckedAt ?? source.updatedAt,
    source.updateUrl ?? "",
    source.updateLog ?? source.updateMessage ?? "",
  ].join(":");
}

export function getCustomSourceUpdateLog(source: CustomSourceItem): string {
  return source.updateLog || source.updateMessage || "检测到自定义音源有新版本";
}

export function selectCustomSourceUpdateNotice(
  sources: CustomSourceItem[],
  dismissedKeys: ReadonlySet<string>,
): CustomSourceItem | null {
  return sources.find((source) => {
    if (source.updateStatus !== "available") return false;
    if (source.allowShowUpdateAlert === false) return false;
    return !dismissedKeys.has(buildCustomSourceUpdateDismissKey(source));
  }) ?? null;
}
