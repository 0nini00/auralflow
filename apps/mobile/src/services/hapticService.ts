import { Vibration, Platform } from "react-native";

/**
 * 全 app 统一触觉反馈。
 * Android 用 Vibration API（无需额外权限，10ms 属于 tick 级反馈，不打扰）；
 * iOS 暂无 expo-modules 依赖时跳过（Vibration.vibrate 在 iOS 是 400ms 长震，不适合 tick）。
 */
const isAndroid = Platform.OS === "android";

/** 轻触反馈：切歌、上一首/下一首、长按弹出菜单 */
export function hapticLight(): void {
  if (!isAndroid) return;
  Vibration.vibrate(8);
}

/** 成功/完成反馈：下载完成、收藏成功 */
export function hapticSuccess(): void {
  if (!isAndroid) return;
  Vibration.vibrate([0, 12, 40, 16]);
}

/** 警告反馈：拖拽排序到位、进入选择模式 */
export function hapticWarning(): void {
  if (!isAndroid) return;
  Vibration.vibrate(18);
}

/** 重操作反馈：删除文件等不可逆操作 */
export function hapticHeavy(): void {
  if (!isAndroid) return;
  Vibration.vibrate(24);
}
