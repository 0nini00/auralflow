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
  isDownloadPaused,
  loadDownloads,
  pauseDownload,
  removeDownloadedByPath,
  removeDownloadedFile,
  resumeDownload,
  saveDownloads,
} from "@/services/downloadService";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { hapticSuccess } from "@/services/hapticService";

/** 重新导出音质类型，供组件使用 */
export type { DownloadQuality };

export type DownloadSongResult = {
  status: "completed" | "skipped" | "failed" | "cancelled" | "inProgress";
  error?: string;
};

/**
 * 下载管理 Store
 */

/** 进行中的下载项（含排队等待与暂停状态） */
export interface DownloadingItem {
  song: MusicInfo;
  quality: DownloadQuality;
  /** 0 ~ 1 */
  progress: number;
  bytesWritten: number;
  contentLength: number;
  /** 下载速度（字节/秒），进行中实时更新 */
  speed: number;
  /** waiting: 排队未开始 | downloading: 下载中 | paused: 已暂停可继续 */
  status: "waiting" | "downloading" | "paused";
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
  /** 触发下载（编排：进入 waiting -> 串行队列下载 -> 落入 downloads） */
  downloadSong: (song: MusicInfo, quality?: DownloadQuality) => Promise<DownloadSongResult>;
  /** 取消某首歌的下载 */
  cancelDownload: (song: MusicInfo, quality?: DownloadQuality) => void;
  /** 暂停某首歌的下载（可继续） */
  pauseDownload: (song: MusicInfo, quality?: DownloadQuality) => void;
  /** 继续已暂停的下载 */
  resumeDownload: (song: MusicInfo, quality?: DownloadQuality) => void;
  /** 新增一条已下载记录 */
  addDownload: (song: MusicInfo, localPath: string, quality?: DownloadQuality) => Promise<void>;
  /** 移除一条已下载记录（对齐 lx removeTask：只删记录不动文件，重新下载时按文件名约定秒完成） */
  removeDownloadRecord: (song: MusicInfo, quality?: DownloadQuality) => Promise<void>;
  /** 删除某条已下载记录并连同本地文件一起删除 */
  removeDownload: (song: MusicInfo, quality?: DownloadQuality) => Promise<void>;
  /** 移除失败下载记录（不触碰本地文件） */
  removeFailedDownload: (song: MusicInfo, quality?: DownloadQuality) => void;
  /** 清空所有已下载文件 */
  clearDownloads: () => Promise<void>;
  /** 更新下载进度 */
  downloadProgress: (song: MusicInfo, info: DownloadProgressInfo) => void;
}

type DownloadStore = DownloadState & DownloadActions;

const cancellationRequests = new Set<string>();
let downloadsMutationQueue: Promise<void> = Promise.resolve();

