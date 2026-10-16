import type { LocalSong } from "../services/localMusicService";

export interface LibraryScanSuccess {
  path: string;
  ok: true;
  songs: LocalSong[];
}

export interface LibraryScanFailure {
  path: string;
  ok: false;
  error: unknown;
}

export type LibraryScanResult = LibraryScanSuccess | LibraryScanFailure;

export interface MergeLibraryRefreshInput {
  scanPaths: string[];
  localSongs: LocalSong[];
  scanResults: LibraryScanResult[];
}

export interface MergeLibraryRefreshResult {
  songs: LocalSong[];
  added: number;
  removed: number;
  failedPaths: string[];
  /**
   * 这次合并丢掉的那些记录（文件被改名 / 移动 / 删掉，或整条扫描路径不再生效）。
   *
   * 为什么要单独交出来：记录上可能挂着用户的歌词选择（`lyricsMode` 三字段），而记录 id 是
   * `md5(路径)`——记录一没，选择就无从追踪。调用方据此把选择搬进「按内容哈希索引」的孤儿表，
   * 等新记录出现时再认回（见 services/localLyricsChoiceOrphan）。
   */
  removedSongs: LocalSong[];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function isPathInsideBase(path: string, basePath: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedBase = normalizePath(basePath);
  return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`);
}

/**
 * 合并一次重新扫描的结果。
 *
 * 旧记录整条保留：用户改过的标题 / 歌手 / 专辑、按曲歌词与歌词选择都只存在记录里，
 * 桌面端没有移动端那样的 `localEditedFields` 账本，无法区分「用户改过」与「扫描值」，
 * 所以不做字段级回填。唯一的例外是 `size`（见 refreshScannedFacts）。
 */
export function mergeLibraryRefreshResults({
  localSongs,
  scanResults,
}: MergeLibraryRefreshInput): MergeLibraryRefreshResult {
  const successfulResults = scanResults.filter((result): result is LibraryScanSuccess => result.ok);
  const successfulScanPaths = successfulResults.map((result) => result.path);
  const failedPaths = scanResults
    .filter((result): result is LibraryScanFailure => !result.ok)
    .map((result) => result.path);
  const scannedSongs = successfulResults.flatMap((result) => result.songs);
  const scannedPaths = new Set(scannedSongs.map((song) => normalizePath(song.path)));

  const existingSongs = localSongs.filter(
    (song) =>
      !successfulScanPaths.some((scanPath) => isPathInsideBase(song.path, scanPath)) ||
      scannedPaths.has(normalizePath(song.path)),
  );
  // 保留下来的记录是 localSongs 的子集（引用不变），按引用求差就得到这次被丢掉的记录。
  const keptSongs = new Set(existingSongs);
  const removedSongs = localSongs.filter((song) => !keptSongs.has(song));
  const existingIds = new Set(existingSongs.map((song) => song.id));
  const newSongs = scannedSongs.filter((song) => !existingIds.has(song.id));
  const scannedById = new Map(scannedSongs.map((song) => [song.id, song]));

  return {
    songs: existingSongs.map((song) => refreshScannedFacts(song, scannedById.get(song.id))),
    added: newSongs.length,
    removed: removedSongs.length,
    failedPaths,
    removedSongs,
  };
}

/**
 * 扫描结果里唯一可以安全回填进旧记录的字段：`size`（文件大小）。
 *
 * 为什么只有它：`size` 是文件自身的客观事实，不是用户编辑的内容，写进记录不会覆盖任何用户选择；
 * 而它是歌词选择指纹绑定要靠的那一半证据——内容被换掉时大小随之改变，歌词选择就据此静默失效
 * 回自动匹配（见 resolveLocalLyricsChoice）。
 *
 * 为什么不回填标题 / 歌手：那些字段用户可以在「编辑元数据」里改，桌面端没有记录「改过哪些字段」，
 * 回填会把用户的手工修改冲掉。
 */
function refreshScannedFacts(song: LocalSong, scanned: LocalSong | undefined): LocalSong {
  if (!scanned || scanned.size === song.size) return song;
  return { ...song, size: scanned.size };
}
