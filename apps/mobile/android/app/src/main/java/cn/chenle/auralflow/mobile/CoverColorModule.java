package cn.chenle.auralflow.mobile;

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

import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 封面主色调提取模块（沉浸页「氛围色背景」用）。
 *
 * 暴露给 JS 的方法：
 * - {@code getCoverColors(url, isDark)}：返回 { base, accent }（#RRGGBB，提取失败为空串）。
 *   base 是随主题明暗挑选的背景基调色，accent 是鲜艳点缀色（供进度条等小面积使用）。
 *
 * 输入 url 支持 https 远程地址与 file:// 本地缓存路径；图片下采样到约 96px 后交给
 * androidx.palette 提取，避免大图解码内存开销。
 */
public class CoverColorModule extends ReactContextBaseJavaModule {

  private static final int TARGET_SAMPLE_SIZE = 96;
  private static final int CONNECT_TIMEOUT_MS = 8000;
  private static final int READ_TIMEOUT_MS = 8000;

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  public CoverColorModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "CoverColorModule";
  }

  @ReactMethod
  public void getCoverColors(String url, boolean isDark, Promise promise) {
    if (url == null || url.isEmpty()) {
      promise.resolve(emptyResult());
      return;
    }
    executor.execute(() -> {
      try {
        Bitmap bitmap = decodeSampled(url);
        if (bitmap == null) {
          promise.resolve(emptyResult());
          return;
        }
        Palette palette;
        try {
          palette = Palette.from(bitmap).maximumColorCount(16).clearFilters().generate();
        } finally {
          bitmap.recycle();
        }

        String base = pickBase(palette, isDark);
        String accent = pickAccent(palette, base);

        WritableMap result = Arguments.createMap();
        result.putString("base", base);
        result.putString("accent", accent);
        promise.resolve(result);
      } catch (Exception e) {
        // 取色失败属于可降级场景，返回空串让 JS 回退纯主题色
        promise.resolve(emptyResult());
      }
    });
  }

  private static WritableMap emptyResult() {
    WritableMap result = Arguments.createMap();
    result.putString("base", "");
    result.putString("accent", "");
    return result;
  }

  /** 深色主题优先暗色变体保证背景足够沉，浅色主题优先亮色变体。 */
  private static String pickBase(Palette palette, boolean isDark) {
    Palette.Swatch swatch = isDark
        ? firstNonNull(palette.getDarkVibrantSwatch(), palette.getDarkMutedSwatch(),
            palette.getVibrantSwatch(), palette.getMutedSwatch(), palette.getDominantSwatch())
        : firstNonNull(palette.getLightVibrantSwatch(), palette.getLightMutedSwatch(),
            palette.getVibrantSwatch(), palette.getMutedSwatch(), palette.getDominantSwatch());
    return swatch == null ? "" : toHex(swatch.getRgb());
  }

  private static String pickAccent(Palette palette, String baseHex) {
    Palette.Swatch swatch = firstNonNull(palette.getVibrantSwatch(), palette.getDarkVibrantSwatch(),
        palette.getLightVibrantSwatch(), palette.getDominantSwatch());
    String hex = swatch == null ? "" : toHex(swatch.getRgb());
    // accent 与 base 相同没有点缀意义，置空让 JS 回退主题色
    return hex.equals(baseHex) ? "" : hex;
  }

  @SafeVarargs
  private static Palette.Swatch firstNonNull(Palette.Swatch... swatches) {
    for (Palette.Swatch swatch : swatches) {
      if (swatch != null) return swatch;
    }
    return null;
  }

  private static String toHex(int rgb) {
    return String.format("#%06X", 0xFFFFFF & rgb);
  }

  /** 远程 URL / file:// 统一下采样解码；返回 null 表示不可用。 */
  private static Bitmap decodeSampled(String url) {
    try {
      if (url.startsWith("file://")) {
        String path = Uri.parse(url).getPath();
        if (path == null) return null;
        return decodeFileSampled(new File(path));
      }
      if (!url.startsWith("http://") && !url.startsWith("https://")) return null;

      HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
      conn.setReadTimeout(READ_TIMEOUT_MS);
      conn.setRequestProperty("User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36");
      try (InputStream input = conn.getInputStream()) {
        byte[] bytes = readAll(input);
        if (bytes == null) return null;
        return decodeBytesSampled(bytes);
      } finally {
        conn.disconnect();
      }
    } catch (Exception e) {
      return null;
    }
  }

  private static Bitmap decodeFileSampled(File file) {
    if (!file.exists() || file.length() <= 0) return null;
    BitmapFactory.Options bounds = new BitmapFactory.Options();
    bounds.inJustDecodeBounds = true;
    BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
    String path = file.getAbsolutePath();
    return decodeWithSampleSize(
        (options) -> BitmapFactory.decodeFile(path, options),
        bounds.outWidth, bounds.outHeight);
  }

  private static Bitmap decodeBytesSampled(byte[] bytes) {
    BitmapFactory.Options bounds = new BitmapFactory.Options();
    bounds.inJustDecodeBounds = true;
    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
    return decodeWithSampleSize(
        (options) -> BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options),
        bounds.outWidth, bounds.outHeight);
  }

  private interface OptionsDecoder {
    Bitmap decode(BitmapFactory.Options options);
  }

  private static Bitmap decodeWithSampleSize(OptionsDecoder decoder, int width, int height) {
    if (width <= 0 || height <= 0) return null;
    int sample = 1;
    while (width / (sample * 2) >= TARGET_SAMPLE_SIZE && height / (sample * 2) >= TARGET_SAMPLE_SIZE) {
      sample *= 2;
    }
    BitmapFactory.Options options = new BitmapFactory.Options();
    options.inSampleSize = sample;
    return decoder.decode(options);
  }

  private static byte[] readAll(InputStream input) throws Exception {
    java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
    byte[] chunk = new byte[16 * 1024];
    int read;
    while ((read = input.read(chunk)) != -1) {
      buffer.write(chunk, 0, read);
    }
    byte[] bytes = buffer.toByteArray();
    return bytes.length > 0 ? bytes : null;
  }
}
