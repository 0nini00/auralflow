/**
 * 已移除来源的历史数据清理 —— 双端共用。
 *
 * 背景：B 站（bili）曾是内置来源之一，收藏 / 播放历史 / 歌单歌曲里都可能存有它的条目。
 * 该来源被整体移除后，`SourceTag` 里已经没有它，但**已落盘的数据仍然存在**：这类条目在
 * 新版本里既没有 provider、也没有音质与歌词映射，留着只会在列表里变成点不动的死行，
 * 而且会随 WebDAV 同步在两端来回传（一端删掉、另一端又合并回来）。
 *
 * 因此两端必须在**读盘后**与**同步合并后**各跑一次这里的清理。
 * 与歌单残留清理（`scrubSyncedCloudPlaylistRefs`）不同，这里是直接丢弃：用户明确选择了
 * 「不需要备份」。
 */

/** 已被整体移除的内置来源。以后再有来源下线，只在这里加一项，别在两端各写一份判断。 */
const REMOVED_SOURCES = new Set(["bili"]);

/** 该来源是否已被移除（大小写与首尾空白容错，兼容历史数据里可能的写法差异）。 */
export function isRemovedSource(source: unknown): boolean {
  return (
    typeof source === "string" && REMOVED_SOURCES.has(source.trim().toLowerCase())
  );
}

export interface DropRemovedSourceResult<T> {
  /** 保留的条目（顺序不变） */
  kept: T[];
  /** 被丢弃的条目（调用方只需要计数打日志，不再保留数据） */
  dropped: T[];
}

/**
 * 丢掉来源已被移除的条目。
 *
 * **source 缺失或不是字符串的条目一律保留**：那些是未知/损坏数据，不属于「已知的已移除来源」，
 * 顺手删掉就变成静默销毁用户数据。只有明确等于已移除来源的才丢。
 */
export function dropRemovedSourceEntries<T extends { source?: unknown }>(
  items: readonly (T | null | undefined)[] | null | undefined,
): DropRemovedSourceResult<T> {
  const kept: T[] = [];
  const dropped: T[] = [];

  if (!Array.isArray(items) || items.length === 0) {
    return { kept, dropped };
  }

  for (const item of items) {
    if (!item) continue;
    if (isRemovedSource(item.source)) {
      dropped.push(item);
      continue;
    }
    kept.push(item);
  }

  return { kept, dropped };
}
