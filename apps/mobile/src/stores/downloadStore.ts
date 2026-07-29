import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import {
  type DownloadedItem,
  type DownloadProgressInfo,
  type DownloadQuality,
  cancelDownload,
  clearDownloadedFiles,
  downloadSong,
  getDownloadedFileSize,
  loadDownloads,
  removeDownloadedByPath,
  removeDownloadedFile,
  saveDownloads,
} from "@/services/downloadService";

/** 重新导出音质类型，供组件使用 */
export type { DownloadQuality };

/**
 * 下载管理 Store
 */

/** 进行中的下载项 */
export interface DownloadingItem {
  song: MusicInfo;
  quality: DownloadQuality;
  /** 0 ~ 1 */
  progress: number;
  bytesWritten: number;
  contentLength: number;
  error?: string;
}

export interface FailedDownloadItem {
  song: MusicInfo;
  quality: DownloadQuality;
  error: string;
  failedAt: number;
}

interface DownloadState {
  /** 已下载歌曲列表 */
  downloads: DownloadedItem[];
  /** 当前下载中的歌曲（含进度） */
  downloading: DownloadingItem[];
  /** 最近失败的下载，供歌曲行显示重试入口 */
  failedDownloads: FailedDownloadItem[];
  loading: boolean;
  error: string | null;
}

interface DownloadActions {
  /** 从持久化存储加载已下载列表 */
  loadDownloads: () => Promise<void>;
  /** 触发下载（编排：进入 downloading -> 下载 -> 落入 downloads） */
  downloadSong: (song: MusicInfo, quality?: DownloadQuality) => Promise<void>;
  /** 取消某首歌的下载 */
  cancelDownload: (song: MusicInfo, quality?: DownloadQuality) => void;
  /** 新增一条已下载记录 */
  addDownload: (song: MusicInfo, localPath: string, quality?: DownloadQuality) => Promise<void>;
  /** 删除某条已下载文件 */
  removeDownload: (song: MusicInfo, quality?: DownloadQuality) => Promise<void>;
  /** 移除失败下载记录（不触碰本地文件） */
  removeFailedDownload: (song: MusicInfo, quality?: DownloadQuality) => void;
  /** 清空所有已下载文件 */
  clearDownloads: () => Promise<void>;
  /** 更新下载进度 */
  downloadProgress: (song: MusicInfo, info: DownloadProgressInfo) => void;
}

type DownloadStore = DownloadState & DownloadActions;

function songKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

function normalizeDownloadQuality(quality: unknown): DownloadQuality | undefined {
  return quality === "128k" ||
    quality === "192k" ||
    quality === "320k" ||
    quality === "flac" ||
    quality === "flac24bit"
    ? quality
    : undefined;
}

function downloadKey(song: MusicInfo, quality: DownloadQuality = "320k"): string {
  return `${songKey(song)}:${quality}`;
}

function itemDownloadKey(item: Pick<DownloadedItem, "song" | "quality">): string {
  return downloadKey(item.song, item.quality ?? "320k");
}

function failedDownloadKey(item: Pick<FailedDownloadItem, "song" | "quality">): string {
  return downloadKey(item.song, item.quality);
}

