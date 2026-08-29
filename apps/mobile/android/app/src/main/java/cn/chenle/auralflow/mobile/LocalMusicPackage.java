package cn.chenle.auralflow.mobile;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 注册 LocalMusicModule 到 React Native 原生模块列表。
 */
public class LocalMusicPackage implements ReactPackage {

  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    List<NativeModule> modules = new ArrayList<>();
    modules.add(new LocalMusicModule(reactContext));
    modules.add(new SecureStorageModule(reactContext));
    modules.add(new CryptoModule(reactContext));
    modules.add(new CustomSourceFilePickerModule(reactContext));
    modules.add(new ImagePickerModule(reactContext));
    modules.add(new LyricOverlayModule(reactContext));
    modules.add(new ApkInstallerModule(reactContext));
    modules.add(new CoverColorModule(reactContext));
    return modules;
  }

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }
}
