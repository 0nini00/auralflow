import { NativeModules, Platform } from "react-native";
import RNFS from "react-native-fs";
import { check, request, PERMISSIONS, RESULTS } from "react-native-permissions";
import type { MusicInfo } from "@lx/core";
import { useDownloadStore } from "@/stores/downloadStore";

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
  /** 专辑封面 content URI 或 file:// sidecar 封面路径 */
  albumArtUri?: string;
  /** 内嵌歌词（USLT 帧）或同名 .lrc 旁挂歌词内容；无则为空 */
  lyrics?: string;
}

interface LocalMusicNativeModule {

  scanLocalMusic(): Promise<NativeLocalSong[]>;

  pickLocalAudioFiles(): Promise<NativeLocalSong[]>;

  updateAudioMetadata(mediaId: string, metadata: Record<string, string>): Promise<number>;

  writeAudioCover(mediaId: string, imageUri: string): Promise<boolean>;

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

  try {
    const permission =
      Platform.Version >= 33
        ? PERMISSIONS.ANDROID.READ_MEDIA_AUDIO
        : PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;

    const result = await check(permission);

    if (result === RESULTS.GRANTED) {
      return true;
    }

    const requestResult = await request(permission);
    return requestResult === RESULTS.GRANTED;
  } catch (error) {
    return false;
  }
}

/**
 * 下载入库的本地歌曲 id 前缀：区分 MediaStore 扫描条目（这类歌曲没有原生媒体 id，
 * 编辑元数据时不能走 MediaStore 写回）。
 */
const DOWNLOADED_LOCAL_ID_PREFIX = "dl-";

/** 是否为「应用下载目录」入库的本地歌曲（而非 MediaStore 扫描条目）。 */
export function isDownloadedLocalSong(song: Pick<MusicInfo, "id">): boolean {
  return String(song.id).startsWith(DOWNLOADED_LOCAL_ID_PREFIX);
}

/**
 * 把应用下载目录（DocumentDirectoryPath/auralflow/downloads）中已完成的下载
 * 映射为本地歌曲。
 *
 * 该目录是应用私有外部目录，MediaStore 不会索引它——只靠 scanLocalMusic 的
 * MediaStore 查询，下载的歌曲在本地曲库里永远刷不出来，必须在此显式合并。
 * 文件已被删除（下载管理里移除过）的条目自动跳过。
 */
export async function getDownloadedLocalSongs(): Promise<MusicInfo[]> {
  const downloads = useDownloadStore.getState().downloads;
  if (downloads.length === 0) return [];
  const resolved = await Promise.all(
    downloads.map(async (item): Promise<MusicInfo | null> => {
      if (!item.localPath) return null;
      try {
        if (!(await RNFS.exists(item.localPath))) return null;
      } catch {
        return null;
      }
      const cover = item.song.picUrl || item.song.img;
      const localLyrics = await readSidecarLrc(item.localPath);
      return {
        id: `${DOWNLOADED_LOCAL_ID_PREFIX}${item.song.source}-${item.song.id}`,
        name: item.song.name,
        singer: item.song.singer || "未知歌手",
        albumName: item.song.albumName || "未知专辑",
        source: "local",
        interval: item.song.interval,
        url: getLocalMusicUrl(item.localPath),
        picUrl: cover,
        img: cover,
        localLyrics,
        isLocal: true,
      } satisfies MusicInfo;
    }),
  );
  return resolved.filter((song): song is MusicInfo => song != null);
}

/**
 * 扫描设备本地音乐文件，返回 MusicInfo[]（source: "local"）。
 *
 * 依赖原生模块 NativeModules.LocalMusicModule.scanLocalMusic()。
 * 若模块未注册（例如未重新编译原生工程），会抛出清晰错误。
 */
export async function scanLocalMusic(): Promise<MusicInfo[]> {
  if (Platform.OS !== "android") {
    return [];
  }

  const hasPermission = await requestAudioPermission();

  if (!hasPermission) {
    throw new Error("未授予音频文件访问权限，请在系统设置中允许访问音乐文件");
  }

  if (!nativeLocalMusicModule || typeof nativeLocalMusicModule.scanLocalMusic !== "function") {
    throw new Error(
      "Android 本地音乐原生模块未注册（NativeModules.LocalMusicModule 缺失）。请重新编译原生工程：cd apps/mobile/android && ./gradlew clean && ./gradlew assembleDebug",
    );
  }

  const songs = await nativeLocalMusicModule.scanLocalMusic();
  return mapNativeLocalSongs(songs);
}

/**
 * 打开系统文件选择器，手动挑选音频文件加入本地曲库（对齐桌面端「添加文件」）。
 * 用户取消时返回空数组。
 */
export async function pickLocalAudioFiles(): Promise<MusicInfo[]> {
  if (Platform.OS !== "android") {
    return [];
  }

  if (!nativeLocalMusicModule || typeof nativeLocalMusicModule.pickLocalAudioFiles !== "function") {
    throw new Error(
      "Android 本地音乐原生模块未注册（pickLocalAudioFiles 缺失）。请重新编译原生工程后再试。",
    );
  }

  const songs = await nativeLocalMusicModule.pickLocalAudioFiles();
  return mapNativeLocalSongs(Array.isArray(songs) ? songs : []);
}

function mapNativeLocalSongs(songs: NativeLocalSong[]): MusicInfo[] {
  return songs.map((song) => {
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
    } satisfies MusicInfo;
  });
}

/**
 * 读取下载音频的同名旁挂 .lrc 歌词（下载时由 downloadService 写入）。
 * 文件不存在或读取失败返回 undefined，不影响歌曲入库。
 */
async function readSidecarLrc(audioPath: string): Promise<string | undefined> {
  try {
    const plain = audioPath.startsWith("file://") ? audioPath.slice(7) : audioPath;
    const lrcPath = plain.replace(/\.[^/.]+$/, ".lrc");
    if (!(await RNFS.exists(lrcPath))) return undefined;
    const text = await RNFS.readFile(lrcPath, "utf8");
    return text.trim() ? text : undefined;
  } catch {
    return undefined;
  }
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
 * 把本地图片字节写回音频文件内嵌封面（对应桌面端写入文件标签）。
 * imageUri 为图片的 content:// URI（通常由图片选择器返回）。
 *
 * @returns true 表示写入成功
 */
export async function writeLocalMusicCover(mediaId: string, imageUri: string): Promise<boolean> {
  if (Platform.OS !== "android") {
    return false;
  }
  if (!nativeLocalMusicModule || typeof nativeLocalMusicModule.writeAudioCover !== "function") {
    throw new Error("Android 本地音乐原生模块未注册（writeAudioCover 缺失），请重新编译原生工程");
  }
  return nativeLocalMusicModule.writeAudioCover(mediaId, imageUri);
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
