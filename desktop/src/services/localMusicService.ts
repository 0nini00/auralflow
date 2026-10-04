import type { MusicInfo, ReplayGainInfo } from '@lx/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { scanDirectory, getAudioInfo, getAudioReplayGain, type RustAudioFile } from '@lx/tauri-bridge';

export interface LocalSong {
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
   * 封面地址（asset 协议的短路径）。
   *
   * 不再保存 base64：整库 base64 会把 library.json 撑到数百 MB 并常驻内存，
   * Rust 侧已把内嵌封面落盘到封面缓存，这里只留路径。
   */
  cover?: string;
  isLocal: boolean;
  replayGain?: ReplayGainInfo;
  replayGainError?: string;
  embeddedLyrics?: string;
  /** 手动应用到本机的覆盖项，不代表已经写回音频文件。 */
  lyricsOverride?: string;
  lyricsTranslationOverride?: string;
  lyricsRomanizationOverride?: string;
  coverOverride?: string;
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
    replayGain: file.replayGain ? { gainDb: file.replayGain.gainDb, peak: file.replayGain.peak ?? undefined } : undefined,
    embeddedLyrics: file.lyrics ?? undefined,
  };
}

export function getLocalSongCover(song: LocalSong): string | undefined {
  return song.coverOverride ?? song.cover;
}

export function localSongToMusicInfo(song: LocalSong): MusicInfo {
  const cover = getLocalSongCover(song);
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
    localLyrics: song.lyricsOverride ?? song.embeddedLyrics,
    localLyricsTranslation: song.lyricsTranslationOverride,
    localLyricsRomanization: song.lyricsRomanizationOverride,
    replayGain: song.replayGain,
    replayGainError: song.replayGainError,
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

/** 标签故障只禁用此曲的增益并带回原因，不让它伪装成成功或阻止正常解码。 */
export async function readLocalReplayGain(music: MusicInfo): Promise<MusicInfo> {
  if (music.source !== 'local' || !music.isLocal || !music.localPath) return music;
  try {
    const tag = await getAudioReplayGain(music.localPath);
    return { ...music, replayGain: tag ? { gainDb: tag.gainDb, peak: tag.peak ?? undefined } : undefined, replayGainError: undefined };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn('[ReplayGain] 本地标签读取失败，保持原音量', reason);
    return { ...music, replayGain: undefined, replayGainError: reason };
  }
}
