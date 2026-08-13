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

export type DownloadStatus = 'queued' | 'resolving' | 'downloading' | 'completed' | 'failed' | 'cancelled';
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
    if (cancelledTaskIds.has(taskId)) throw new Error('下载已取消');

    set((state) => ({
      tasks: patchTask(state.tasks, taskId, {
        status: 'downloading',
        fileName: prepared.fileName,
        quality: prepared.quality,
      }),
    }));

    const savedPath = await runDownloadTask(taskId, prepared.url, dir, prepared.fileName);
    if (cancelledTaskIds.has(taskId)) throw new Error('下载已取消');
    await enhanceDownloadedFile(music, savedPath, dir, prepared.fileName);

    set((state) => {
      const current = state.tasks.find((t) => t.id === taskId);
      if (current?.status === 'cancelled') return state;
      if (current?.status === 'completed' && current.savedPath) return state;
      return {
        tasks: patchTask(state.tasks, taskId, {
          status: 'completed',
          savedPath,
          progress: 100,
          speed: 0,
          error: undefined,
        }),
      };
    });
  } catch (error) {
    const cancelled = cancelledTaskIds.has(taskId) || isCancelledError(error);
    set((state) => {
      const current = state.tasks.find((t) => t.id === taskId);
      if (current?.status === 'completed') return state;
      return {
        tasks: patchTask(state.tasks, taskId, {
          status: cancelled ? 'cancelled' : 'failed',
          speed: 0,
          error: cancelled ? '已取消' : formatError(error),
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
            if (!current || current.status === 'cancelled' || current.status === 'completed' || current.status === 'failed') {
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
          set((state) => {
            const current = state.tasks.find((t) => t.id === payload.taskId);
            if (!current || current.status === 'cancelled') return state;
            return {
              tasks: patchTask(state.tasks, payload.taskId, {
                status: 'completed',
                progress: 100,
                downloaded: payload.total,
                total: payload.total,
                speed: 0,
                savedPath: payload.savedPath,
                error: undefined,
              }),
            };
          });
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
            (task.status === 'queued' || task.status === 'resolving' || task.status === 'downloading') &&
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
        if (!task) return;
        cancelledTaskIds.delete(taskId);
        set((state) => ({ tasks: state.tasks.filter((item) => item.id !== taskId) }));
        await get().addDownload(task.music, normalizeDownloadQuality(task.quality));
      },

      cancelTask: async (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) return;
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return;

        cancelledTaskIds.add(taskId);

        if (task.status === 'queued') {
          set((state) => ({
            tasks: patchTask(state.tasks, taskId, { status: 'cancelled', speed: 0, error: '已取消' }),
          }));
          cancelledTaskIds.delete(taskId);
          schedulePump(get, set);
          return;
        }

        set((state) => ({
          tasks: patchTask(state.tasks, taskId, { speed: 0, error: '正在取消…' }),
        }));
        try {
          await cancelDownloadTask(taskId);
        } catch {}
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
        tasks: state.tasks.map((task) => (
          task.status === 'downloading' || task.status === 'resolving' || task.status === 'queued'
            ? { ...task, status: 'failed' as const, speed: 0, error: '应用关闭，下载已中断' }
            : task
        )),
      }),
    },
  ),
);
