package cn.chenle.auralflow.mobile;

import android.net.Uri;
import android.webkit.CookieManager;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/** 读取内置网页登录后 WebView CookieManager 中的网易云 Cookie。 */
public class WebLoginModule extends ReactContextBaseJavaModule {
  private static final String MODULE_NAME = "WebLoginModule";

  public WebLoginModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return MODULE_NAME;
  }

  @ReactMethod
  public void readCookie(String url, Promise promise) {
    try {
      Uri uri = Uri.parse(url);
      String host = uri.getHost();
      if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) {
        throw new IllegalArgumentException("只支持 http(s) 地址");
      }
      if (host == null || !(host.equals("music.163.com") || host.endsWith(".music.163.com"))) {
        throw new IllegalArgumentException("只允许读取网易云登录域名的 Cookie");
      }
      CookieManager manager = CookieManager.getInstance();
      manager.flush();
      promise.resolve(manager.getCookie(url));
    } catch (Exception error) {
      promise.reject("WEB_LOGIN_COOKIE_FAILED", error.getMessage(), error);
    }
  }
}
