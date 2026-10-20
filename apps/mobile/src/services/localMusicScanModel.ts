import type { MusicInfo } from "@lx/core";

export const MEDIA_STORE_SCOPE = "mediaStore:external:music";
/** 仅覆盖下载记录与已入库下载曲指向的已知文件，不枚举整个下载目录。 */
export const DOWNLOAD_SCOPE = "download:app";
export type LocalMusicOrigin = "mediaStore" | "manual" | "download" | "legacy";
/**
 * 用户可以改写的字段。
 *
 * 封面（picUrl / img）不在这里：本地曲封面只来自音频文件自己的内嵌标签与同目录旁挂图，
 * 由扫描 / 下载元数据维护，不再接受用户覆盖。
 */
const LOCAL_EDITABLE_FIELDS = ["name", "singer", "albumName", "localLyrics"] as const;
type LocalEditableField = typeof LOCAL_EDITABLE_FIELDS[number];
type LocalMetadataPatch = Partial<Pick<LocalMusicInfo, LocalEditableField>>;

/**
 * 旧版本记在记录上、现在已经删除的字段：曲目编辑字段（封面、歌词三态选择）与歌词选择本体。
 * 读盘时按未知字段丢弃，而不是让整库加载失败，也不再写回。
 */
const LEGACY_IGNORED_EDITABLE_FIELDS = ["picUrl", "img", "lyricsMode", "lyricsFingerprint", "lyricsSourceLabel"];
const LEGACY_IGNORED_FIELDS = ["lyricsMode", "lyricsFingerprint", "lyricsSourceLabel"];

/** 仅移动端持久化：记录本身同时持有元数据、来源和签名，不维护第二份标签缓存。 */
export interface LocalMusicInfo extends MusicInfo {
  localOrigin?: LocalMusicOrigin;
  localScan?: { scope: string; signature?: string };
  /** 只记录用户编辑过的字段名，值仍由本歌曲记录唯一持有。 */
  localEditedFields?: LocalEditableField[];
}

export interface LocalMusicScanResult {
  source: "mediaStore" | "download";
  scope: string;
  /** 仅声明指定 scope 的检查完成，不表示全盘或整个目录枚举完成。 */
  complete: true;
  songs: LocalMusicInfo[];
}

export function localSongKey(song: Pick<MusicInfo, "id" | "source">): string {
  return song.source + ":" + song.id;
}

export function parseLocalSongs(raw: string | null): LocalMusicInfo[] {
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("本地音乐数据格式错误");
  return parsed.map((song: LocalMusicInfo) => {
    if (!song || typeof song.id !== "string" || song.source !== "local"
      || typeof song.name !== "string" || typeof song.singer !== "string" || typeof song.albumName !== "string") {
      throw new Error("本地音乐条目格式错误");
    }
    if (song.localOrigin !== undefined && !["mediaStore", "manual", "download", "legacy"].includes(song.localOrigin)) {
      throw new Error("本地音乐来源格式错误");
    }
    if (song.localScan !== undefined && (!song.localScan || typeof song.localScan.scope !== "string"
      || (song.localScan.signature !== undefined && typeof song.localScan.signature !== "string"))) {
      throw new Error("本地音乐扫描信息格式错误");
    }
    if (song.localEditedFields !== undefined && (!Array.isArray(song.localEditedFields)
      || song.localEditedFields.some((field) => !LOCAL_EDITABLE_FIELDS.includes(field)
        && !LEGACY_IGNORED_EDITABLE_FIELDS.includes(field)))) {
      throw new Error("本地音乐编辑字段格式错误");
    }
    // 已删除的歌词选择字段不再属于记录形状：读到就丢弃，不让死数据继续跟着写盘。
    const record = { ...song } as LocalMusicInfo & Record<string, unknown>;
    for (const field of LEGACY_IGNORED_FIELDS) delete record[field];
    // 历史记录可能来自手动选择器，数字 ID / dl 前缀不能证明归属扫描范围。
    return {
      ...record,
      ...(song.localEditedFields
        ? { localEditedFields: song.localEditedFields.filter((field) => !LEGACY_IGNORED_EDITABLE_FIELDS.includes(field)) }
        : {}),
      localOrigin: song.localOrigin ?? "legacy",
    };
  });
}

export function mergeManualLocalSongs(existing: LocalMusicInfo[], incoming: LocalMusicInfo[]): LocalMusicInfo[] {
  const merged = new Map(existing.map((song) => [localSongKey(song), song]));
  for (const song of incoming) {
    const key = localSongKey(song);
    merged.set(key, { ...merged.get(key), ...song, localOrigin: "manual", localScan: undefined });
  }
  return [...merged.values()];
}

export function applyLocalMetadataEdit(song: LocalMusicInfo, patch: LocalMetadataPatch): LocalMusicInfo {
  const changed = LOCAL_EDITABLE_FIELDS.filter((field) => field in patch && patch[field] !== song[field]);
  const localEditedFields = [...new Set([...(song.localEditedFields ?? []), ...changed])];
  return { ...song, ...patch, localEditedFields };
}

function mergeScannedSong(old: LocalMusicInfo, next: LocalMusicInfo): LocalMusicInfo {
  const origin = old.localOrigin ?? "legacy";
  // 下载索引是入库元数据，不是用户编辑的真相源；只保留已编辑字段，其余字段照常刷新。
  const edits = next.localOrigin === "download"
    ? Object.fromEntries((old.localEditedFields ?? []).map((field) => [field, old[field]]))
    : {};
  return { ...old, ...next, ...edits, localEditedFields: old.localEditedFields,
    localOrigin: origin === "manual" || origin === "legacy" ? origin : next.localOrigin };
}

/**
 * 范围对账：只删除「显式声明成功的范围」内不再出现的记录，manual / legacy 即使同键命中过也不移交所有权。
 */
export function reconcileLocalMusic(
  existing: LocalMusicInfo[],
  scans: LocalMusicScanResult[],
): LocalMusicInfo[] {
  const incoming = new Map<string, LocalMusicInfo>();
  for (const scan of scans) {
    if (scan.complete !== true || !scan.scope) throw new Error("本地音乐扫描结果不完整");
    for (const song of scan.songs) {
      if (song.localOrigin !== scan.source || song.localScan?.scope !== scan.scope) {
        throw new Error("本地音乐扫描结果范围不一致");
      }
      incoming.set(localSongKey(song), song);
    }
  }
  const merged: LocalMusicInfo[] = [];
  for (const old of existing) {
    const key = localSongKey(old);
    const next = incoming.get(key);
    const origin = old.localOrigin ?? "legacy";
    if (next) {
      merged.push(mergeScannedSong(old, next));
      incoming.delete(key);
      continue;
    }
    const inCompletedScope = scans.some((scan) => origin === scan.source && old.localScan?.scope === scan.scope);
    if (!inCompletedScope) merged.push({ ...old, localOrigin: origin });
  }
  return [...merged, ...incoming.values()];
}
