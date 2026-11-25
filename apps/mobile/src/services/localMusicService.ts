import { DeviceEventEmitter, NativeModules, Platform } from "react-native";
import RNFS from "react-native-fs";
import { check, request, PERMISSIONS, RESULTS } from "react-native-permissions";
import type { MusicInfo } from "@lx/core";
import { useDownloadStore } from "@/stores/downloadStore";
import { logger } from "@/services/logger";
import { buildDownloadFileStem } from "@/services/downloadFileNaming";
import { findDownloadDirectoryFile } from "@/services/downloadDirectoryService";
import { DOWNLOAD_SCOPE, MEDIA_STORE_SCOPE, localMusicFileKey, type LocalMusicInfo, type LocalMusicScanResult } from "./localMusicScanModel";

export function getLocalMusicFileKey(song: Pick<MusicInfo, "url">): string | undefined {
  return localMusicFileKey(song.url, RNFS.ExternalStorageDirectoryPath);
}

/**
 * 原生模块返回的单首本地歌曲结构。
 */
interface NativeLocalSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** 时长（毫秒） */
  duration: number;
  /** 设备上的文件绝对路径 */
  filePath: string;
  /** MediaStore content URI，可用于播放/访问 */
  contentUri?: string;
  /** 专辑封面 content URI 或 file:// sidecar 封面路径；null 表示当前没有封面 */
  albumArtUri?: string | null;
  /** 内嵌歌词（USLT 帧）或同名 .lrc 旁挂歌词内容；无则为空 */
  lyrics?: string;
  warnings?: string[];
}

interface NativeScannedSong extends NativeLocalSong {
  signature: string;
  tagsUnchanged: boolean;
}

interface NativeLocalScan {
  scope: string;
  complete: true;
  songs: NativeScannedSong[];
}

interface LocalMusicNativeModule {

  scanLocalMusic(knownSignatures: Record<string, string>): Promise<NativeLocalScan>;

  pickLocalAudioFiles(): Promise<NativeLocalSong[]>;

  readLocalAudioFile(uri: string): Promise<NativeLocalSong>;

  updateAudioMetadata(mediaId: string, metadata: Record<string, string>): Promise<number>;


  writeAudioLyrics(mediaId: string, lrc: string): Promise<boolean>;

}

const nativeLocalMusicModule = NativeModules.LocalMusicModule as
  | LocalMusicNativeModule
  | undefined;

/**
 * 请求音频存储权限（Android 13+ 使用 READ_MEDIA_AUDIO，旧版本使用 READ_EXTERNAL_STORAGE）。
 */
export async function requestAudioPermission(): Promise<boolean> {
  if (Platform.OS !== "android") {
    return true;
  }

  const permission =
    Platform.Version >= 33
      ? PERMISSIONS.ANDROID.READ_MEDIA_AUDIO
      : PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;
  const result = await check(permission);
  if (result === RESULTS.GRANTED) return true;
  return (await request(permission)) === RESULTS.GRANTED;
}

/**
 * 下载入库的本地歌曲 id 前缀：区分 MediaStore 扫描条目（这类歌曲没有原生媒体 id，
 * 编辑元数据时不能走 MediaStore 写回）。
 */
const DOWNLOADED_LOCAL_ID_PREFIX = "dl-";

/** 是否为「应用下载目录」入库的本地歌曲（而非 MediaStore 扫描条目）。 */
export function isDownloadedLocalSong(song: Pick<MusicInfo, "id"> & Pick<LocalMusicInfo, "localOrigin">): boolean {
  if (song.localOrigin && song.localOrigin !== "legacy") return song.localOrigin === "download";
  // 仅保留旧版元数据编辑判断的兼容性；范围对账绝不使用 ID 前缀推断来源。
  return String(song.id).startsWith(DOWNLOADED_LOCAL_ID_PREFIX);
}

