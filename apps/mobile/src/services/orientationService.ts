import { NativeModules, Platform } from "react-native";

interface OrientationNativeModule {
  setLandscape(enabled: boolean): Promise<boolean>;
}

const orientationModule = NativeModules.AuralFlowOrientation as
  | OrientationNativeModule
  | undefined;

/**
 * 视频场景（MV 播放页）的全屏方向控制。
 *
 * enabled=true 强制传感器横屏（用户点「全屏」的显式意图，即使系统自动旋转已关
 * 也生效）；false 归还 SCREEN_ORIENTATION_UNSPECIFIED，即 Manifest 未锁方向时的
 * 系统默认行为，不在 App 级别引入新的方向锁定。失败静默：缺少方向能力只影响
 * 全屏切换，不应打断视频播放。
 */
export async function setLandscapePreferred(enabled: boolean): Promise<void> {
  if (Platform.OS !== "android" || !orientationModule?.setLandscape) return;
  try {
    await orientationModule.setLandscape(enabled);
  } catch {
    // 忽略：方向控制失败仅表现为「全屏按钮不旋转」
  }
}
