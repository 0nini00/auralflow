import type { CustomSourceOperation } from "@/services/customSourceAccess";
import { customSourceAccess, customSourcePersistence, useCustomSourceStore } from "@/stores/customSourceStore";

/**
 * LX 自定义音源的访问门禁：「等恢复 → 判开关 → 取令牌」这一串只在这里写一遍。
 *
 * 不变量：
 * 1. 判定之前必须等持久化恢复完成。恢复前 featureEnabled 还是初始的 false，直接读会把
 *    「设置还没读到」当成「用户关掉了」，启动瞬间的播放/预取就会跳过 LX。
 * 2. 允许访问 ⇔ `customSourceAccess.isEnabled()`（featureReady && featureEnabled，由 store 注入）。
 *    调用方不单独读 featureEnabled。
 * 3. 允许访问时拿到的是令牌而不是布尔值：开关切换或脚本换代后令牌失效，后续每个异步
 *    边界用 `assertActive()` / `isActive()` 复查，而不是重新读一次开关。
 * 4. 已恢复时，令牌在「调用门禁的那个同步段」里取得，不能拖到下一个微任务：调用之后
 *    立刻 off→on 的话，这次操作必须属于旧生命周期并失效，而不是被新生命周期接纳。
 *    所以下面的函数不是 async（async 函数里 await 之后才取令牌就晚了一拍）。
 *
 * 两种调用方，区别是真实的，所以分开：
 * - `openCustomSourceAccess` / `snapshotCustomSourceAccess`：功能关着也得继续干活（内置源
 *   照常播放、预取、读缓存）。未启用时没有令牌，调用方之后遇到 LX 结果再用
 *   `requireCustomSourceOperation` 或 `canReuseCustomSourceResult` 处理。
 * - `requireCustomSourceAccess`：只为 LX 服务（自定义源后端、音源同步）。未启用直接以
 *   CustomSourceDisabledError 拒绝。
 */

export interface CustomSourceAccessSnapshot {
  /** 取快照时的代际。功能关着时也有值：没有令牌的调用方靠它发现「期间被打开或换代」。 */
  readonly version: number;
  /** 功能启用时的操作令牌；未启用为 undefined。 */
  readonly operation: CustomSourceOperation | undefined;
}

/** 已恢复：当场同步求值（抛错转成拒绝）；未恢复：等恢复完成后求值。 */
function whenHydrated<T>(read: () => T): Promise<T> {
  if (!useCustomSourceStore.getState().featureReady) return customSourcePersistence.ready.then(read);
  return new Promise<T>((resolve) => resolve(read()));
}

function takeSnapshot(): CustomSourceAccessSnapshot {
  return {
    version: customSourceAccess.version,
    operation: customSourceAccess.isEnabled() ? customSourceAccess.capture() : undefined,
  };
}

/** 代际与令牌在同一个同步点取得，二者才对得上。只有需要代际的调用方（预取）用它。 */
export function snapshotCustomSourceAccess(): Promise<CustomSourceAccessSnapshot> {
  return whenHydrated(takeSnapshot);
}

export function openCustomSourceAccess(): Promise<CustomSourceOperation | undefined> {
  return whenHydrated(() => takeSnapshot().operation);
}

export function requireCustomSourceAccess(): Promise<CustomSourceOperation> {
  return whenHydrated(() => customSourceAccess.capture());
}
