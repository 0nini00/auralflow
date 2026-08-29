package cn.chenle.auralflow.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;

import java.io.File;

/**
 * APK 应用内安装模块：把下载好的安装包通过 FileProvider 交给系统安装器。
 *
 * 暴露给 JS 的方法：
 * - {@code getSupportedAbis()}：设备支持的 ABI 列表（按偏好顺序），用于挑选 Release 资产。
 * - {@code hasInstallPermission()}：是否已授予「安装未知应用」权限。
 * - {@code openInstallPermissionSettings()}：跳转本应用的「安装未知应用」系统设置页。
 * - {@code installApk(path)}：拉起系统安装器。
 */
public class ApkInstallerModule extends ReactContextBaseJavaModule {

  public ApkInstallerModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "ApkInstallerModule";
  }

  @ReactMethod
  public void getSupportedAbis(Promise promise) {
    try {
      WritableArray array = Arguments.createArray();
      for (String abi : Build.SUPPORTED_ABIS) {
        array.pushString(abi);
      }
      promise.resolve(array);
    } catch (Exception e) {
      promise.reject("ABIS_FAILED", e.getMessage());
    }
  }

  @ReactMethod
  public void hasInstallPermission(Promise promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.resolve(true);
        return;
      }
      Context context = getReactApplicationContext();
      promise.resolve(context.getPackageManager().canRequestPackageInstalls());
    } catch (Exception e) {
      promise.reject("PERMISSION_CHECK_FAILED", e.getMessage());
    }
  }

  @ReactMethod
  public void openInstallPermissionSettings(Promise promise) {
    try {
      Context context = getReactApplicationContext();
      Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
      intent.setData(Uri.parse("package:" + context.getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("SETTINGS_FAILED", e.getMessage());
    }
  }

  @ReactMethod
  public void installApk(String filePath, Promise promise) {
    try {
      Context context = getReactApplicationContext();
      File apkFile = new File(filePath);
      if (!apkFile.exists() || apkFile.length() < 1024) {
        promise.reject("FILE_NOT_FOUND", "安装包不存在或已损坏，请重新下载");
        return;
      }
      Uri uri = FileProvider.getUriForFile(
          context, context.getPackageName() + ".fileprovider", apkFile);
      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(uri, "application/vnd.android.package-archive");
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("INSTALL_FAILED", e.getMessage() != null ? e.getMessage() : e.toString());
    }
  }
}
