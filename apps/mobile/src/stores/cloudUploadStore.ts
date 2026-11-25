import { DeviceEventEmitter } from "react-native";
import { create } from "zustand";

import {
  CloudUploadCancelledError,
  cancelCloudUpload,
  uploadCloudAudio,
  type CloudAudioFile,
  type CloudUploadPhase,
} from "@/services/cloudUploadService";
import { logger } from "@/services/logger";
import { useCloudDriveStore } from "./cloudDriveStore";

export type CloudUploadTaskPhase =
  | "queued"
  | CloudUploadPhase
  | "cancelling"
  | "done"
  | "failed"
  | "cancelled";

export interface CloudUploadTask {
  id: string;
  fileName: string;
  title: string;
  size: number;
  phase: CloudUploadTaskPhase;
  loaded: number;
  total: number;
  error?: string;
}

interface CloudUploadState {
  tasks: CloudUploadTask[];
  running: boolean;
  upload: (files: CloudAudioFile[]) => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

interface CloudUploadProgressEvent {
  uploadId?: unknown;
  loaded?: unknown;
  total?: unknown;
}

const TERMINAL_PHASES: ReadonlySet<CloudUploadTaskPhase> = new Set([
  "done",
  "failed",
  "cancelled",
]);

export function isCloudUploadTaskTerminal(phase: CloudUploadTaskPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

function toNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 云盘上传队列。放在 store 而不是页面 state：大文件上传期间用户会离开云盘页，
 * 进度和取消能力不能随组件卸载一起消失。
 */
export const useCloudUploadStore = create<CloudUploadState>((set, get) => {
  let cancelRequested = false;
  let activeUploadId: string | null = null;

  const updateTask = (id: string, patch: Partial<CloudUploadTask>) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    }));
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
        phase: "queued",
        loaded: 0,
        total: file.size,
      }));
      cancelRequested = false;
      activeUploadId = null;
      set({ tasks, running: true });

      let uploaded = 0;
      try {
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const task = tasks[index];
          if (cancelRequested) {
            updateTask(task.id, { phase: "cancelled" });
            continue;
          }

          activeUploadId = task.id;
          try {
            await uploadCloudAudio(file, {
              uploadId: task.id,
              onPhase: (phase) => updateTask(task.id, { phase }),
              onProgress: (loaded, total) => updateTask(task.id, {
                phase: "uploading",
                loaded,
                total: total > 0 ? total : task.total,
              }),
              isCancelled: () => cancelRequested,
            });
            updateTask(task.id, {
              phase: "done",
              loaded: task.total,
              total: task.total,
            });
            uploaded += 1;
          } catch (error) {
            if (cancelRequested || error instanceof CloudUploadCancelledError) {
              updateTask(task.id, { phase: "cancelled" });
            } else {
              updateTask(task.id, { phase: "failed", error: errorMessage(error) });
            }
          } finally {
            activeUploadId = null;
          }
        }
      } finally {
        set({ running: false });
        if (uploaded > 0 && useCloudDriveStore.getState().accountUid) {
          await useCloudDriveStore.getState().refresh().catch((error) => {
            logger.warn("[cloud-upload] 上传完成后刷新云盘失败", error);
          });
        }
      }
    },

    cancel: () => {
      if (!get().running) return;
      cancelRequested = true;
      const uploadId = activeUploadId;
      if (!uploadId) return;
      updateTask(uploadId, { phase: "cancelling" });
      void cancelCloudUpload(uploadId).catch((error) => {
        logger.warn("[cloud-upload] 取消原生上传失败", error);
      });
    },

    clear: () => {
      if (get().running) return;
      set({ tasks: [] });
    },
  };
});

// 原生流式上传的进度事件；任务结束或页面卸载后到达的事件直接忽略。
DeviceEventEmitter.addListener("CloudUploadProgress", (event: CloudUploadProgressEvent) => {
  const uploadId = typeof event?.uploadId === "string" ? event.uploadId : "";
  if (!uploadId) return;
  const loaded = toNumber(event.loaded);
  const total = toNumber(event.total);
  useCloudUploadStore.setState((state) => ({
    tasks: state.tasks.map((task) => {
      if (task.id !== uploadId) return task;
      if (TERMINAL_PHASES.has(task.phase)) return task;
      return {
        ...task,
        loaded,
        total: total > 0 ? total : task.total,
      };
    }),
  }));
});