/**
 * 将下载记录与已入库下载曲指向的已知文件映射为本地歌曲。
 * 本范围不枚举应用下载目录，不发现没有记录的孤儿文件。
 *
 * 该目录是应用私有外部目录，MediaStore 不会索引它——只靠 scanLocalMusic 的
 * MediaStore 查询，下载的歌曲在本地曲库里永远刷不出来，必须在此显式合并。
 * 只有确认已知文件不存在才移除对应条目；移除下载记录不等于删除文件。
 */
export async function getDownloadedLocalSongs(existing: LocalMusicInfo[] = []): Promise<LocalMusicScanResult> {
  await useDownloadStore.getState().loadDownloads();
  const { downloads, error } = useDownloadStore.getState();
  if (error) throw new Error(error);
  /*
   * 同一首歌可能有多条下载记录（不同音质）以及曲库里的旧条目。它们共用一个本地 id，
   * 但文件路径可能不同：某条记录的旧文件已被移动/删除时，不能让它把仍有效的条目
   * 覆盖掉。按 id 分组后逐个检查，取第一条可播放的文件；下载记录排在旧曲库条目前面，
   * 保证元数据优先使用最近一次下载。
   */
  interface DownloadCandidate extends LocalMusicInfo {
    /** 记录路径失效时，用于在所选下载文件夹里找回被移动的文件。 */
    recoveryPrefix?: string;
  }
  const groups = new Map<string, DownloadCandidate[]>();
  const addCandidate = (song: DownloadCandidate) => {
    const list = groups.get(song.id);
    if (list) list.push(song);
    else groups.set(song.id, [song]);
  };
  for (const item of downloads) {
    if (!item.localPath) throw new Error("下载记录缺少本地文件路径");
    const cover = item.song.picUrl || item.song.img;
    const id = DOWNLOADED_LOCAL_ID_PREFIX + item.song.source + "-" + item.song.id;
    addCandidate({
      id,
      name: item.song.name,
      singer: item.song.singer || "未知歌手",
      albumName: item.song.albumName || "未知专辑",
      source: "local",
      interval: item.song.interval,
      url: getLocalMusicUrl(item.localPath),
      picUrl: cover,
      img: cover,
      isLocal: true,
      localOrigin: "download",
      localScan: { scope: DOWNLOAD_SCOPE },
      recoveryPrefix: `${buildDownloadFileStem(item.song, item.quality ?? "320k")}.`,
    });
  }
  // 下载记录被移除不代表文件被删除；已有曲库条目作为兜底候选。
  for (const song of existing) {
    if (song.localOrigin === "download" && song.localScan?.scope === DOWNLOAD_SCOPE) {
      addCandidate(song);
    }
  }

  const resolveCandidate = async (candidate: DownloadCandidate): Promise<LocalMusicInfo | null> => {
    const { recoveryPrefix, ...song } = candidate;
    if (!song.url) return null;
    if (!song.url.startsWith("file://")) {
      // content:// 由系统文档提供方管理，无法用 RNFS 判存；保留记录交给播放器校验。
      return song;
    }
    const path = song.url.slice(7);
    let exists: boolean;
    try {
      exists = await RNFS.exists(path);
    } catch (error) {
      logger.warn("[local] 检查下载文件失败，保留记录", song.id, error);
      return song;
    }
    if (!exists) {
      // 下载文件可能已被移动到用户选择的文件夹；按下载文件名前缀找回。
      if (recoveryPrefix) {
        try {
          const recovered = await findDownloadDirectoryFile(recoveryPrefix);
          if (recovered) return { ...song, url: recovered };
        } catch (error) {
          logger.warn("[local] 在下载文件夹中找回文件失败", song.id, error);
        }
      }
      return null;
    }
    try {
      return { ...song, localLyrics: await readSidecarLrc(path) };
    } catch (error) {
      logger.warn("[local] 读取下载歌曲旁挂歌词失败，保留记录", song.id, error);
      return { ...song };
    }
  };

  const resolved = await Promise.all([...groups.values()].map(async (candidates) => {
    for (const candidate of candidates) {
      const valid = await resolveCandidate(candidate);
      if (valid) return valid;
    }
    return null;
  }));
  return {
    source: "download", scope: DOWNLOAD_SCOPE, complete: true,
    songs: resolved.filter((song) => song !== null),
  };
}

