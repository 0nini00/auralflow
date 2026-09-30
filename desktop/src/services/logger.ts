/**
 * 桌面端运行日志。
 *
 * 一条日志走两路：`console.*`（开发期直接看）与 `@tauri-apps/plugin-log`（转给 Rust 侧的
 * tauri-plugin-log，落盘到 `app_log_dir()` 下的 `auralflow.log`，单文件 2 MiB 轮转、保留 3 份）。
 * Rust 侧 release 记 info 起，所以这里的 warn/error 一定进文件 —— 用户报「播放断了 /
 * 同步失败」时才有证据可查。
 *
 * 落盘失败一律静默：日志是诊断设施，不能反过来把业务搞崩（控制台里始终还有一份）。
 */

import {
  debug as logDebug,
  error as logError,
  info as logInfo,
  warn as logWarn,
} from "@tauri-apps/plugin-log";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** 插件 JS API 的四个级别，按 LogLevel 取用。 */
const fileWriters: Record<LogLevel, (message: string) => Promise<void>> = {
  debug: logDebug,
  info: logInfo,
  warn: logWarn,
  error: logError,
};

/** 把任意参数压成一行文本：Error 带栈、对象转 JSON，其余走 String()。 */
function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      // 循环引用等无法序列化的对象退回 String()
      return String(value);
    }
  }
  return String(value);
}

function write(level: LogLevel, args: unknown[]): void {
  switch (level) {
    case "debug":
      console.debug(...args);
      break;
    case "info":
      console.info(...args);
      break;
    case "warn":
      console.warn(...args);
      break;
    case "error":
      console.error(...args);
      break;
  }

  // IPC 是异步的：不 await，失败只静默（控制台那份已经输出了）。
  void fileWriters[level](args.map(formatArg).join(" ")).catch(() => undefined);
}

export const logger = {
  debug: (...args: unknown[]): void => write("debug", args),
  info: (...args: unknown[]): void => write("info", args),
  warn: (...args: unknown[]): void => write("warn", args),
  error: (...args: unknown[]): void => write("error", args),
};

/**
 * 全局兜底：未捕获异常与未处理的 Promise 拒绝都进日志。
 *
 * 用 addEventListener 而不是赋 `window.onerror`：不覆盖别处可能已经挂上的处理函数。
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (event) => {
    // 资源加载失败（img/script）不带 error 对象，位置信息是唯一线索。
    const detail = event.error ?? `${event.filename || "未知文件"}:${event.lineno}:${event.colno}`;
    logger.error("[未捕获异常]", event.message || "资源加载失败", detail);
  });
  window.addEventListener("unhandledrejection", (event) => {
    logger.error("[未处理的 Promise 拒绝]", event.reason);
  });
}
