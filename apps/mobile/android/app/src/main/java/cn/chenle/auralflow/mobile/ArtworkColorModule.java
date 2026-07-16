package cn.chenle.auralflow.mobile;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import androidx.palette.graphics.Palette;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.InputStream;
import java.net.URL;

/**
 * 从歌曲封面提取主色调，供播放页生成与桌面端一致的“封面氛围色”背景。
 *
 * 使用 AndroidX Palette 从封面 Bitmap 计算 dominant / vibrant / muted 等色板，
 * 返回十六进制颜色字符串（无 swatch 时返回 null）。
 */
public class ArtworkColorModule extends ReactContextBaseJavaModule {

  public ArtworkColorModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "ArtworkColorModule";
  }

  @ReactMethod
  public void extractArtworkColors(String imageUri, Promise promise) {
    try {
      if (imageUri == null || imageUri.isEmpty()) {
        promise.reject("ARTWORK_EMPTY", "封面地址为空");
        return;
      }
      Uri uri = Uri.parse(imageUri);
      Bitmap bitmap;
      InputStream in = openStream(uri);
      if (in == null) {
        promise.reject("ARTWORK_OPEN_FAILED", "无法打开封面流");
        return;
      }
      try {
        bitmap = BitmapFactory.decodeStream(in);
      } finally {
        try {
          in.close();
        } catch (Exception ignored) {
          // 关闭失败不影响结果
        }
      }
      if (bitmap == null) {
        promise.reject("ARTWORK_DECODE_FAILED", "封面解码失败");
        return;
      }
      Palette palette = Palette.from(bitmap).generate();
      WritableMap result = Arguments.createMap();
      result.putString("dominant", toHex(palette.getDominantColor(0)));
      result.putString("vibrant", toHex(palette.getVibrantColor(0)));
      result.putString("darkVibrant", toHex(palette.getDarkVibrantColor(0)));
      result.putString("muted", toHex(palette.getMutedColor(0)));
      result.putString("darkMuted", toHex(palette.getDarkMutedColor(0)));
      promise.resolve(result);
    } catch (Exception error) {
      promise.reject("ARTWORK_COLOR_FAILED", error);
    }
  }

  private InputStream openStream(Uri uri) throws Exception {
    String scheme = uri.getScheme();
    if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
      return new URL(uri.toString()).openStream();
    }
    ContentResolver resolver = getReactApplicationContext().getContentResolver();
    return resolver.openInputStream(uri);
  }

  private static String toHex(int color) {
    if (color == 0) {
      return null;
    }
    return String.format("#%06X", 0xFFFFFF & color);
  }
}