/**
 * 扫描设备本地音乐文件，返回完整范围结果；缓存只来自现有曲库记录。
 *
 * 依赖原生模块 NativeModules.LocalMusicModule.scanLocalMusic()。
 * 若模块未注册（例如未重新编译原生工程），会抛出清晰错误。
 */
export interface LocalMusicScanProgress {
  scanned: number;
  total: number;
}

export async function scanLocalMusic(
  existing: LocalMusicInfo[] = [],
  onProgress?: (progress: LocalMusicScanProgress) => void,
): Promise<LocalMusicScanResult> {
  if (Platform.OS !== "android") throw new Error("当前平台不支持本地音乐扫描");

  const hasPermission = await requestAudioPermission();

  if (!hasPermission) {
    throw new Error("未授予音频文件访问权限，请在系统设置中允许访问音乐文件");
  }

  if (!nativeLocalMusicModule || typeof nativeLocalMusicModule.scanLocalMusic !== "function") {
    throw new Error(
      "Android 本地音乐原生模块未注册（NativeModules.LocalMusicModule 缺失）。请重新编译原生工程：cd apps/mobile/android && ./gradlew clean && ./gradlew assembleDebug",
    );
  }

  const previousSongs = new Map(existing
    .filter(song => song.localMediaId || song.localOrigin === "mediaStore")
    .map(song => [song.localMediaId ?? song.id, song]));
  const previousFiles = new Map(existing.flatMap(song => {
    const key = getLocalMusicFileKey(song);
    return key ? [[key, song] as const] : [];
  }));
  const cached = new Map(existing
    .filter((song) => (song.localMediaId || song.localScan?.scope === MEDIA_STORE_SCOPE) && song.localScan?.signature)
    .map((song) => [song.localMediaId ?? song.id, song]));
  const signatures = Object.fromEntries([...cached].map(([id, song]) => [id, song.localScan!.signature!]));
  const subscription = onProgress
    ? DeviceEventEmitter.addListener("LocalMusicScanProgress", (event: unknown) => {
        const payload = event as { scanned?: unknown; total?: unknown } | null;
        if (payload && typeof payload.scanned === "number" && typeof payload.total === "number"
          && Number.isFinite(payload.scanned) && Number.isFinite(payload.total)) {
          onProgress({ scanned: payload.scanned, total: payload.total });
        }
      })
    : null;
  try {
    const result = await nativeLocalMusicModule.scanLocalMusic(signatures);
    validateNativeScan(result);
    const songs = result.songs.map((native) => {
      const song = mapNativeLocalSong(native);
      const previous = previousSongs.get(native.id) ?? previousFiles.get(getLocalMusicFileKey(song) ?? "");
      if (native.tagsUnchanged) {
        const cachedSong = cached.get(native.id);
        if (!cachedSong || cachedSong.localScan?.signature !== native.signature) {
          throw new Error("本地音乐扫描缓存签名不匹配");
        }
        song.localLyrics = cachedSong.localLyrics;
        // 封面每次扫描都由原生重新解析：null 明确清掉旧封面，undefined 兼容旧原生模块。
        const cover = native.albumArtUri === null
          ? undefined
          : native.albumArtUri ?? cachedSong.picUrl;
        song.picUrl = cover;
        song.img = cover;
      }
      if (native.warnings?.length && native.lyrics === undefined) song.localLyrics = previous?.localLyrics;
      return { ...song, localOrigin: "mediaStore" as const, localMediaId: native.id,
        localScan: { scope: MEDIA_STORE_SCOPE, signature: native.warnings?.length ? undefined : native.signature } };
    });
    const warnings = result.songs.flatMap(song => (song.warnings ?? []).map(message => ({ id: song.id, name: song.title, message })));
    for (const warning of warnings) logger.warn("[local] 扫描标签读取失败", warning);
    return { source: "mediaStore", scope: MEDIA_STORE_SCOPE, complete: true, songs, warnings };
  } finally {
    subscription?.remove();
  }
}

