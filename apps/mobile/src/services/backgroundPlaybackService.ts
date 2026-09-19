import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, AppState, NativeModules, Platform } from "react-native";
import { checkNotifications, requestNotifications } from "react-native-permissions";

interface BatteryOptimizationNativeModule {
  isIgnoringBatteryOptimization(): Promise<boolean>;
  requestIgnoreBatteryOptimization(): Promise<boolean>;
}

const nativeModule = (NativeModules as Record<string, unknown>).BatteryOptimizationModule as
  | BatteryOptimizationNativeModule
  | undefined;

/** 「不再提示」标记：用户明确拒绝后不再打扰（可在设置页手动重新申请）。 */
const PROMPT_DISMISSED_KEY = "auralflow.mobile.backgroundPlaybackPromptDismissed";

/**
 * 是否已在「忽略电池优化」白名单中。
 *
 * 非 Android 或原生模块缺失时一律返回 true —— 宁可少提示，也不要弹一个无法消除的框。
 */
export async function isIgnoringBatteryOptimization(): Promise<boolean> {
  if (Platform.OS !== "android" || !nativeModule) return true;
  try {
    return await nativeModule.isIgnoringBatteryOptimization();
  } catch {
    return true;
  }
}

/**
 * 拉起系统白名单授权页，并在用户返回应用后重新查询真实结果。
 *
 * 系统页面只是一个开关，用户可能直接返回而不授权，所以必须等回到前台再复查，
 * 不能把「页面已打开」当成「已授权」。
 */
export async function requestIgnoreBatteryOptimization(): Promise<boolean> {
  if (Platform.OS !== "android" || !nativeModule) return true;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      subscription.remove();
      resolve(value);
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // 系统页面刚关闭时权限状态可能还没落定，稍等一拍再查
      setTimeout(() => {
        void isIgnoringBatteryOptimization().then(finish);
      }, 800);
    });
    nativeModule
      .requestIgnoreBatteryOptimization()
      .then((opened) => {
        // 系统页面没能打开：没有后续 AppState 回调，直接给结果免得 Promise 悬挂
        if (!opened) finish(false);
      })
      .catch(() => finish(false));
  });
}

/** 是否已被用户标记「不再提示」。 */
export async function isBackgroundPlaybackPromptDismissed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMPT_DISMISSED_KEY)) === "1";
  } catch {
    return false;
  }
}

/** 记录「不再提示」。 */
export async function dismissBackgroundPlaybackPrompt(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPT_DISMISSED_KEY, "1");
  } catch {
    // 落盘失败只影响下次是否重复提示，不影响播放，静默忽略
  }
}

/** 清除「不再提示」标记，使提示重新出现（设置页「重新检查」用）。 */
export async function resetBackgroundPlaybackPrompt(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PROMPT_DISMISSED_KEY);
  } catch {
    // 同上：失败仅导致提示不出现，静默忽略
  }
}

/**
 * 主动申请通知权限。
 *
 * Android 13+ 未授予通知权限时，react-native-track-player 的前台服务通知不可见。
 * 通知不可见除了让用户失去锁屏/通知栏的控制入口，部分国产 ROM 还会因
 * 「前台服务没有可见通知」而降低进程优先级，进一步加剧后台被冻结。
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const current = await checkNotifications();
    if (current.status === "granted") return true;
    const next = await requestNotifications(["alert", "sound"]);
    return next.status === "granted";
  } catch {
    return false;
  }
}

/**
 * 播放开始前检查后台运行权限，未放行时提示用户加入白名单。
 *
 * 只在用户真正开始播放后调用（而不是冷启动就弹），此时「后台播放」的诉求最明确，
 * 用户更容易理解为什么要授权。
 */
export async function checkBackgroundPlaybackReadiness(): Promise<void> {
  if (Platform.OS !== "android") return;
  await ensureNotificationPermission();
  if (await isBackgroundPlaybackPromptDismissed()) return;
  if (await isIgnoringBatteryOptimization()) return;

  await new Promise<void>((resolve) => {
    Alert.alert(
      "后台播放权限提醒",
      "AuralFlow 未加入系统的「忽略电池优化」白名单，退到后台后可能被系统冻结，出现播放一两首就停止、需要回到应用才能继续的情况。建议加入白名单以保证连续播放。",
      [
        {
          text: "不再提示",
          onPress: () => {
            void dismissBackgroundPlaybackPrompt();
            resolve();
          },
        },
        { text: "暂不设置", onPress: () => resolve() },
        {
          text: "去设置",
          onPress: () => {
            void requestIgnoreBatteryOptimization().then(() => resolve());
          },
        },
      ],
      { cancelable: false },
    );
  });
}
