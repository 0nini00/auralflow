import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { scanDirectory, getAudioInfo, type RustAudioFile } from '@lx/tauri-bridge';

export interface LocalSong {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  format: string;
  size: number;
  cover_data?: string | null;
  /** 内嵌歌词（LRC 格式），Rust 侧从 ID3 USLT / Vorbis LYRICS 读取 */
  lyrics?: string | null;
  url?: string;
  cover?: string;
  isLocal: boolean;
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
    cover_data: file.cover_data,
    lyrics: file.lyrics,
    url: convertFileSrc(file.path),
    cover: file.cover_data ?? undefined,
    isLocal: true,
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
    } catch (error) {
      console.error('Failed to select directory:', error);
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
    } catch (error) {
      console.error('Failed to select files:', error);
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
    } catch (error) {
      console.error('Failed to get audio info:', error);
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