/**
 * 打开系统文件选择器，手动挑选音频文件加入本地曲库（对齐桌面端「添加文件」）。
 * 用户取消时返回空数组。
 */
export async function pickLocalAudioFiles(): Promise<LocalMusicInfo[]> {
  if (Platform.OS !== "android") {
    return [];
  }

  if (!nativeLocalMusicModule || typeof nativeLocalMusicModule.pickLocalAudioFiles !== "function") {
    throw new Error(
      "Android 本地音乐原生模块未注册（pickLocalAudioFiles 缺失）。请重新编译原生工程后再试。",
    );
  }

  const songs = await nativeLocalMusicModule.pickLocalAudioFiles();
  if (!Array.isArray(songs)) throw new Error("本地音乐导入结果格式错误");
  return songs.map((song) => {
    const mapped = mapNativeLocalSong(song);
    // 文档提供方的 _ID 只在提供方内部有效，使用完整 URI 作为手动曲目的身份。
    return { ...mapped, id: mapped.localMediaId ?? song.contentUri ?? song.id, localOrigin: "manual" };
  });
}

/** 读取外部打开的音频用于当前播放，不将临时授权写入本地曲库。 */
export async function readLocalAudioFile(uri: string): Promise<LocalMusicInfo> {
  if (Platform.OS !== "android") throw new Error("外部音频打开当前仅支持 Android");
  if (typeof uri !== "string" || !uri) throw new Error("音频 URI 不能为空");
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("音频 URI 格式无效");
  }
  if ((parsed.protocol !== "file:" && parsed.protocol !== "content:") || !parsed.pathname || parsed.hash
      || (parsed.protocol === "content:" && !parsed.hostname) || (parsed.protocol === "file:" && parsed.hostname)) {
    throw new Error("仅支持 file:// 或 content:// 音频 URI");
  }
  if (!nativeLocalMusicModule || typeof nativeLocalMusicModule.readLocalAudioFile !== "function") {
    throw new Error("Android 本地音乐原生模块未注册（readLocalAudioFile 缺失）");
  }
  const song = await nativeLocalMusicModule.readLocalAudioFile(uri);
  if (!song || typeof song.id !== "string" || !song.id
      || typeof song.title !== "string" || typeof song.artist !== "string" || typeof song.album !== "string"
      || typeof song.duration !== "number" || !Number.isFinite(song.duration) || song.duration < 0
      || typeof song.filePath !== "string" || !song.filePath
      || (song.contentUri !== undefined && typeof song.contentUri !== "string")
      || (song.lyrics !== undefined && typeof song.lyrics !== "string")
      || (song.warnings !== undefined && (!Array.isArray(song.warnings)
        || song.warnings.some(warning => typeof warning !== "string" || !warning.trim())))
      || (song.albumArtUri != null && typeof song.albumArtUri !== "string")) {
    throw new Error("外部音频读取结果无效");
  }
  return {
    ...mapNativeLocalSong(song),
    url: parsed.protocol === "file:" ? parsed.href : uri,
    localOrigin: "manual",
  };
}

function validateNativeScan(result: NativeLocalScan): void {
  if (!result || result.complete !== true || result.scope !== MEDIA_STORE_SCOPE || !Array.isArray(result.songs)) {
    throw new Error("本地音乐扫描结果无效或不完整，请检查原生模块版本");
  }
  const ids = new Set<string>();
  for (const song of result.songs) {
    if (!song || typeof song.id !== "string" || !song.id || ids.has(song.id)
      || typeof song.title !== "string" || typeof song.artist !== "string" || typeof song.album !== "string"
      || typeof song.duration !== "number" || !Number.isFinite(song.duration) || song.duration < 0
      || typeof song.filePath !== "string" || (!song.filePath && !song.contentUri)
      || typeof song.signature !== "string" || !song.signature || typeof song.tagsUnchanged !== "boolean"
      || (song.contentUri !== undefined && typeof song.contentUri !== "string")
      || (song.lyrics !== undefined && typeof song.lyrics !== "string")
      || (song.warnings !== undefined && (!Array.isArray(song.warnings)
        || song.warnings.some(warning => typeof warning !== "string" || !warning.trim())))
      || (song.albumArtUri != null && typeof song.albumArtUri !== "string")) {
      throw new Error("本地音乐扫描结果包含无效条目");
    }
    ids.add(song.id);
  }
}

