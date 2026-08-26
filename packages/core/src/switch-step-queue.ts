/**
 * 切歌连点合并状态机（双端共用）。
 *
 * 切换进行中（网络解析 + 播放器加载）时，用户再点下一首/上一首如果每次都重新
 * 发起一次完整解析，旧解析被新意图丢弃浪费，且中间无任何反馈——表现为「点了
 * 没反应 / 卡顿」。本模型把切换中的重复点击合并为一次「补跳」，当前切换完成后
 * 自动再跳一步，避免重复解析与无反馈等待。
 */
export type SwitchDirection = "next" | "prev";

export interface SwitchStepQueueState {
  /** 是否正在切换（解析/播放器加载进行中） */
  switching: boolean;
  /** 切换期间收到的补跳方向；null 表示没有补跳 */
  pendingStep: SwitchDirection | null;
}

export function createSwitchStepQueueState(): SwitchStepQueueState {
  return { switching: false, pendingStep: null };
}

/**
 * 收到一次切歌请求：空闲时立即开始；切换中则只更新补跳方向（保留最新），
 * 不重复发起解析。返回是否应立刻启动切换。
 */
export function applySwitchStepRequest(
  state: SwitchStepQueueState,
  direction: SwitchDirection,
): { nextState: SwitchStepQueueState; startNow: boolean } {
  if (state.switching) {
    return {
      nextState: { switching: true, pendingStep: direction },
      startNow: false,
    };
  }
  return {
    nextState: { switching: true, pendingStep: null },
    startNow: true,
  };
}

/**
 * 当前切换结束（无论成败）：若切换期间有补跳请求则返回应再跳的方向，
 * 并把状态复位为空闲。
 */
export function finishSwitchStep(state: SwitchStepQueueState): {
  nextState: SwitchStepQueueState;
  shouldStep: boolean;
  direction?: SwitchDirection;
} {
  const shouldStep = state.pendingStep != null;
  return {
    nextState: { switching: false, pendingStep: null },
    shouldStep,
    direction: shouldStep ? (state.pendingStep as SwitchDirection) : undefined,
  };
}
