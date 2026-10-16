import type { MusicInfo } from '@lx/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { scanDirectory, getAudioInfo, type RustAudioFile } from '@lx/tauri-bridge';
import { type LocalLyricsChoiceFields, resolveLocalLyricsChoice } from '@/services/localLyricsChoiceModel';

export interface LocalSong extends LocalLyricsChoiceFields {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  format: string;
  size: number;
  url?: string;
  /**
   * 封面地址（asset 协议的短路径），唯一来源是音频文件自己：内嵌标签或同目录旁挂图，
   * 由 Rust 扫描时落盘后回传。没有平台匹配、也没有用户覆盖项，所以缺封面就是缺封面。
   *
   * 不保存 base64：整库 base64 会把 library.json 撑到数百 MB 并常驻内存，
   * Rust 侧已把内嵌封面落盘到封面缓存，这里只留路径。
   */
  cover?: string;
  isLocal: boolean;
  embeddedLyrics?: string;
  /** 手动应用到本机的覆盖项，不代表已经写回音频文件。 */
  lyricsOverride?: string;
  lyricsTranslationOverride?: string;
  lyricsRomanizationOverride?: string;
}


function rustToLocalSong(file: RustAudioFile): LocalSong {
  return {
    id: file.id,
    path: file.path,
    title: file.title,
    artist: file.artist,
    album: file.album,
    duration: file.duration,
    format: file.format,
    size: file.size,
    url: convertFileSrc(file.path),
    // 优先用落盘封面（短路径，可持久化）；只有单文件接口才回传 base64 作兜底
    cover: file.coverPath
      ? convertFileSrc(file.coverPath)
      : file.coverData ?? undefined,
    isLocal: true,
    embeddedLyrics: file.lyrics ?? undefined,
  };
}

/**
 * 取本地曲封面。保留这层访问器只是为了让调用方不必重复「没有用户覆盖项」这个前提：
 * 本地曲封面只可能是扫描时落进记录的 cover（内嵌标签 / 同目录旁挂图）。
 */
export function getLocalSongCover(song: LocalSong): string | undefined {
  return song.cover;
}

/**
 * 播放入口用的 `MusicInfo`：`@lx/core` 的 `MusicInfo` 不认识歌词选择三字段，
 * 用交叉类型在本端补齐（不改 packages/，也不污染核心类型）。
 */
export type LocalMusicInfo = MusicInfo & LocalLyricsChoiceFields;

/**
 * 曲库记录 → 播放链路元信息。
 *
 * 歌词选择的三态与指纹绑定在这里一次判定完（见 resolveLocalLyricsChoice）：下游的歌词服务、
 * 缓存与 UI 只看 `lyricsMode`，不必各自再判一遍；绑定不成立时这里就已经退回 auto，并把选中
 * 的那份文本丢掉——它属于上一份文件内容，继续用就是把别人的词当成这首歌的。
 */
export function localSongToMusicInfo(song: LocalSong): LocalMusicInfo {
  const cover = getLocalSongCover(song);
  const choice = resolveLocalLyricsChoice(song);
  return {
    id: song.id,
    name: song.title,
    singer: song.artist,
    albumName: song.album,
    source: 'local',
    isLocal: true,
    localPath: song.path,
    interval: song.duration,
    url: song.url || convertFileSrc(song.path),
    picUrl: cover,
    img: cover,
    localLyrics: choice.text,
    localLyricsTranslation: song.lyricsTranslationOverride,
    localLyricsRomanization: song.lyricsRomanizationOverride,
    // auto 下不携带三字段：UI 的「当前状态」与运行时行为必须始终一致
    ...(choice.mode === 'auto' ? {} : { lyricsMode: choice.mode }),
    ...(choice.lyricsFingerprint ? { lyricsFingerprint: choice.lyricsFingerprint } : {}),
    ...(choice.lyricsSourceLabel ? { lyricsSourceLabel: choice.lyricsSourceLabel } : {}),
  };
}

export class LocalMusicService {
  static async selectDirectory(): Promise<string | null> {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择音乐文件夹',
      });
      return selected as string | null;
    } catch {
      return null;
    }
  }

  static async selectFiles(): Promise<string[]> {
    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: '选择音乐文件',
        filters: [
          {
            name: 'Audio',
            extensions: this.getSupportedFormats(),
          },
        ],
      });
      if (!selected) return [];
      return Array.isArray(selected) ? selected : [selected];
    } catch {
      return [];
    }
  }

  static async scanDirectory(path: string): Promise<LocalSong[]> {
    const audioFiles = await scanDirectory(path);
    return audioFiles.map(rustToLocalSong);
  }

  static async getAudioInfo(path: string): Promise<LocalSong | null> {
    try {
      const audioFile = await getAudioInfo(path);
      return rustToLocalSong(audioFile);
    } catch {
      return null;
    }
  }

  static formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  static getSupportedFormats(): string[] {
    return [
      'mp3', 'flac', 'wav', 'aac', 'm4a',
      'ogg', 'opus', 'wma', 'ape', 'aiff',
    ];
  }
}