function mapNativeLocalSong(song: NativeLocalSong): LocalMusicInfo {
  const filePath = song.filePath || song.contentUri || "";
  const cover = song.albumArtUri || undefined;
  return {
    id: song.id,
    name: song.title,
    singer: song.artist || "未知歌手",
    albumName: song.album || "未知专辑",
    source: "local",
    interval: Math.max(0, Math.round(song.duration / 1000)),
    url: getLocalMusicUrl(filePath),
    picUrl: cover,
    img: cover,
    localLyrics: song.lyrics || undefined,
    isLocal: true,
    localMediaId: /^content:\/\/media\/[^/]+\/audio\/media\/(\d+)$/.exec(song.contentUri ?? "")?.[1],
  };
}

/**
 * 读取下载音频的同名旁挂 .lrc 歌词（下载时由 downloadService 写入）。
 * 不存在时返回 undefined；I/O 异常向上传递，使此次范围对账失败。
 */
async function readSidecarLrc(audioPath: string): Promise<string | undefined> {
  const plain = audioPath.startsWith("file://") ? audioPath.slice(7) : audioPath;
  const dot = plain.lastIndexOf(".");
  const lrcPath = (dot > plain.lastIndexOf("/") ? plain.slice(0, dot) : plain) + ".lrc";
  if (!(await RNFS.exists(lrcPath))) return undefined;
  const text = await RNFS.readFile(lrcPath, "utf8");
  return text.trim() ? text : undefined;
}

/**
 * 将本地文件路径转换为可播放的 file:// URL。
 * content:// URI 原样返回（部分播放器可直接消费 content URI）。
 */
export function getLocalMusicUrl(filePath: string): string {
  if (!filePath) {
    return "";
  }
  if (filePath.startsWith("file://") || filePath.startsWith("content://")) {
    return filePath;
  }
  return `file://${filePath}`;
}

/**
 * 把标题/歌手/专辑写回音频文件的 MediaStore 元数据（对应桌面端写回文件标签）。
 *
 * @param mediaId MediaStore 音频 _ID
 * @param patch 仅包含 name/singer/albumName 中需要更新的字段
 * @returns 受影响行数（0 表示未找到或未授权）
 */
export async function updateLocalMusicMetadata(
  mediaId: string,
  patch: Partial<Pick<MusicInfo, "name" | "singer" | "albumName">>,
): Promise<number> {
  if (Platform.OS !== "android") {
    return 0;
  }
  if (!nativeLocalMusicModule || typeof nativeLocalMusicModule.updateAudioMetadata !== "function") {
    throw new Error("Android 本地音乐原生模块未注册（updateAudioMetadata 缺失），请重新编译原生工程");
  }
  const metadata: Record<string, string> = {};
  if (patch.name !== undefined) metadata.title = patch.name;
  if (patch.singer !== undefined) metadata.artist = patch.singer;
  if (patch.albumName !== undefined) metadata.album = patch.albumName;
  return nativeLocalMusicModule.updateAudioMetadata(mediaId, metadata);
}

/**
 * 把 LRC 歌词写回音频文件内嵌歌词（对应桌面端写入文件标签）。
 * lrc 为空字符串时清除内嵌歌词。
 *
 * @returns true 表示写入成功
 */
export async function writeLocalMusicLyrics(mediaId: string, lrc: string): Promise<boolean> {
  if (Platform.OS !== "android") {
    return false;
  }
  if (!nativeLocalMusicModule || typeof nativeLocalMusicModule.writeAudioLyrics !== "function") {
    throw new Error("Android 本地音乐原生模块未注册（writeAudioLyrics 缺失），请重新编译原生工程");
  }
  return nativeLocalMusicModule.writeAudioLyrics(mediaId, lrc);
}
