import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import {
  type DownloadedItem,
  type DownloadCompletion,
  DownloadInterruptedError,
  type DownloadProgressInfo,
  type DownloadQuality,
  cancelDownload,
  clearDownloadedFiles,
  downloadSong,
  getDownloadedFileSize,
  loadDownloads,
  pauseDownload,
  removeDownloadedByPath,
  removeDownloadedFile,
  resumeDownload,
  saveDownloads,
} from "@/services/downloadService";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { hapticSuccess } from "@/services/hapticService";
import { logger } from "@/services/logger";

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
  addDownload: (
    song: MusicInfo,
    localPath: string,
    quality?: DownloadQuality,
    warnings?: string[],
    completion?: DownloadCompletion,
  ) => Promise<void>;
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

// 此映射只表示 UI 所属尝试；取消和暂停状态由服务中的任务独占。
const downloadAttempts = new Map<string, object>();
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

    const attempt = {};
    downloadAttempts.set(key, attempt);
    const isCurrentAttempt = () => downloadAttempts.get(key) === attempt;

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
      // 后处理警告经回调带出：音频已落盘成功，这些失败只作为提示，不影响任务的完成判定。
      let enhancerWarnings: string[] = [];
      await downloadSong(
        song,
        (info) => {
          if (isCurrentAttempt()) get().downloadProgress({ ...song, quality }, info);
        },
        quality,
        (warnings) => {
          enhancerWarnings = warnings;
        },
        async (localPath, completion) => {
          fileDownloaded = true;
          await get().addDownload(song, localPath, quality, enhancerWarnings, completion);
        },
      );
      if (!isCurrentAttempt()) return { status: "completed" };

      // 记录提交与文件清理仍在服务队列内，旧尝试不能移除同 key 的新任务。
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
        failedDownloads: state.failedDownloads.filter((item) => failedDownloadKey(item) !== key),
      }));
      downloadAttempts.delete(key);
      hapticSuccess();
      return { status: "completed" };
    } catch (error) {
      const cause = error instanceof Error ? error.message : fileDownloaded ? "未知错误" : "下载失败";
      const message = fileDownloaded ? `文件已下载，但记录保存失败：${cause}` : cause;
      if (error instanceof DownloadInterruptedError) {
        if (isCurrentAttempt()) {
          if (error.reason === "paused") {
            set((state) => ({
              downloading: state.downloading.map((item) =>
                downloadKey(item.song, item.quality) === key ? { ...item, status: "paused" as const } : item
              ),
            }));
          } else {
            downloadAttempts.delete(key);
            set((state) => ({
              downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
            }));
          }
        }
        return { status: error.reason === "paused" ? "inProgress" : "cancelled" };
      }
      // 旧任务的真实错误仍需留证，但不得覆盖新任务的 UI。
      logger.warn(`下载失败：${song.name}（${quality}）`, message);
      if (!isCurrentAttempt()) return { status: "failed", error: message };
      downloadAttempts.delete(key);
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
      if (!pauseDownload(song, targetQuality)) return;
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
      if (songKey(item.song) === key) get().pauseDownload(item.song, item.quality);
    });
  },

  resumeDownload: (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality);
    if (targetQuality) {
      const key = downloadKey(song, targetQuality);
      if (!resumeDownload(song, targetQuality)) return;
      // 先把 paused 项移出，再重新入队（downloadSong 会对已存在的 downloading 去重）
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
      }));
      void get().downloadSong(song, targetQuality);
      return;
    }
    const key = songKey(song);
    const pausedItems = get().downloading.filter((item) => songKey(item.song) === key && item.status === "paused");
    pausedItems.forEach((item) => get().resumeDownload(item.song, item.quality));
  },

  cancelDownload: (song: MusicInfo, quality?: DownloadQuality) => {
    const targetQuality = quality ?? normalizeDownloadQuality(song.quality);
    if (targetQuality) {
      const key = downloadKey(song, targetQuality);
      cancelDownload(song, targetQuality);
      downloadAttempts.delete(key);
      set((state) => ({
        downloading: state.downloading.filter((item) => downloadKey(item.song, item.quality) !== key),
      }));
      return;
    }

    const key = songKey(song);
    cancelDownload(song);
    get().downloading.forEach((item) => {
      if (songKey(item.song) === key) downloadAttempts.delete(downloadKey(item.song, item.quality));
    });
    set((state) => ({
      downloading: state.downloading.filter((item) => songKey(item.song) !== key),
    }));
  },

  addDownload: async (
    song: MusicInfo,
    localPath: string,
    quality: DownloadQuality = "320k",
    warnings: string[] = [],
    completion?: DownloadCompletion,
  ) => {
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
      warning: warnings.length > 0 ? warnings.join("；") : undefined,
    };
    await queueDownloadsMutation(async () => {
      if (completion && !completion.isActive()) return;
      const previousDownloads = get().downloads;
      const nextDownloads = sortByDateDesc([
        nextItem,
        ...previousDownloads.filter((item) => itemDownloadKey(item) !== key),
      ]);
      await saveDownloads(nextDownloads);
      if (completion && !completion.isActive()) {
        // AsyncStorage 写入不能中断；串行锁内回滚，避免覆盖后续任务的记录。
        await saveDownloads(previousDownloads);
        return;
      }
      completion?.commit();
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
        if (target) {
          await removeDownloadedByPath(target.localPath);
        } else {
          await removeDownloadedFile(song, targetQuality);
        }
        await saveDownloads(nextDownloads);
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
