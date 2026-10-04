import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { MusicInfo } from '@lx/core';
import type { RustDownloadCompletedEvent, RustDownloadProgressEvent } from '@lx/tauri-bridge';
import {
  buildDownloadBaseName,
  buildDownloadTaskId,
  enhanceDownloadedFile,
  type DownloadQuality,
  prepareDownload,
  runDownloadTask,
  cancelDownloadTask,
} from '@/services/downloadService';

export type DownloadStatus = 'queued' | 'resolving' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type { DownloadQuality };

/** Max parallel resolve+download jobs */
const MAX_CONCURRENT_DOWNLOADS = 2;

export interface DownloadTask {
  id: string;
  music: MusicInfo;
  status: DownloadStatus;
  fileName: string;
  directory?: string;
  savedPath?: string;
  progress: number;
  downloaded: number;
  total?: number;
  speed: number;
  quality?: string;
  error?: string;
  /** 取消请求已发出；只有原生下载的实际结束才能确认取消。 */
  cancelRequested?: boolean;
  /** 后处理（标签 / 封面 / 歌词）部分失败时的提示；下载本身已完成 */
  warning?: string;
  createdAt: number;
  updatedAt: number;
}

interface DownloadStore {
  tasks: DownloadTask[];
  downloadDir: string | null;
  listenersReady: boolean;
  setDownloadDir: (dir: string | null) => void;
  chooseDownloadDir: () => Promise<string | null>;
  initDownloadListeners: () => Promise<void>;
  addDownload: (music: MusicInfo, quality?: DownloadQuality) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  removeTask: (taskId: string) => void;
  cancelTask: (taskId: string) => Promise<void>;
  clearCompleted: () => void;
  toLocalMusic: (task: DownloadTask) => MusicInfo | null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancelledError(error: unknown): boolean {
  const msg = formatError(error);
  return msg.includes('取消') || msg.toLowerCase().includes('cancel');
}

function patchTask(
  tasks: DownloadTask[],
  taskId: string,
  patch: Partial<DownloadTask>,
): DownloadTask[] {
  return tasks.map((task) => (
    task.id === taskId ? { ...task, ...patch, updatedAt: Date.now() } : task
  ));
}

/** 原生完成事件和命令返回都只确认文件落盘，不代表后处理成功。 */
function markTransferCompleted(tasks: DownloadTask[], taskId: string, savedPath: string, total?: number): DownloadTask[] {
  const current = tasks.find((task) => task.id === taskId);
  if (!current || (current.status !== 'downloading' && current.status !== 'processing' && current.status !== 'completed')) return tasks;
  if (current.status !== 'downloading') {
    // IPC 事件可能迟于命令返回，只补传输计数，不能回退阶段或清除后处理警告。
    return total === undefined ? tasks : patchTask(tasks, taskId, { downloaded: total, total });
  }
  return patchTask(tasks, taskId, {
    status: 'processing', savedPath, progress: 100, speed: 0,
    downloaded: total ?? current.downloaded, total: total ?? current.total,
    cancelRequested: false, error: undefined,
  });
}

function normalizeDownloadQuality(quality?: string): DownloadQuality | undefined {
  if (
    quality === '128k' ||
    quality === '192k' ||
    quality === '320k' ||
    quality === 'flac' ||
    quality === 'flac24bit'
  ) {
    return quality;
  }
  return undefined;
}

const activeTaskIds = new Set<string>();
const cancelledTaskIds = new Set<string>();
let pumpScheduled = false;

type StoreGet = () => DownloadStore;
type StoreSet = (
  partial: Partial<DownloadStore> | ((s: DownloadStore) => Partial<DownloadStore>),
) => void;

function schedulePump(get: StoreGet, set: StoreSet) {
  if (pumpScheduled) return;
  pumpScheduled = true;
  queueMicrotask(() => {
    pumpScheduled = false;
    void pumpQueue(get, set);
  });
}

async function pumpQueue(get: StoreGet, set: StoreSet) {
  while (activeTaskIds.size < MAX_CONCURRENT_DOWNLOADS) {
    const next = get().tasks.find((t) => t.status === 'queued' && !cancelledTaskIds.has(t.id));
    if (!next) break;
    activeTaskIds.add(next.id);
    void runOneTask(next.id, get, set).finally(() => {
      activeTaskIds.delete(next.id);
      schedulePump(get, set);
    });
  }
}

async function runOneTask(taskId: string, get: StoreGet, set: StoreSet) {
  const task = get().tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (cancelledTaskIds.has(taskId)) {
    set((state) => ({
      tasks: patchTask(state.tasks, taskId, { status: 'cancelled', speed: 0, error: '已取消' }),
    }));
    cancelledTaskIds.delete(taskId);
    return;
  }

  const { music, quality, directory } = task;
  const dir = directory || get().downloadDir;
  if (!dir) {
    set((state) => ({
      tasks: patchTask(state.tasks, taskId, { status: 'failed', speed: 0, error: '未设置下载目录' }),
    }));
    return;
  }

  set((state) => ({
    tasks: patchTask(state.tasks, taskId, {
      status: 'resolving',
      progress: 0,
      speed: 0,
      error: undefined,
    }),
  }));

  try {
    if (cancelledTaskIds.has(taskId)) throw new Error('下载已取消');
    const prepared = await prepareDownload(music, normalizeDownloadQuality(quality));
    if (cancelledTaskIds.has(taskId) || !get().tasks.some((item) => item.id === taskId && item.status === 'resolving')) {
      throw new Error('下载已取消');
    }

    set((state) => ({
      tasks: patchTask(state.tasks, taskId, {
        status: 'downloading',
        fileName: prepared.fileName,
        quality: prepared.quality,
      }),
    }));

    const savedPath = await runDownloadTask(taskId, prepared.url, dir, prepared.fileName);
    if (!get().tasks.some((item) => item.id === taskId)) return;
    set((state) => ({ tasks: markTransferCompleted(state.tasks, taskId, savedPath) }));
    // 文件已落盘；后处理异常不能把可用文件伪装成下载失败，必须作为警告显示。
    const warnings = await enhanceDownloadedFile(music, savedPath, dir, prepared.fileName)
      .catch((error: unknown) => [`后处理失败：${formatError(error)}`]);

    set((state) => {
      const current = state.tasks.find((t) => t.id === taskId);
      if (!current || current.status !== 'processing') return state;
      return {
        tasks: patchTask(state.tasks, taskId, {
          status: 'completed',
          savedPath,
          progress: 100,
          speed: 0,
          error: undefined,
          warning: warnings.length > 0 ? warnings.join('；') : undefined,
        }),
      };
    });
  } catch (error) {
    const cancelled = isCancelledError(error);
    set((state) => {
      const current = state.tasks.find((t) => t.id === taskId);
      if (!current || current.status === 'completed' || current.status === 'cancelled') return state;
      return {
        tasks: patchTask(state.tasks, taskId, {
          status: cancelled ? 'cancelled' : 'failed',
          speed: 0,
          error: cancelled ? '已取消' : formatError(error),
          cancelRequested: false,
        }),
      };
    });
  } finally {
    cancelledTaskIds.delete(taskId);
  }
}

export const useDownloadStore = create<DownloadStore>()(
  persist(
    (set, get) => ({
      tasks: [],
      downloadDir: null,
      listenersReady: false,

      setDownloadDir: (dir) => set({ downloadDir: dir }),

      chooseDownloadDir: async () => {
        const selected = await open({
          directory: true,
          multiple: false,
          title: '选择下载目录',
        });
        const dir = typeof selected === 'string' ? selected : null;
        if (dir) set({ downloadDir: dir });
        return dir;
      },

      initDownloadListeners: async () => {
        if (get().listenersReady) return;
        set({ listenersReady: true });

        await listen<RustDownloadProgressEvent>('download-progress', (event) => {
          const payload = event.payload;
          set((state) => {
            const current = state.tasks.find((t) => t.id === payload.taskId);
            if (!current || current.status !== 'downloading') {
              return state;
            }
            return {
              tasks: patchTask(state.tasks, payload.taskId, {
                status: 'downloading',
                progress: payload.progress,
                downloaded: payload.downloaded,
                total: payload.total ?? undefined,
                speed: payload.speed,
              }),
            };
          });
        });

        await listen<RustDownloadCompletedEvent>('download-completed', (event) => {
          const payload = event.payload;
          set((state) => ({
            tasks: markTransferCompleted(state.tasks, payload.taskId, payload.savedPath, payload.total),
          }));
        });
      },

      addDownload: async (music, quality) => {
        await get().initDownloadListeners();

        let directory = get().downloadDir;
        if (!directory) directory = await get().chooseDownloadDir();
        if (!directory) return;

        const existing = get().tasks.find(
          (task) => (
            task.music.id === music.id &&
            task.music.source === music.source &&
            (task.status === 'queued' || task.status === 'resolving' || task.status === 'downloading' || task.status === 'processing') &&
            (!quality || task.quality === quality)
          ),
        );
        if (existing) return;

        const taskId = buildDownloadTaskId(music);
        const now = Date.now();
        const task: DownloadTask = {
          id: taskId,
          music,
          status: 'queued',
          fileName: buildDownloadBaseName(music),
          directory,
          progress: 0,
          downloaded: 0,
          speed: 0,
          quality,
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({ tasks: [task, ...state.tasks] }));
        schedulePump(get, set);
      },

      retryTask: async (taskId) => {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task || (task.status !== 'failed' && task.status !== 'cancelled')) return;
        cancelledTaskIds.delete(taskId);
        set((state) => ({ tasks: state.tasks.filter((item) => item.id !== taskId) }));
        await get().addDownload(task.music, normalizeDownloadQuality(task.quality));
      },

      cancelTask: async (taskId) => {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task || task.cancelRequested) return;
        if (task.status === 'queued' || task.status === 'resolving') {
          // 地址解析没有原生下载句柄；阻止它启动后续下载即可。
          if (task.status === 'resolving') cancelledTaskIds.add(taskId);
          set((state) => ({
            tasks: patchTask(state.tasks, taskId, { status: 'cancelled', speed: 0, error: '已取消', cancelRequested: false }),
          }));
          schedulePump(get, set);
          return;
        }
        if (task.status !== 'downloading') return;

        set((state) => ({ tasks: patchTask(state.tasks, taskId, { cancelRequested: true, error: undefined }) }));
        try {
          // true 只表示取消标志已登记，false 表示原生句柄不存在；二者均不证明文件已停止下载。
          const accepted = await cancelDownloadTask(taskId);
          if (!accepted) throw new Error('未找到可取消的原生下载任务，请等待下载状态更新或重试取消');
        } catch (error) {
          set((state) => {
            const current = state.tasks.find((item) => item.id === taskId);
            if (current?.status !== 'downloading') return state;
            return { tasks: patchTask(state.tasks, taskId, {
              cancelRequested: false, error: `取消失败：${formatError(error)}`,
            }) };
          });
        }
      },

      removeTask: (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (task && (task.status === 'queued' || task.status === 'resolving' || task.status === 'downloading')) {
          cancelledTaskIds.add(taskId);
          void cancelDownloadTask(taskId).catch(() => undefined);
        }
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) }));
        schedulePump(get, set);
      },

      clearCompleted: () => {
        set((state) => ({
          tasks: state.tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled'),
        }));
      },

      toLocalMusic: (task) => {
        if (task.status !== 'completed' || !task.savedPath) return null;
        return {
          ...task.music,
          id: `download:${task.savedPath}`,
          source: 'local',
          url: convertFileSrc(task.savedPath),
          isLocal: true,
        };
      },
    }),
    {
      name: 'download-storage',
      partialize: (state) => ({
        downloadDir: state.downloadDir,
        tasks: state.tasks.map((task) => {
          if (task.status === 'processing') {
            return { ...task, status: 'completed' as const, cancelRequested: false,
              warning: '应用关闭，文件已下载，但封面/歌词/标签后处理未完成' };
          }
          if (task.status === 'downloading' || task.status === 'resolving' || task.status === 'queued') {
            return { ...task, status: 'failed' as const, cancelRequested: false, speed: 0, error: '应用关闭，下载已中断' };
          }
          return task;
        }),
      }),
    },
  ),
);
