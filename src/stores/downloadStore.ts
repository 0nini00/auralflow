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
} from '@/services/downloadService';

export type DownloadStatus = 'resolving' | 'downloading' | 'completed' | 'failed';
export type { DownloadQuality };

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
  clearCompleted: () => void;
  toLocalMusic: (task: DownloadTask) => MusicInfo | null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
          set((state) => ({
            tasks: patchTask(state.tasks, payload.taskId, {
              status: 'downloading',
              progress: payload.progress,
              downloaded: payload.downloaded,
              total: payload.total ?? undefined,
              speed: payload.speed,
            }),
          }));
        });

        await listen<RustDownloadCompletedEvent>('download-completed', (event) => {
          const payload = event.payload;
          set((state) => ({
            tasks: patchTask(state.tasks, payload.taskId, {
              status: 'completed',
              progress: 100,
              downloaded: payload.total,
              total: payload.total,
              speed: 0,
              savedPath: payload.savedPath,
              error: undefined,
            }),
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
            task.status !== 'failed' &&
            (!quality || task.quality === quality)
          ),
        );
        if (existing) return;

        const taskId = buildDownloadTaskId(music);
        const now = Date.now();
        const task: DownloadTask = {
          id: taskId,
          music,
          status: 'resolving',
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

        try {
          const prepared = await prepareDownload(music, quality);
          set((state) => ({
            tasks: patchTask(state.tasks, taskId, {
              status: 'downloading',
              fileName: prepared.fileName,
              quality: prepared.quality,
            }),
          }));

          // 启动下载；进度和完成状态由 download-progress / download-completed 事件驱动更新
          const savedPath = await runDownloadTask(taskId, prepared.url, directory, prepared.fileName);
          await enhanceDownloadedFile(music, savedPath, directory, prepared.fileName);
        } catch (error) {
          set((state) => ({
            tasks: patchTask(state.tasks, taskId, {
              status: 'failed',
              speed: 0,
              error: formatError(error),
            }),
          }));
        }
      },

      retryTask: async (taskId) => {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) return;
        set((state) => ({ tasks: state.tasks.filter((item) => item.id !== taskId) }));
        await get().addDownload(task.music, normalizeDownloadQuality(task.quality));
      },

      removeTask: (taskId) => {
        set((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) }));
      },

      clearCompleted: () => {
        set((state) => ({ tasks: state.tasks.filter((task) => task.status !== 'completed') }));
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
          task.status === 'downloading' || task.status === 'resolving'
            ? { ...task, status: 'failed' as const, speed: 0, error: '应用关闭，下载已中断' }
            : task
        )),
      }),
    },
  ),
);
