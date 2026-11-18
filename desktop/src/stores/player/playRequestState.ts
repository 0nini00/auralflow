/**
 * 播放请求的代次与在途状态 —— 这四份模块级可变状态的唯一持有者。
 *
 * 它们放在一起，是因为 `invalidatePlayRequest` 必须把四份一并复位：只复位其中几份，
 * 就会留下「请求已作废但引擎仍在等旧目标」或「切歌已取消但连点队列还占着」的半截状态。
 * 其它模块只能经这里导出的函数读写，不各自再存一份。
 *
 * 叶子模块：不导入任何 store、播放引擎或其它 player/ 模块。
 */
import { applySwitchStepRequest, createSwitchStepQueueState, finishSwitchStep, type MusicInfo, type SwitchDirection } from "@lx/core";

interface InflightPlayRequest {
  id: number;
  key: string;
  promise: Promise<void>;
}

let activePlayRequestId = 0;
/**
 * 引擎当前“应当”播放的曲目 key。
 *
 * play() 解析播放地址期间，引擎还在推上一首的状态与进度；若直接落库会把刚写入的
 * loading / error 逐帧覆盖（解析失败时表现为「点了没反应」，且 didPlayFailForTarget
 * 判不出失败，队列索引不会回滚）。此时只放行目标曲目的推送，其余一律丢弃。
 * null 表示引擎状态可直通（没有待接管的目标）。
 */
let engineTargetKey: string | null = null;
// 切歌连点合并：切换进行中（解析/播放器加载）时重复点击只补跳一次，不重复解析。
let switchStepQueue = createSwitchStepQueueState();
let inflightPlayRequest: InflightPlayRequest | null = null;

export function buildPlayRequestKey(music: MusicInfo): string {
  const localUrl =
    'isLocal' in music && music.isLocal && 'url' in music && music.url
      ? String(music.url)
      : "";
  return `${music.source}:${music.id}:${localUrl}`;
}

/** 开启新一代播放请求，并把它的曲目登记为引擎应当接管的目标；返回本次请求的代次。 */
export function beginPlayRequest(requestKey: string): number {
  const requestId = activePlayRequestId + 1;
  activePlayRequestId = requestId;
  // 从这一行到引擎真正加载本曲目之前，引擎推来的状态都属于上一首：全部屏蔽。
  engineTargetKey = requestKey;
  return requestId;
}

/** 请求代次检查点：false 表示本请求已被更新的请求或 invalidatePlayRequest 取代。 */
export function isActivePlayRequest(requestId: number): boolean {
  return requestId === activePlayRequestId;
}

export function getInflightPlayRequest(): InflightPlayRequest | null {
  return inflightPlayRequest;
}

export function registerInflightPlayRequest(request: InflightPlayRequest): void {
  inflightPlayRequest = request;
}

/** 只在在途请求仍是自己时清除，不误清后来者。 */
export function releaseInflightPlayRequest(requestId: number): void {
  if (inflightPlayRequest?.id === requestId) {
    inflightPlayRequest = null;
  }
}

export function getEngineTargetKey(): string | null {
  return engineTargetKey;
}

export function setEngineTargetKey(key: string | null): void {
  engineTargetKey = key;
}

export function invalidatePlayRequest(): void {
  activePlayRequestId += 1;
  inflightPlayRequest = null;
  engineTargetKey = null;
  switchStepQueue = createSwitchStepQueueState();
}

/** 登记一次切歌请求；返回 false 表示切换进行中，本次只记为补跳。 */
export function requestSwitchStep(direction: SwitchDirection): boolean {
  const step = applySwitchStepRequest(switchStepQueue, direction);
  switchStepQueue = step.nextState;
  return step.startNow;
}

/** 当前切换结束：复位连点队列，并交出期间积下的补跳（至多一次）。 */
export function finishQueuedSwitchStep(): { shouldStep: boolean; direction?: SwitchDirection } {
  const finished = finishSwitchStep(switchStepQueue);
  switchStepQueue = finished.nextState;
  return finished;
}
