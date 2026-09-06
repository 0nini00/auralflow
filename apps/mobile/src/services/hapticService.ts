import { Vibration, Platform } from "react-native";

/**
 * 全 app 统一触觉反馈。
 * Android 用 Vibration API（必须声明 android.permission.VIBRATE，否则 vibrate()
 * 抛 SecurityException 闪退——manifest 已声明，此处再兜一层 try/catch，
 * 个别 ROM 权限异常时宁可没有震动也不能崩）；iOS 暂无 expo-modules 依赖时跳过
 * （Vibration.vibrate 在 iOS 是 400ms 长震，不适合 tick）。
 */
const isAndroid = Platform.OS === "android";

function vibrateSafe(pattern: number | number[]): void {
  if (!isAndroid) return;
  try {
    Vibration.vibrate(pattern);
  } catch {
    // 震动失败静默：触觉反馈缺失无感知，异常不应影响播放交互
  }
}

/** 轻触反馈：切歌、上一首/下一首、长按弹出菜单 */
export function hapticLight(): void {
  vibrateSafe(8);
}

/** 成功/完成反馈：下载完成、收藏成功 */
export function hapticSuccess(): void {
  vibrateSafe([0, 12, 40, 16]);
}

/** 警告反馈：拖拽排序到位、进入选择模式 */
export function hapticWarning(): void {
  vibrateSafe(18);
}

/** 重操作反馈：删除文件等不可逆操作 */
export function hapticHeavy(): void {
  vibrateSafe(24);
}
