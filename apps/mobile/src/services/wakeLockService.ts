import { NativeModules, Platform } from "react-native";

interface NativeWakeLockModule {
  acquire(timeoutMs: number): Promise<boolean>;
  release(): Promise<boolean>;
}

const nativeModule = (NativeModules as Record<string, unknown>).WakeLockModule as
  | NativeWakeLockModule
  | undefined;

/**
 * 在后台切歌、网络解析与缓冲过渡阶段持有临时 WakeLock（默认最长 20s）。
 * 避免屏幕关闭时 Android CPU 深度休眠挂起网络和 JS 进程。
 */
export async function acquirePlaybackWakeLock(timeoutMs = 20_000): Promise<void> {
  if (Platform.OS !== "android" || !nativeModule) return;
  try {
    await nativeModule.acquire(timeoutMs);
  } catch {}
}

/**
 * 释放过渡期的 WakeLock（新歌曲开始播放后调用）。
 */
export async function releasePlaybackWakeLock(): Promise<void> {
  if (Platform.OS !== "android" || !nativeModule) return;
  try {
    await nativeModule.release();
  } catch {}
}