function queueDownloadsMutation(mutation: () => Promise<void>): Promise<void> {
  const result = downloadsMutationQueue.then(mutation, mutation);
  downloadsMutationQueue = result.catch(() => undefined);
  return result;
}

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
      set({ loading: false, error: error instanceof Error ? error.message : "加载下载记录失败" });
    }
  },

  downloadSong: async (song: MusicInfo, requestedQuality?: DownloadQuality) => {
    const quality = requestedQuality ?? usePlaybackSettingsStore.getState().defaultQuality;
    const key = downloadKey(song, quality);

    // 已下载则跳过
    if (get().downloads.some((item) => itemDownloadKey(item) === key)) {
      return { status: "skipped" };
    }
    // 已在下载中则跳过
    if (get().downloading.some((item) => downloadKey(item.song, item.quality) === key)) {
      return { status: "inProgress" };
    }

    // 进入 waiting（串行队列排队），等待前序任务完成后自动转 downloading
    set((state) => ({
      downloading: [
        ...state.downloading,
        { song, quality, progress: 0, bytesWritten: 0, contentLength: 0, speed: 0, status: "waiting" },
      ],
      failedDownloads: state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
      error: null,
    }));

    let fileDownloaded = false;
    try {
      const localPath = await downloadSong(
        song,
        (info) => {
          get().downloadProgress({ ...song, quality }, info);
        },
        quality,
      );
      fileDownloaded = true;

      // 下载完成：落入 downloads，移出 downloading
      await get().addDownload(song, localPath, quality);
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
        failedDownloads: state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
      }));
      cancellationRequests.delete(key);
      hapticSuccess();
      return { status: "completed" };
    } catch (error) {
      const cause = error instanceof Error ? error.message : fileDownloaded ? "未知错误" : "下载失败";
      const message = fileDownloaded ? `文件已下载，但记录保存失败：${cause}` : cause;
      // 暂停引发的 rejection（stopDownload / 出队「已取消」）：保持 paused 状态，不记失败、不移出
      if (!fileDownloaded && isDownloadPaused(song, quality)) {
        set((state) => ({
          downloading: state.downloading.map((item) =>
            downloadKey(item.song, item.quality) === key
              ? { ...item, status: "paused" as const }
              : item
          ),
        }));
        return { status: "inProgress" };
      }
      const cancellationRequested = cancellationRequests.delete(key);
      const isCancelled = !fileDownloaded && (cancellationRequested || /cancel|取消/i.test(message));
      if (isCancelled) {
        // 取消：仅移出 downloading，不记失败、不设 error
        set((state) => ({
          downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
        }));
        return { status: "cancelled" };
      }
      // 失败：移出 downloading，并记录错误
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
        failedDownloads: [
          { song, quality, error: message, failedAt: Date.now() },
          ...state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
        ],
        error: message,
      }));
      return { status: "failed", error: message };
    }
  },

  pauseDownload: (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality);
    if (targetQuality) {
      const key = downloadKey(song, targetQuality);
      pauseDownload(song, targetQuality);
      set((state) => ({
        downloading: state.downloading.map((item) =>
          downloadKey(item.song, item.quality) === key
            ? { ...item, status: "paused" as const }
            : item
        ),
      }));
      return;
    }
    const key = songKey(song);
    get().downloading.forEach((item) => {
      if (songKey(item.song) === key) pauseDownload(item.song, item.quality);
    });
    set((state) => ({
      downloading: state.downloading.map((item) =>
        songKey(item.song) === key ? { ...item, status: "paused" as const } : item
      ),
    }));
  },

  resumeDownload: (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality);
    if (targetQuality) {
      const key = downloadKey(song, targetQuality);
      // 标记为可续传（service 层）
      resumeDownload(song, targetQuality);
      // 先把 paused 项移出，再重新入队（downloadSong 会对已存在的 downloading 去重）
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
      }));
      void get().downloadSong(song, targetQuality);
      return;
    }
    const key = songKey(song);
    const pausedItems = get().downloading.filter((item) => songKey(item.song) === key);
    pausedItems.forEach((item) => resumeDownload(item.song, item.quality));
    set((state) => ({
      downloading: state.downloading.filter((item) => songKey(item.song) !== key),
    }));
    pausedItems.forEach((item) => void get().downloadSong(item.song, item.quality));
  },

  cancelDownload: (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality);
    if (targetQuality) {
      const key = downloadKey(song, targetQuality);
      if (get().downloading.some((item) => downloadKey(item.song, item.quality) === key)) {
        cancellationRequests.add(key);
      }
      cancelDownload(song, targetQuality);
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
      }));
      return;
    }

    const key = songKey(song);
    get().downloading.forEach((item) => {
      if (songKey(item.song) === key) cancellationRequests.add(downloadKey(item.song, item.quality));
    });
    cancelDownload(song);
    set((state) => ({
      downloading: state.downloading.filter((item) => songKey(item.song) !== key),
    }));
  },

  addDownload: async (song: MusicInfo, localPath: string, quality: DownloadQuality = "320k") => {
    const key = downloadKey(song, quality);
    let fileSize = 0;
    try {
      fileSize = await getDownloadedFileSize(localPath);
    } catch {}
    const nextItem: DownloadedItem = {
      song: { ...song, quality },
      quality,
      localPath,
      fileSize,
      downloadDate: Date.now(),
    };
    await queueDownloadsMutation(async () => {
      const nextDownloads = sortByDateDesc([
        nextItem,
        ...get().downloads.filter((item) => itemDownloadKey(item) !== key),
      ]);
      await saveDownloads(nextDownloads);
      set({ downloads: nextDownloads });
    });
  },

  removeDownloadRecord: async (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality) ?? "320k";
    const key = downloadKey(song, targetQuality);
    try {
      await queueDownloadsMutation(async () => {
        const nextDownloads = get().downloads.filter((item) => itemDownloadKey(item) !== key);
        await saveDownloads(nextDownloads);
        set((state) => ({
          downloads: nextDownloads,
          failedDownloads: state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
        }));
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "移除下载记录失败" });
    }
  },

  removeDownload: async (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality) ?? "320k";
    const key = downloadKey(song, targetQuality);
    try {
      await queueDownloadsMutation(async () => {
        const target = get().downloads.find((item) => itemDownloadKey(item) === key);
        const nextDownloads = get().downloads.filter((item) => itemDownloadKey(item) !== key);
        await saveDownloads(nextDownloads);
        if (target) {
          await removeDownloadedByPath(target.localPath);
        } else {
          await removeDownloadedFile(song, targetQuality);
        }
        set((state) => ({
          downloads: nextDownloads,
          failedDownloads: state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
        }));
      });
    } catch (error) {
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
      await queueDownloadsMutation(async () => {
        await saveDownloads([]);
        await clearDownloadedFiles();
        set({ downloads: [], failedDownloads: [] });
      });
    } catch (error) {
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
              speed: info.speed,
              // 首次收到进度回调 → 进入真正下载中
              status: info.progress > 0 ? "downloading" : item.status,
              error: undefined,
            }
          : item
      ),
    }));
  },
}));
