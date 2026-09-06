package cn.chenle.auralflow.mobile;

import android.app.Activity;
import android.content.pm.ActivityInfo;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * 运行时方向控制：MV 播放页的全屏按钮在竖屏与横屏之间切换。
 *
 * Manifest 未锁定方向（configChanges 已声明 orientation，旋转不会重建 Activity），
 * 关闭全屏时用 SCREEN_ORIENTATION_UNSPECIFIED 归还系统/清单默认行为，
 * 不在 App 级别引入新的方向锁定。
 */
public class OrientationModule extends ReactContextBaseJavaModule {

  public OrientationModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return "AuralFlowOrientation";
  }

  @ReactMethod
  public void setLandscape(boolean enabled, Promise promise) {
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.resolve(false);
      return;
    }
    activity.runOnUiThread(() -> {
      try {
        activity.setRequestedOrientation(enabled
            ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        promise.resolve(true);
      } catch (Exception error) {
        promise.reject("ORIENTATION_ERROR", error);
      }
    });
  }
}
