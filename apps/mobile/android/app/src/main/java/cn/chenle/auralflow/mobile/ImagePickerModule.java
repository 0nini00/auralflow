package cn.chenle.auralflow.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * 从系统媒体库选择图片并拿到可长期访问的 content:// URI。
 *
 * ACTION_OPEN_DOCUMENT + takePersistableUriPermission 是官方推荐的做法，
 * 拿到的 URI 会被存到 AsyncStorage，重启后仍可读取图片。
 */
public class ImagePickerModule extends ReactContextBaseJavaModule {

  private static final int REQUEST_PICK_IMAGE = 43013;

  private Promise pendingPromise;

  private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
      if (requestCode != REQUEST_PICK_IMAGE) {
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
      try {
        int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
        int grantedFlags = data.getFlags() & flags;
        if (grantedFlags == 0) {
          grantedFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
        }
        ContentResolver resolver = getReactApplicationContext().getContentResolver();
        resolver.takePersistableUriPermission(uri, grantedFlags);
      } catch (Exception error) {
        // 有些相册应用不支持 persistable permission，忽略错误让 URI 短期可用。
      }
      promise.resolve(uri.toString());
    }
  };

  public ImagePickerModule(ReactApplicationContext reactContext) {
    super(reactContext);
    reactContext.addActivityEventListener(activityEventListener);
  }

  @Override
  public String getName() {
    return "ImagePickerModule";
  }

  @ReactMethod
  public void pickImage(Promise promise) {
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的 Android Activity");
      return;
    }

    if (pendingPromise != null) {
      promise.reject("PICKER_BUSY", "已有图片选择请求正在进行");
      return;
    }

    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("image/*");
    intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
    );

    pendingPromise = promise;
    try {
      activity.startActivityForResult(intent, REQUEST_PICK_IMAGE);
    } catch (Exception error) {
      pendingPromise = null;
      promise.reject("PICKER_LAUNCH_FAILED", error);
    }
  }

  @ReactMethod
  public void releaseImagePermission(String uriString, Promise promise) {
    try {
      Uri uri = Uri.parse(uriString);
      ContentResolver resolver = getReactApplicationContext().getContentResolver();
      resolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
      promise.resolve(true);
    } catch (Exception error) {
      promise.resolve(false);
    }
  }
}
