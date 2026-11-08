package cn.chenle.auralflow.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.net.URI;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

public class CustomSourceFilePickerModule extends ReactContextBaseJavaModule {

  private static final int REQUEST_PICK_CUSTOM_SOURCE_SCRIPT = 43012;

  private Promise pendingPromise;
  private final ExecutorService fileInfoExecutor = Executors.newSingleThreadExecutor();

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
      try {
        ContentResolver resolver = getReactApplicationContext().getContentResolver();
        resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
      } catch (Exception ignored) {
        // 部分文档提供方不支持 persistable permission，忽略后短期 URI 仍可用。
      }
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

  /** 外部文档 URI 常不带扩展名，读取提供方元数据后再交给 JS 判断文件用途。 */
  @ReactMethod
  public void getFileInfo(String uriString, Promise promise) {
    Activity activity = getCurrentActivity();
    Intent intent = activity == null ? null : activity.getIntent();
    String intentMime = intent != null && intent.getData() != null
        && intent.getData().toString().equals(uriString) ? intent.getType() : null;
    try {
      fileInfoExecutor.execute(() -> {
        try {
          promise.resolve(readFileInfo(uriString, intentMime));
        } catch (Exception error) {
          promise.reject("FILE_INFO_FAILED", error);
        }
      });
    } catch (RejectedExecutionException error) {
      promise.reject("FILE_INFO_FAILED", error);
    }
  }

  private WritableMap readFileInfo(String uriString, String intentMime) throws Exception {
    if (uriString == null) throw new IllegalArgumentException("文件 URI 不能为空");
    URI parsed = new URI(uriString);
    String scheme = parsed.getScheme();
    if ((!"file".equals(scheme) && !"content".equals(scheme)) || parsed.isOpaque()
        || parsed.getFragment() != null || parsed.getPath() == null || parsed.getPath().isEmpty()) {
      throw new IllegalArgumentException("仅支持 file:// 或 content:// 文件 URI");
    }
    String fileName = null;
    String mimeType = null;
    if ("file".equals(scheme)) {
      fileName = new File(parsed).getName();
    } else {
      if (parsed.getAuthority() == null || parsed.getAuthority().isEmpty()) {
        throw new IllegalArgumentException("content URI 缺少提供方");
      }
      Uri uri = Uri.parse(parsed.toString());
      ContentResolver resolver = getReactApplicationContext().getContentResolver();
      mimeType = resolver.getType(uri);
      try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME },
          null, null, null)) {
        if (cursor != null && cursor.moveToFirst()) {
          int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
          if (column >= 0 && !cursor.isNull(column)) fileName = cursor.getString(column);
        }
      }
    }
    if (mimeType == null || mimeType.isEmpty()) mimeType = intentMime;
    WritableMap info = Arguments.createMap();
    info.putString("fileName", fileName == null || fileName.isEmpty() ? null : fileName);
    info.putString("mimeType", mimeType == null || mimeType.isEmpty() ? null : mimeType);
    return info;
  }

  @Override
  public void invalidate() {
    fileInfoExecutor.shutdown();
    getReactApplicationContext().removeActivityEventListener(activityEventListener);
    super.invalidate();
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
    intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
    );

    pendingPromise = promise;
    try {
      activity.startActivityForResult(intent, REQUEST_PICK_CUSTOM_SOURCE_SCRIPT);
    } catch (Exception error) {
      pendingPromise = null;
      promise.reject("PICKER_LAUNCH_FAILED", error);
    }
  }
}
