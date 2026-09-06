import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Release 构建的全局 JS 异常取证器。
 *
 * release 包里 JS 线程的未捕获异常（含 reanimated 回传的 worklet 异常）会直接
 * 闪退不留痕。这里在默认 handler 之前把 message + stack 落到 AsyncStorage，
 * 下次启动时由启动屏展示（consumeLastJSError），让用户无需连接电脑即可提供堆栈。
 */

const KEY = "auralflow.mobile.lastJSError";

interface CapturedError {
  message: string;
  stack: string;
  isFatal: boolean;
  at: number;
}

export function installGlobalErrorCapture(): void {
  const errorUtils = (globalThis as any).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;

  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const captured: CapturedError = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? "") : "",
      isFatal: isFatal !== false,
      at: Date.now(),
    };
    void AsyncStorage.setItem(KEY, JSON.stringify(captured)).catch(() => undefined);
    // 继续交给默认 handler，保持 RN 原有的崩溃/上报行为
    if (previous) previous(error, isFatal);
  });
}

/** 读取并清除上次崩溃记录（存在则返回可直接展示的文本）。 */
export async function consumeLastJSError(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as CapturedError;
    const stack = (parsed.stack ?? "").slice(0, 1200);
    return [parsed.message, stack].filter(Boolean).join("\n\n") || null;
  } catch {
    return null;
  }
}
