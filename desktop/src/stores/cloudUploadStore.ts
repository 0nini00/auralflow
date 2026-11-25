import { create } from 'zustand';
import {
  TAURI_EVENTS,
  cancelCloudUpload,
  listenTauriEvent,
} from '@lx/tauri-bridge';
import {
  CloudUploadCancelledError,
  uploadCloudAudio,
  type CloudUploadPhase,
  type DesktopCloudAudioFile,
} from '@/services/cloudUploadService';
import { logger } from '@/services/logger';
import { useCloudDriveStore } from './cloudDriveStore';

export type CloudUploadTaskPhase =
  | 'queued'
  | CloudUploadPhase
  | 'cancelling'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface CloudUploadTask {
  id: string;
  fileName: string;
  title: string;
  size: number;
  phase: CloudUploadTaskPhase;
  uploaded: number;
  total: number;
  error?: string;
}

interface CloudUploadState {
  tasks: CloudUploadTask[];
  running: boolean;
  upload: (files: DesktopCloudAudioFile[]) => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

const TERMINAL_PHASES: ReadonlySet<CloudUploadTaskPhase> = new Set([
  'done',
  'failed',
  'cancelled',
]);

export function isCloudUploadTaskTerminal(phase: CloudUploadTaskPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

function toNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 桌面端云盘上传队列。放在 store 而不是页面 state：大文件上传期间用户可以切到
 * 其他页面，进度和取消能力不能随 CloudDriveView 卸载一起消失。
 */
export const useCloudUploadStore = create<CloudUploadState>((set, get) => {
  let cancelRequested = false;
  let activeTaskId: string | null = null;
  let progressUnlisten: (() => void) | null = null;

  const updateTask = (id: string, patch: Partial<CloudUploadTask>) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    }));
  };

  const ensureProgressListener = async () => {
    if (progressUnlisten) return;
    try {
      progressUnlisten = await listenTauriEvent(TAURI_EVENTS.cloudUploadProgress, (payload) => {
        const uploaded = toNumber(payload.uploaded);
        const total = toNumber(payload.total);
        set((state) => ({
          tasks: state.tasks.map((task) => {
            if (task.id !== payload.taskId || TERMINAL_PHASES.has(task.phase)) return task;
            return {
              ...task,
              uploaded,
              total: total > 0 ? total : task.total,
            };
          }),
        }));
      });
    } catch (error) {
      logger.warn('[cloud-upload] 订阅上传进度失败', error);
    }
  };

  return {
    tasks: [],
    running: false,

    upload: async (files) => {
      if (get().running || files.length === 0) return;

      const runId = Date.now().toString(36);
      const tasks: CloudUploadTask[] = files.map((file, index) => ({
        id: `${runId}-${index}`,
        fileName: file.fileName,
        title: file.title,
        size: file.size,
        phase: 'queued',
        uploaded: 0,
        total: file.size,
      }));
      cancelRequested = false;
      activeTaskId = null;
      set({ tasks, running: true });
      await ensureProgressListener();

      let uploaded = 0;
      try {
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const task = tasks[index];
          if (cancelRequested) {
            updateTask(task.id, { phase: 'cancelled' });
            continue;
          }

          activeTaskId = task.id;
          try {
            await uploadCloudAudio(file, {
              taskId: task.id,
              onPhase: (phase) => updateTask(task.id, { phase }),
              isCancelled: () => cancelRequested,
            });
            updateTask(task.id, { phase: 'done', uploaded: task.total, total: task.total });
            uploaded += 1;
          } catch (error) {
            if (cancelRequested || error instanceof CloudUploadCancelledError) {
              updateTask(task.id, { phase: 'cancelled' });
            } else {
              updateTask(task.id, { phase: 'failed', error: errorMessage(error) });
            }
          } finally {
            activeTaskId = null;
          }
        }
      } finally {
        set({ running: false });
        if (uploaded > 0 && useCloudDriveStore.getState().accountUid) {
          await useCloudDriveStore.getState().refresh().catch((error) => {
            logger.warn('[cloud-upload] 上传完成后刷新云盘失败', error);
          });
        }
      }
    },

    cancel: () => {
      if (!get().running) return;
      cancelRequested = true;
      const taskId = activeTaskId;
      if (!taskId) return;
      updateTask(taskId, { phase: 'cancelling' });
      void cancelCloudUpload(taskId).catch((error) => {
        logger.warn('[cloud-upload] 取消原生上传失败', error);
      });
    },

    clear: () => {
      if (get().running) return;
      set({ tasks: [] });
    },
  };
});
