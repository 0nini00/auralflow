import { NativeModules, Platform } from "react-native";

interface OrientationNativeModule {
  /** 进入(true)/退出(false)全屏横屏。resolve(true)=已执行;reject=未执行/失败。 */
  setLandscape(enabled: boolean): Promise<boolean>;
  /** 恢复进入全屏前的方向(幂等)。 */
  restoreOrientation(): Promise<boolean>;
  /** 查询当前是否处于「已进入全屏」状态。 */
  isFullscreen(): Promise<{ fullscreen: boolean }>;
}

const orientationModule = NativeModules.AuralFlowOrientation as
  | OrientationNativeModule
  | undefined;

/**
 * 视频场景(MV 播放页)的全屏方向控制。
 *
 * enabled=true 强制传感器横屏(用户点「全屏」的显式意图,即使系统自动旋转已关
 * 也生效);false 恢复进入全屏前记录的方向(而非旧版直接归还 UNSPECIFIED——
 * 系统自动旋转关闭时 UNSPECIFIED 会让整个 App 卡在当前横屏)。
 *
 * 返回 true 表示已执行(进入全屏的已锁横屏 / 退出的已恢复原方向),false 表示
 * 平台不支持(非 Android / 原生模块缺失),reject 表示执行失败(如无 Activity)。
 * 失败不静默:调用方(MV 页)需要据此决定是否重试/提示。
 */
export async function setLandscapePreferred(enabled: boolean): Promise<boolean> {
  if (Platform.OS !== "android" || !orientationModule?.setLandscape) return false;
  await orientationModule.setLandscape(enabled);
  return true;
}

/** 恢复进入全屏前的方向(页面卸载兜底;幂等,未进入过全屏是 no-op)。 */
export async function restoreOrientationPreference(): Promise<boolean> {
  if (Platform.OS !== "android" || !orientationModule?.restoreOrientation) return false;
  await orientationModule.restoreOrientation();
  return true;
}

/** 查询当前是否处于「已进入全屏」状态。 */
export async function isFullscreenActive(): Promise<boolean> {
  if (Platform.OS !== "android" || !orientationModule?.isFullscreen) return false;
  const result = await orientationModule.isFullscreen();
  return result?.fullscreen ?? false;
}