function sortByDateDesc(items: DownloadedItem[]): DownloadedItem[] {
  return [...items].sort((a, b) => b.downloadDate - a.downloadDate);
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  downloads: [],
  downloading: [],
  failedDownloads: [],
  loading: false,
  error: null,

  loadDownloads: async () => {
    try {
      set({ loading: true, error: null });
      const items = await loadDownloads();
      set({ downloads: sortByDateDesc(items), loading: false });
    } catch (error) {
      console.error("Load downloads error:", error);
      set({ loading: false, error: error instanceof Error ? error.message : "加载下载记录失败" });
    }
  },

  downloadSong: async (song: MusicInfo, quality: DownloadQuality = "320k") => {
    const key = downloadKey(song, quality);

    // 已下载则跳过
    if (get().downloads.some((item) => itemDownloadKey(item) === key)) return;
    // 已在下载中则跳过
    if (get().downloading.some((item) => downloadKey(item.song, item.quality) === key)) return;

    // 进入 downloading
    set((state) => ({
      downloading: [
        ...state.downloading,
        { song, quality, progress: 0, bytesWritten: 0, contentLength: 0 },
      ],
      failedDownloads: state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
      error: null,
    }));

    try {
      const localPath = await downloadSong(
        song,
        (info) => {
          get().downloadProgress({ ...song, quality }, info);
        },
        quality,
      );

      // 下载完成：落入 downloads，移出 downloading
      await get().addDownload(song, localPath, quality);
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
        failedDownloads: state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "下载失败";
      // 失败/取消：移出 downloading，并记录错误
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
        failedDownloads: [
          { song, quality, error: message, failedAt: Date.now() },
          ...state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
        ],
        error: message,
      }));
      console.error("Download song error:", error);
    }
  },

  cancelDownload: (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality);
    cancelDownload(song, targetQuality);
    if (targetQuality) {
      const key = downloadKey(song, targetQuality);
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
      }));
      return;
    }

    const key = songKey(song);
    set((state) => ({
      downloading: state.downloading.filter((item) => songKey(item.song) !== key),
    }));
  },

  addDownload: async (song: MusicInfo, localPath: string, quality: DownloadQuality = "320k") => {
    const key = downloadKey(song, quality);
    let fileSize = 0;
    try {
      fileSize = await getDownloadedFileSize(localPath);
    } catch (error) {
      console.error("Read downloaded file size error:", error);
    }
    const nextItem: DownloadedItem = {
      song: { ...song, quality },
      quality,
      localPath,
      fileSize,
      downloadDate: Date.now(),
    };
    const nextDownloads = sortByDateDesc([
      nextItem,
      ...get().downloads.filter((item) => itemDownloadKey(item) !== key),
    ]);
    set({ downloads: nextDownloads });
    await saveDownloads(nextDownloads);
  },

  removeDownload: async (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality) ?? "320k";
    const key = downloadKey(song, targetQuality);
    const target = get().downloads.find((item) => itemDownloadKey(item) === key);
    try {
      if (target) {
        await removeDownloadedByPath(target.localPath);
      } else {
        await removeDownloadedFile(song);
      }
      const nextDownloads = get().downloads.filter((item) => itemDownloadKey(item) !== key);
      set((state) => ({
        downloads: nextDownloads,
        failedDownloads: state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
      }));
      await saveDownloads(nextDownloads);
    } catch (error) {
      console.error("Remove download error:", error);
      set({ error: error instanceof Error ? error.message : "删除下载失败" });
    }
  },

  removeFailedDownload: (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality);
    if (targetQuality) {
      const key = downloadKey(song, targetQuality);
      set((state) => ({
        failedDownloads: state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
      }));
      return;
    }

    const key = songKey(song);
    set((state) => ({
      failedDownloads: state.failedDownloads.filter((item) => songKey(item.song) !== key),
    }));
  },

  clearDownloads: async () => {
    try {
      await clearDownloadedFiles();
      set({ downloads: [], failedDownloads: [] });
      await saveDownloads([]);
    } catch (error) {
      console.error("Clear downloads error:", error);
      set({ error: error instanceof Error ? error.message : "清空下载失败" });
    }
  },

  downloadProgress: (song: MusicInfo, info: DownloadProgressInfo) => {
    const quality = normalizeDownloadQuality(song.quality) ?? "320k";
    const key = downloadKey(song, quality);
    set((state) => ({
      downloading: state.downloading.map((item) =>
        downloadKey(item.song, item.quality) === key
          ? {
              ...item,
              progress: info.progress,
              bytesWritten: info.bytesWritten,
              contentLength: info.contentLength,
              error: undefined,
            }
          : item
      ),
    }));
  },
}));
