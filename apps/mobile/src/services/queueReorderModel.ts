import type { MusicInfo } from "@lx/core";
import type { PlaybackContext } from "@/stores/playerStore";

export type QueueReorderStatus = "reordered" | "unchanged" | "stale" | "invalid";

interface QueueReorderState {
  queue: MusicInfo[];
  currentIndex: number;
  shuffleHistory: number[];
  playedIndices: number[];
  playbackContext: PlaybackContext;
}

type QueueReorderResult =
  | { status: "reordered"; patch: QueueReorderState }
  | { status: Exclude<QueueReorderStatus, "reordered"> };

function isQueueIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

export function moveQueueItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function reorderQueueState(
  state: QueueReorderState,
  expectedQueue: readonly MusicInfo[],
  from: number,
  to: number,
): QueueReorderResult {
  // 数组引用是本次拖拽的版本凭据；同曲目重建的队列也不能被旧拖拽覆盖。
  if (state.queue !== expectedQueue) return { status: "stale" };
  const length = state.queue.length;
  const context = state.playbackContext;
  if (!isQueueIndex(from, length) || !isQueueIndex(to, length)) return { status: "invalid" };
  if (state.currentIndex !== -1 && !isQueueIndex(state.currentIndex, length)) return { status: "invalid" };
  if (![...state.shuffleHistory, ...state.playedIndices].every(index => isQueueIndex(index, length))) {
    return { status: "invalid" };
  }
  if (context.type !== "queue" && (
    context.currentBatch.length !== length ||
    context.currentBatch.some((song, index) => song !== state.queue[index]) ||
    !isQueueIndex(context.currentBatchIndex, length)
  )) return { status: "invalid" };
  if (from === to) return { status: "unchanged" };

  // 映射槽位而非歌曲 ID，同一歌曲甚至同一对象出现多次时仍保留播放身份。
  const remap = (index: number): number => {
    if (index === from) return to;
    if (from < to && index > from && index <= to) return index - 1;
    if (from > to && index >= to && index < from) return index + 1;
    return index;
  };
  const queue = moveQueueItem(state.queue, from, to);
  return {
    status: "reordered",
    patch: {
      queue,
      currentIndex: remap(state.currentIndex),
      shuffleHistory: state.shuffleHistory.map(remap),
      playedIndices: state.playedIndices.map(remap),
      playbackContext: context.type === "queue" ? context : {
        ...context,
        currentBatch: queue,
        currentBatchIndex: remap(context.currentBatchIndex),
      },
    },
  };
}

export const QUEUE_ROW_HEIGHT = 64;
const AUTO_SCROLL_EDGE = 56;
const AUTO_SCROLL_SPEED = 640;
const MAX_FRAME_MS = 32;

export function getQueueDropIndex(from: number, translation: number, startScroll: number, scroll: number, count: number): number {
  "worklet";
  return Math.max(0, Math.min(count - 1, from + Math.round((translation + scroll - startScroll) / QUEUE_ROW_HEIGHT)));
}

export function getQueueRowOffset(index: number, from: number, to: number): number {
  "worklet";
  if (from < 0) return 0;
  if (from < to && index > from && index <= to) return -QUEUE_ROW_HEIGHT;
  if (from > to && index >= to && index < from) return QUEUE_ROW_HEIGHT;
  return 0;
}

export function getQueueAutoScrollOffset(pointerY: number, height: number, offset: number, contentHeight: number, elapsedMs: number): number {
  "worklet";
  if (height <= 0) return offset;
  const edge = Math.min(AUTO_SCROLL_EDGE, height / 3);
  const direction = pointerY < edge ? -Math.min(1, (edge - pointerY) / edge)
    : pointerY > height - edge ? Math.min(1, (pointerY - height + edge) / edge) : 0;
  const delta = direction * AUTO_SCROLL_SPEED * Math.min(elapsedMs, MAX_FRAME_MS) / 1000;
  return Math.max(0, Math.min(Math.max(0, contentHeight - height), offset + delta));
}

export interface QueueEntry {
  key: number;
  song: MusicInfo;
}

export function buildQueueEntries(queue: readonly MusicInfo[], previous: readonly QueueEntry[] = []): QueueEntry[] {
  const occurrences = new Map<MusicInfo, { entries: QueueEntry[]; used: number }>();
  let nextKey = 0;
  for (const entry of previous) {
    nextKey = Math.max(nextKey, entry.key + 1);
    const group = occurrences.get(entry.song);
    if (group) group.entries.push(entry);
    else occurrences.set(entry.song, { entries: [entry], used: 0 });
  }
  return queue.map(song => {
    const group = occurrences.get(song);
    if (group && group.used < group.entries.length) return group.entries[group.used++];
    return { key: nextKey++, song };
  });
}

type CommitQueueReorder = (queue: readonly MusicInfo[], from: number, to: number) => QueueReorderStatus;

export function createQueueDragSession(commit: CommitQueueReorder) {
  let active: { id: number; queue: readonly MusicInfo[]; from: number } | null = null;
  return {
    start(id: number, queue: readonly MusicInfo[], from: number) { active = { id, queue, from }; },
    cancel() { active = null; },
    finish(id: number, to: number, successful: boolean): QueueReorderStatus | "cancelled" {
      if (!active || active.id !== id) return "cancelled";
      const baseline = active;
      active = null;
      if (!successful) return "cancelled";
      return commit(baseline.queue, baseline.from, to);
    },
  };
}


export const QUEUE_DRAG_HANDLE_WIDTH = 44;
// 按 SongItem 的封面/文字最小宽度和操作按钮预算，不挤压“更多操作”触摸区。
const MIN_ROW_WITH_COVER = 242;
const MIN_ROW_WITH_LIKE = 284;
const MIN_ROW_WITH_DURATION = 328;

export function resolveQueueRowPresentation(viewportWidth: number) {
  return {
    showCover: viewportWidth >= MIN_ROW_WITH_COVER,
    showLikeAction: viewportWidth >= MIN_ROW_WITH_LIKE,
    showDuration: viewportWidth >= MIN_ROW_WITH_DURATION,
  };
}
