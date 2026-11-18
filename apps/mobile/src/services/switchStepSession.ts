import { createSwitchStepQueueState, type SwitchStepQueueState } from "@lx/core";
import { beginPlaybackRequest } from "./playbackRequest";

/**
 * next/prev 的切歌串行化会话。
 *
 * 原生 add/skip 未返回时并发再发起一次切歌，会把原生队列的写入顺序打乱
 * （后台/锁屏「下一首」与手动点击可能同时到达），所以这期间的 next/prev 请求
 * 合并成一次「补跳」：等当前切换收尾后再跳一步，总共仍然是两首。
 *
 * 会话与播放请求代次同属「播放意图」这一层，位于 playerStore 之下：
 * 暂停 / 停止 / 清空队列这类 transport 命令由 store 发起，它们必须能丢弃尚未消费的连点，
 * 而导航编排（playerService）在 store 之上。会话放在这里，两边都只向下依赖。
 */
export interface SwitchStepSession {
  state: SwitchStepQueueState;
  /** 本次切换认领的播放请求；null 表示当前没有切换在途。 */
  intent: number | null;
}

function createSwitchStepSession(): SwitchStepSession {
  return { state: createSwitchStepQueueState(), intent: null };
}

let currentSession = createSwitchStepSession();

export function getSwitchStepSession(): SwitchStepSession {
  return currentSession;
}

/** 换一个新会话：旧会话里在途的切换收尾时会发现自己已不是当前会话，不再补跳。 */
export function resetSwitchStepSession(): void {
  currentSession = createSwitchStepSession();
}

/** 清空队列时一并丢弃旧会话中尚未消费的连点，避免补跳推进新队列。 */
export function cancelPendingPlayback(): number {
  resetSwitchStepSession();
  return beginPlaybackRequest();
}
