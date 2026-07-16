package cn.chenle.auralflow.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class CustomSourceFilePickerModule extends ReactContextBaseJavaModule {

  private static final int REQUEST_PICK_CUSTOM_SOURCE_SCRIPT = 43012;

  private Promise pendingPromise;

  private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
      if (requestCode != REQUEST_PICK_CUSTOM_SOURCE_SCRIPT) {
        return;
      }

      Promise promise = pendingPromise;
      pendingPromise = null;
      if (promise == null) {
        return;
      }

      if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
        promise.resolve(null);
        return;
      }

      Uri uri = data.getData();
      promise.resolve(uri.toString());
    }
  };

  public CustomSourceFilePickerModule(ReactApplicationContext reactContext) {
    super(reactContext);
    reactContext.addActivityEventListener(activityEventListener);
  }

  @Override
  public String getName() {
    return "CustomSourceFilePickerModule";
  }

  @ReactMethod
  public void pickCustomSourceScriptFile(Promise promise) {
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的 Android Activity");
      return;
    }

    if (pendingPromise != null) {
      promise.reject("PICKER_BUSY", "已有文件选择请求正在进行");
      return;
    }

    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("*/*");
    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
      "application/javascript",
      "application/x-javascript",
      "text/javascript",
      "text/plain",
      "application/json",
      "application/octet-stream",
    });
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

    pendingPromise = promise;
    try {
      activity.startActivityForResult(intent, REQUEST_PICK_CUSTOM_SOURCE_SCRIPT);
    } catch (Exception error) {
      pendingPromise = null;
      promise.reject("PICKER_LAUNCH_FAILED", error);
    }
  }
}
