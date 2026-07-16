import type { MusicInfo } from "@lx/core";

export interface PlayerQueueItem {
  key: string;
  index: number;
  title: string;
  subtitle: string;
  isCurrent: boolean;
}

export interface PlayerQueueManagementItem {
  index: number;
  canRemove: boolean;
  removeLabel: string | null;
  statusLabel: string | null;
}

export interface PlayerQueueManagementModel {
  canClearQueue: boolean;
  clearLabel: string;
  items: PlayerQueueManagementItem[];
}

export interface ImmersiveQueuePanelModel {
  show: boolean;
  triggerLabel: string;
  title: string;
  closeLabel: string;
  summary: string;
  items: PlayerQueueItem[];
  management: PlayerQueueManagementModel;
}

export function buildPlayerQueueItems(queue: MusicInfo[], currentIndex: number): PlayerQueueItem[] {
  return queue.map((song, index) => ({
    key: `${song.source}:${song.id}:${index}`,
    index,
    title: song.name,
    subtitle: song.singer || "未知艺术家",
    isCurrent: index === currentIndex,
  }));
}

export function getPlayerQueueSummary(queue: MusicInfo[], currentIndex: number): string {
  if (queue.length === 0) return "播放队列为空";
  if (currentIndex >= 0 && currentIndex < queue.length) {
    return `正在播放第 ${currentIndex + 1} / ${queue.length} 首`;
  }
  return `共 ${queue.length} 首歌曲`;
}

export function shouldShowPlayerQueue(queue: MusicInfo[]): boolean {
  return queue.length > 0;
}

export function buildPlayerQueueManagementModel(queue: MusicInfo[], currentIndex: number): PlayerQueueManagementModel {
  return {
    canClearQueue: queue.length > 0,
    clearLabel: "清空",
    items: queue.map((_, index) => {
      const isCurrent = index === currentIndex;
      return {
        index,
        canRemove: !isCurrent,
        removeLabel: isCurrent ? null : "移除",
        statusLabel: isCurrent ? "播放中" : null,
      };
    }),
  };
}

export function buildImmersiveQueuePanelModel(queue: MusicInfo[], currentIndex: number): ImmersiveQueuePanelModel {
  return {
    show: shouldShowPlayerQueue(queue),
    triggerLabel: "播放列表",
    title: "播放列表",
    closeLabel: "关闭",
    summary: getPlayerQueueSummary(queue, currentIndex),
    items: buildPlayerQueueItems(queue, currentIndex),
    management: buildPlayerQueueManagementModel(queue, currentIndex),
  };
}
