import { buildSongKey, type MusicInfo } from "@lx/core";

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
  /** 系统媒体库 ID 与曲库的稳定 ID 分开，避免合并下载条目后写错系统记录。 */
  localMediaId?: string;
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
  warnings?: LocalMusicScanWarning[];
}

export interface LocalMusicScanWarning {
  id: string;
  name: string;
  message: string;
}

export interface LocalMusicScanSummary {
  total: number;
  warnings: LocalMusicScanWarning[];
}

export type LocalMusicFileKey = (song: Pick<MusicInfo, "url">) => string | undefined;

/** 只合并可证明相同的路径；Android 文件名区分大小写，file URL 保留历史字面路径。 */
export function localMusicFileKey(url: string | undefined, primaryStoragePath?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("file:///")) return `file:${url.slice(7)}`;
  if (url.startsWith("/")) return `file:${url}`;
  const document = /^content:\/\/com\.android\.externalstorage\.documents\/(?:tree\/[^/]+\/)?document\/([^/?#]+)$/.exec(url);
  if (!document) return `uri:${url}`;
  let id: string;
  try { id = decodeURIComponent(document[1]); }
  catch { throw new Error("本地音频文档 URI 编码无效"); }
  const separator = id.indexOf(":");
  if (separator < 0) return `uri:${url}`;
  const volume = id.slice(0, separator);
  const relative = id.slice(separator + 1);
  if (!relative || relative.split("/").some(part => !part || part === "." || part === "..")) return `uri:${url}`;
  // primary 的真实根目录由 RNFS 提供，不能写死为主用户的 /storage/emulated/0。
  const root = volume === "primary" ? primaryStoragePath
    : /^[\da-f]{4}-[\da-f]{4}$/i.test(volume) ? `/storage/${volume}` : undefined;
  return root?.startsWith("/") ? `file:${root.replace(/\/$/, "")}/${relative}` : `uri:${url}`;
}

const defaultFileKey: LocalMusicFileKey = song => localMusicFileKey(song.url);

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
    if (song.localMediaId !== undefined && (typeof song.localMediaId !== "string" || !/^\d+$/.test(song.localMediaId))) {
      throw new Error("本地音乐系统 ID 格式错误");
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

export function mergeManualLocalSongs(
  existing: LocalMusicInfo[], incoming: LocalMusicInfo[], fileKey: LocalMusicFileKey = defaultFileKey,
): LocalMusicInfo[] {
  const merged = new Map(existing.map((song) => [buildSongKey(song), song]));
  for (const song of incoming) {
    const key = buildSongKey(song);
    merged.set(key, { ...merged.get(key), ...song, localOrigin: "manual", localScan: undefined });
  }
  return deduplicateLocalSongs([...merged.values()], fileKey);
}

export function applyLocalMetadataEdit(song: LocalMusicInfo, patch: LocalMetadataPatch): LocalMusicInfo {
  const changed = LOCAL_EDITABLE_FIELDS.filter((field) => field in patch && patch[field] !== song[field]);
  const localEditedFields = [...new Set([...(song.localEditedFields ?? []), ...changed])];
  return { ...song, ...patch, localEditedFields };
}

function mergeScannedSong(old: LocalMusicInfo, next: LocalMusicInfo): LocalMusicInfo {
  const origin = old.localOrigin ?? "legacy";
  // 下载索引是入库元数据，不是用户编辑的真相源；只保留已编辑字段，其余字段照常刷新。
  const edits = Object.fromEntries((old.localEditedFields ?? []).map((field) => [field, old[field]]));
  const localOrigin = origin === "manual" || origin === "legacy" || origin === "download" ? origin : next.localOrigin;
  return { ...old, ...next, ...edits, localEditedFields: old.localEditedFields,
    id: old.id,
    localMediaId: next.localMediaId,
    localOrigin,
    localScan: localOrigin === "download" ? { ...next.localScan, scope: DOWNLOAD_SCOPE } : next.localScan,
  };
}

/** 同文件跨来源只留一条，已有曲库 ID 和用户编辑优先，系统标签优于下载索引。 */
function deduplicateLocalSongs(songs: LocalMusicInfo[], fileKey: LocalMusicFileKey): LocalMusicInfo[] {
  // 保留本轮被选中的原始元数据来源；合并后的归属可能是 download，不能据此降低系统标签优先级。
  const result = new Map<string, { song: LocalMusicInfo; metadata: LocalMusicInfo }>();
  for (const song of songs) {
    const key = fileKey(song) ?? `song:${buildSongKey(song)}`;
    const entry = result.get(key);
    if (!entry) { result.set(key, { song, metadata: song }); continue; }
    const previous = entry.song;
    const preferred = song.localOrigin === "manual" ? song
      : entry.metadata.localOrigin === "mediaStore" ? entry.metadata : song;
    const protectedOrigin = [previous.localOrigin ?? "legacy", song.localOrigin ?? "legacy"]
      .find(origin => origin === "manual" || origin === "legacy");
    const localOrigin = protectedOrigin
      ?? (previous.localOrigin === "download" || song.localOrigin === "download" ? "download" : preferred.localOrigin);
    const fields = [...new Set([...(previous.localEditedFields ?? []), ...(song.localEditedFields ?? [])])];
    const edits = Object.fromEntries(fields.map(field => [field,
      previous.localEditedFields?.includes(field) ? previous[field] : song[field]]));
    result.set(key, { metadata: preferred, song: {
      ...previous, ...song, ...preferred, ...edits, id: previous.id,
      localMediaId: preferred.localMediaId ?? previous.localMediaId ?? song.localMediaId,
      localOrigin,
      localScan: localOrigin === "download" ? { ...preferred.localScan, scope: DOWNLOAD_SCOPE } : preferred.localScan,
      localEditedFields: fields.length ? fields : undefined,
    } });
  }
  return [...result.values()].map(entry => entry.song);
}

/**
 * 范围对账：只删除「显式声明成功的范围」内不再出现的记录，manual / legacy 即使同键命中过也不移交所有权。
 */
export function reconcileLocalMusic(
  existing: LocalMusicInfo[],
  scans: LocalMusicScanResult[],
  fileKey: LocalMusicFileKey = defaultFileKey,
): LocalMusicInfo[] {
  const candidates: LocalMusicInfo[] = [];
  for (const scan of scans) {
    if (scan.complete !== true || !scan.scope) throw new Error("本地音乐扫描结果不完整");
    for (const song of scan.songs) {
      if (song.localOrigin !== scan.source || song.localScan?.scope !== scan.scope) {
        throw new Error("本地音乐扫描结果范围不一致");
      }
      candidates.push(song);
    }
  }
  const fresh = deduplicateLocalSongs(candidates, fileKey);
  const byFile = new Map(fresh.flatMap(song => {
    const key = fileKey(song);
    return key ? [[key, song] as const] : [];
  }));
  const incoming = new Map(candidates.map(song => [buildSongKey(song), byFile.get(fileKey(song) ?? "") ?? song]));
  const byMediaId = new Map(fresh.flatMap(song => song.localMediaId ? [[song.localMediaId, song] as const] : []));
  const remaining = new Set(fresh);
  const merged: LocalMusicInfo[] = [];
  for (const old of existing) {
    const key = buildSongKey(old);
    const byId = incoming.get(key);
    const sameProvider = old.localOrigin === "mediaStore" || old.localOrigin === "download"
      || (old.localMediaId && old.localMediaId === byId?.localMediaId);
    const next = (sameProvider ? byId : undefined)
      ?? byMediaId.get(old.localMediaId ?? "") ?? byFile.get(fileKey(old) ?? "");
    const origin = old.localOrigin ?? "legacy";
    if (next) {
      merged.push(mergeScannedSong(old, next));
      remaining.delete(next);
      continue;
    }
    const inCompletedScope = scans.some((scan) => origin === scan.source && old.localScan?.scope === scan.scope);
    if (!inCompletedScope) merged.push({ ...old, localOrigin: origin });
  }
  const existingIds = new Set(merged.map(buildSongKey));
  const additions = [...remaining].map(song => existingIds.has(buildSongKey(song))
    ? { ...song, id: `${song.localOrigin}:${song.localMediaId ?? song.id}` } : song);
  return deduplicateLocalSongs([...merged, ...additions], fileKey);
}
