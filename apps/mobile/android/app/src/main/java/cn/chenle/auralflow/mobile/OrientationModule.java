package cn.chenle.auralflow.mobile;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.util.Log;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;

import javax.annotation.Nonnull;

/**
 * MV 播放页的全屏方向控制。
 *
 * 语义与旧版(SCREEN_ORIENTATION_UNSPECIFIED 归还)的关键区别:
 * 进入全屏前先记录当前方向,退出全屏时恢复它而不是交给系统默认。
 * 原因:Activity 未锁方向时,若系统「自动旋转」已关闭,
 * setRequestedOrientation(UNSPECIFIED) 会让 Android 沿用当前(横屏)方向
 * → 整个 App 卡横屏无法退出。
 *
 * 记录的是进入全屏那一刻的方向:若系统自动旋转开启且用户竖持,记 PORTRAIT;
 * 若用户本来就横持进入(小窗横屏布局),记 LANDSCAPE,退出仍回横屏小窗 ——
 * 不臆断「视频必须竖屏」。
 */
public class OrientationModule extends ReactContextBaseJavaModule {
  private static final String TAG = "AuralFlowOrientation";

  /** 无记录(未进入过全屏 / 已恢复) */
  private static final int ORIENTATION_UNSET = -999;
  private int previousOrientation = ORIENTATION_UNSET;
  private final ReactApplicationContext reactContext;

  private final ActivityEventListener activityEventListener =
      new BaseActivityEventListener() {
        public void onActivityDestroyed(Activity activity) {
          // Activity 销毁时清掉保存值,避免下次进入全屏恢复成陈旧方向
          previousOrientation = ORIENTATION_UNSET;
        }
      };

  public OrientationModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
    reactContext.addActivityEventListener(activityEventListener);
  }

  @Override
  @Nonnull
  public String getName() {
    return "AuralFlowOrientation";
  }

  /** 进入(或退出)全屏横屏。 */
  @ReactMethod
  public void setLandscape(boolean enabled, Promise promise) {
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前无可用 Activity,方向操作未执行");
      return;
    }
    activity.runOnUiThread(() -> {
      try {
        if (enabled) {
          // 进入全屏前记住当前方向(仅首次;重复进入不覆盖原始值)
          if (previousOrientation == ORIENTATION_UNSET) {
            previousOrientation = resolveCurrentOrientation(activity);
          }
          activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } else {
          restoreOrientation(activity);
        }
        promise.resolve(true);
      } catch (Exception error) {
        promise.reject("ORIENTATION_ERROR", error);
      }
    });
  }

  /** 恢复进入全屏前的方向(供页面卸载时兜底调用;幂等)。 */
  @ReactMethod
  public void restoreOrientation(Promise promise) {
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前无可用 Activity,方向恢复未执行");
      return;
    }
    activity.runOnUiThread(() -> {
      try {
        restoreOrientation(activity);
        promise.resolve(true);
      } catch (Exception error) {
        promise.reject("ORIENTATION_ERROR", error);
      }
    });
  }

  /** 查询当前是否处于「已进入全屏」状态(供 JS 决定卸载时是否需要恢复)。 */
  @ReactMethod
  public void isFullscreen(Promise promise) {
    WritableMap result = Arguments.createMap();
    result.putBoolean("fullscreen", previousOrientation != ORIENTATION_UNSET);
    promise.resolve(result);
  }

  /** 把 Activity 当前请求方向换算成可恢复的稳定方向值。 */
  private int resolveCurrentOrientation(Activity activity) {
    int requested = activity.getRequestedOrientation();
    // 已显式锁定(任意非 UNSPECIFIED/USER 值)直接记录
    if (requested != ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        && requested != ActivityInfo.SCREEN_ORIENTATION_USER) {
      return requested;
    }
    // 未锁:按当前实际物理方向记录(自动旋转关闭时这也是用户期望的静止方向)
    int physical = activity.getResources().getConfiguration().orientation;
    if (physical == Configuration.ORIENTATION_LANDSCAPE) {
      // 用 SENSOR_LANDSCAPE 允许横屏两个朝向,比 LOCKED 更符合「自动旋转开启」的预期
      return ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
    }
    return ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
  }

  private void restoreOrientation(Activity activity) {
    int target = previousOrientation;
    previousOrientation = ORIENTATION_UNSET;
    if (target == ORIENTATION_UNSET) {
      // 无进入记录:按当前物理方向回退(防御,正常流程不会走到)
      int physical = activity.getResources().getConfiguration().orientation;
      target = physical == Configuration.ORIENTATION_LANDSCAPE
          ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
          : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
    }
    Log.d(TAG, "restore orientation -> " + target);
    activity.setRequestedOrientation(target);
  }
}
