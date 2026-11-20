import { PLAYBACK_RESOLVE_TOTAL_BUDGET_MS } from "@lx/core";
import { beginPlaybackRequest, isCurrentPlaybackRequest, subscribePlaybackRequest } from "./playbackRequest";

/** 与桌面端共用同一个总预算，避免同一脚本在两端出现「桌面能播、移动端超时」。 */
export const PLAYBACK_RESOLUTION_BUDGET_MS = PLAYBACK_RESOLVE_TOTAL_BUDGET_MS;
let activeResolutionRequest: number | null = null;

export class PlaybackRequestSupersededError extends Error {
  constructor() {
    super("播放请求已被新的操作替代");
    this.name = "PlaybackRequestSupersededError";
  }
}

/** 手动媒体按键可抢占解析，但不与正在提交的原生队列操作交错。 */
export function interruptPlaybackResolution(): boolean {
  if (activeResolutionRequest === null || !isCurrentPlaybackRequest(activeResolutionRequest)) return false;
  beginPlaybackRequest();
  return true;
}

/** 预算覆盖整个异步解析流程，包括预读等待与跨源候选；预读不持有播放意图。 */
export function runPlaybackResolution<T>(resolve: (signal: AbortSignal) => Promise<T>, requestId?: number, parentSignal?: AbortSignal, deadlineAt = Date.now() + PLAYBACK_RESOLUTION_BUDGET_MS): Promise<T> {
  if (requestId !== undefined && !isCurrentPlaybackRequest(requestId)) return Promise.reject(new PlaybackRequestSupersededError());
  if (requestId !== undefined) activeResolutionRequest = requestId;
  return new Promise<T>((fulfill, reject) => {
    const controller = new AbortController();
    let settled = false;
    let unsubscribe = () => {};
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      parentSignal?.removeEventListener("abort", abort);
      controller.abort();
      if (requestId !== undefined && activeResolutionRequest === requestId) activeResolutionRequest = null;
      action();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`播放地址解析超时（${PLAYBACK_RESOLUTION_BUDGET_MS / 1000} 秒），可重试或切换歌曲`))),
      Math.max(0, deadlineAt - Date.now()),
    );
    const abort = () => finish(() => reject(new PlaybackRequestSupersededError()));
    if (parentSignal?.aborted) abort();
    else parentSignal?.addEventListener("abort", abort, { once: true });
    if (requestId !== undefined && !settled) {
      unsubscribe = subscribePlaybackRequest(() => {
        if (!isCurrentPlaybackRequest(requestId)) finish(() => reject(new PlaybackRequestSupersededError()));
      });
    }
    Promise.resolve().then(() => {
      if (settled) throw new PlaybackRequestSupersededError();
      return resolve(controller.signal);
    }).then(
      result => finish(() => fulfill(result)),
      error => finish(() => reject(error)),
    );
  });
}
