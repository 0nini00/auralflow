/**
 * 给 Promise 加超时。超时以 `${label}超时（Nms）` 拒绝；原任务的成败原样透传。
 *
 * 此前 hiddenFallbackService 与 desktopLyricToggle 各有一份实现（错误文案不同、
 * 后者还带「环境没有定时器就直通」的兼容分支），语义一致却靠复制维持。
 */
export function withTimeout<T>(task: Promise<T>, timeoutMs: number, label = "操作"): Promise<T> {
  // 桌面歌词窗等非标准环境可能没有定时器：直通等待，不伪装超时
  if (typeof globalThis.setTimeout !== "function" || typeof globalThis.clearTimeout !== "function") {
    return task;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(`${label}超时（${timeoutMs}ms）`)), timeoutMs);
    task.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
