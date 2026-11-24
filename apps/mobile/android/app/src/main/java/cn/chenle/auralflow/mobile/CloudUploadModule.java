package cn.chenle.auralflow.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.OpenableColumns;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSink;

/**
 * 网易云云盘上传的原生边界。
 *
 * JS 只负责 weapi 参数与状态机；文件选择、MD5 和二进制上传都在这里按流处理，
 * 避免把几十 MB 的 FLAC 读进 Hermes 堆。上传是客户端直传 NOS，不经过应用服务器。
 */
public class CloudUploadModule extends ReactContextBaseJavaModule {
  private static final int REQUEST_PICK_AUDIO = 43013;
  private static final int BUFFER_SIZE = 64 * 1024;
  private static final long PROGRESS_INTERVAL_MS = 250;
  private static final char[] HEX = "0123456789abcdef".toCharArray();

  private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
  private final OkHttpClient httpClient = new OkHttpClient.Builder()
      .connectTimeout(30, TimeUnit.SECONDS)
      .writeTimeout(10, TimeUnit.MINUTES)
      .readTimeout(60, TimeUnit.SECONDS)
      .retryOnConnectionFailure(false)
      .build();
  private final ConcurrentHashMap<String, UploadTask> uploads = new ConcurrentHashMap<>();
  private final AtomicBoolean invalidated = new AtomicBoolean(false);

  private Promise pendingPickPromise;

  private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
      if (requestCode != REQUEST_PICK_AUDIO) return;
      Promise promise = pendingPickPromise;
      pendingPickPromise = null;
      if (promise == null) return;

      if (resultCode != Activity.RESULT_OK || data == null) {
        promise.resolve(Arguments.createArray());
        return;
      }

      try {
        ioExecutor.execute(() -> resolvePickedFiles(promise, data));
      } catch (RejectedExecutionException error) {
        promise.reject("CLOUD_UPLOAD_PICK_FAILED", "上传模块已关闭", error);
      }
    }
  };

  public CloudUploadModule(ReactApplicationContext reactContext) {
    super(reactContext);
    reactContext.addActivityEventListener(activityEventListener);
  }

  @Override
  public String getName() {
    return "CloudUploadModule";
  }

  @Override
  public void invalidate() {
    invalidated.set(true);
    getReactApplicationContext().removeActivityEventListener(activityEventListener);

    Promise pickPromise = pendingPickPromise;
    pendingPickPromise = null;
    if (pickPromise != null) {
      pickPromise.reject("CLOUD_UPLOAD_MODULE_INVALIDATED", "上传模块已关闭");
    }

    for (String uploadId : new ArrayList<>(uploads.keySet())) {
      UploadTask task = uploads.remove(uploadId);
      if (task == null) continue;
      task.reject("CLOUD_UPLOAD_MODULE_INVALIDATED", "上传模块已关闭", null);
      if (task.call != null) task.call.cancel();
    }
    httpClient.dispatcher().cancelAll();
    httpClient.connectionPool().evictAll();
    ioExecutor.shutdown();
    super.invalidate();
  }

  /** 打开系统文件选择器；允许一次选择多个音频。取消时返回空数组。 */
  @ReactMethod
  public void pickAudioFiles(Promise promise) {
    UiThreadUtil.runOnUiThread(() -> launchAudioPicker(promise));
  }

  private void launchAudioPicker(Promise promise) {
    if (invalidated.get()) {
      promise.reject("CLOUD_UPLOAD_MODULE_INVALIDATED", "上传模块已关闭");
      return;
    }
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("CLOUD_UPLOAD_NO_ACTIVITY", "当前没有可用的 Android Activity");
      return;
    }
    if (pendingPickPromise != null) {
      promise.reject("CLOUD_UPLOAD_PICK_BUSY", "已有文件选择请求正在进行");
      return;
    }

    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("*/*");
    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
        "audio/*",
        "application/octet-stream",
        "application/x-flac",
        "application/ogg",
    });
    intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
    );

    pendingPickPromise = promise;
    try {
      activity.startActivityForResult(intent, REQUEST_PICK_AUDIO);
    } catch (Exception error) {
      pendingPickPromise = null;
      promise.reject("CLOUD_UPLOAD_PICK_FAILED", "无法打开文件选择器", error);
    }
  }

  private void resolvePickedFiles(Promise promise, Intent data) {
    if (invalidated.get()) {
      promise.reject("CLOUD_UPLOAD_MODULE_INVALIDATED", "上传模块已关闭");
      return;
    }
    try {
      List<Uri> uris = collectUris(data);
      WritableArray result = Arguments.createArray();
      for (Uri uri : uris) {
        try {
          getReactApplicationContext().getContentResolver().takePersistableUriPermission(
              uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
          // 部分提供方不支持持久授权；本次进程内仍可读。
        }
        result.pushMap(readAudioFile(uri));
      }
      promise.resolve(result);
    } catch (Exception error) {
      promise.reject("CLOUD_UPLOAD_PICK_FAILED",
          error.getMessage() == null ? "读取所选音频失败" : error.getMessage(), error);
    }
  }

  private static List<Uri> collectUris(Intent data) {
    Set<Uri> unique = new LinkedHashSet<>();
    ClipData clipData = data.getClipData();
    if (clipData != null) {
      for (int index = 0; index < clipData.getItemCount(); index += 1) {
        Uri uri = clipData.getItemAt(index).getUri();
        if (uri != null) unique.add(uri);
      }
    }
    if (data.getData() != null) unique.add(data.getData());
    return new ArrayList<>(unique);
  }

  private WritableMap readAudioFile(Uri uri) throws Exception {
    ContentResolver resolver = getReactApplicationContext().getContentResolver();
    String fileName = queryText(resolver, uri, OpenableColumns.DISPLAY_NAME);
    if (fileName == null || fileName.isEmpty()) {
      fileName = uri.getLastPathSegment();
    }
    if (fileName == null || fileName.isEmpty()) fileName = "未知音频";

    long size = queryLong(resolver, uri, OpenableColumns.SIZE);
    if (size <= 0) {
      try (AssetFileDescriptor descriptor = resolver.openAssetFileDescriptor(uri, "r")) {
        if (descriptor != null) size = descriptor.getLength();
      } catch (Exception ignored) {
        // 交由下面的显式失败处理。
      }
    }
    if (size <= 0) throw new IOException("无法读取文件大小：" + fileName);

    String mimeType = resolver.getType(uri);
    if (mimeType == null || mimeType.isEmpty()) mimeType = "application/octet-stream";

    String title = "";
    String artist = "";
    String album = "";
    long durationMs = 0;
    MediaMetadataRetriever retriever = new MediaMetadataRetriever();
    try {
      retriever.setDataSource(getReactApplicationContext(), uri);
      title = safeText(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
      artist = safeText(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
      album = safeText(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
      String duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
      if (duration != null) durationMs = Math.max(0, Long.parseLong(duration));
    } catch (Exception ignored) {
      // 元数据不是上传的必要条件，失败时用文件名兜底。
    } finally {
      try {
        retriever.release();
      } catch (Exception ignored) {
      }
    }
    if (title.isEmpty()) title = stripExtension(fileName);

    WritableMap file = Arguments.createMap();
    file.putString("uri", uri.toString());
    file.putString("fileName", fileName);
    file.putString("mimeType", mimeType);
    file.putDouble("size", (double) size);
    file.putString("title", title);
    file.putString("artist", artist);
    file.putString("album", album);
    file.putDouble("durationMs", (double) durationMs);
    return file;
  }

  private static String queryText(ContentResolver resolver, Uri uri, String column) {
    try (Cursor cursor = resolver.query(uri, new String[] {column}, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) {
        int index = cursor.getColumnIndex(column);
        if (index >= 0 && !cursor.isNull(index)) return cursor.getString(index);
      }
    } catch (Exception ignored) {
    }
    return null;
  }

  private static long queryLong(ContentResolver resolver, Uri uri, String column) {
    try (Cursor cursor = resolver.query(uri, new String[] {column}, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) {
        int index = cursor.getColumnIndex(column);
        if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index);
      }
    } catch (Exception ignored) {
    }
    return -1;
  }

  private static String safeText(String value) {
    return value == null || "null".equals(value) ? "" : value;
  }

  private static String stripExtension(String fileName) {
    int dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.substring(0, dot) : fileName;
  }

  /** 流式计算文件 MD5，返回小写十六进制。 */
  @ReactMethod
  public void computeMd5(String uriString, Promise promise) {
    try {
      ioExecutor.execute(() -> {
        if (invalidated.get()) {
          promise.reject("CLOUD_UPLOAD_MODULE_INVALIDATED", "上传模块已关闭");
          return;
        }
        try {
          Uri uri = requireReadableUri(uriString);
          MessageDigest digest = MessageDigest.getInstance("MD5");
          try (InputStream input = openStream(uri)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
              digest.update(buffer, 0, read);
            }
          }
          promise.resolve(toHex(digest.digest()));
        } catch (Exception error) {
          promise.reject("CLOUD_UPLOAD_MD5_FAILED",
              error.getMessage() == null ? "计算文件 MD5 失败" : error.getMessage(), error);
        }
      });
    } catch (RejectedExecutionException error) {
      promise.reject("CLOUD_UPLOAD_MODULE_INVALIDATED", "上传模块已关闭", error);
    }
  }

  /** 把文件流式直传到 NOS；进度通过 CloudUploadProgress 事件上报。 */
  @ReactMethod
  public void uploadFile(
      String uriString,
      String uploadUrl,
      String token,
      String md5,
      String mimeType,
      double fileSizeValue,
      String uploadId,
      Promise promise) {
    try {
      if (invalidated.get()) throw new IllegalStateException("上传模块已关闭");
      Uri uri = requireReadableUri(uriString);
      HttpUrl url = HttpUrl.parse(uploadUrl);
      if (url == null) throw new IllegalArgumentException("上传地址无效");
      if (uploadId == null || uploadId.isEmpty()) throw new IllegalArgumentException("缺少上传 ID");
      if (token == null || token.isEmpty()) throw new IllegalArgumentException("缺少上传凭证");
      if (md5 == null || !md5.matches("(?i)^[a-f0-9]{32}$")) {
        throw new IllegalArgumentException("文件 MD5 无效");
      }
      long fileSize = (long) fileSizeValue;
      if (fileSize <= 0) throw new IllegalArgumentException("文件大小无效");
      if (uploads.containsKey(uploadId)) throw new IllegalStateException("上传 ID 已在使用");

      RequestBody body = new ProgressRequestBody(uri, fileSize, mimeType, uploadId);
      Request request = new Request.Builder()
          .url(url)
          .post(body)
          .header("x-nos-token", token)
          .header("Content-MD5", md5)
          .build();

      UploadTask task = new UploadTask(promise);
      task.call = httpClient.newCall(request);
      uploads.put(uploadId, task);
      try {
        task.call.enqueue(new Callback() {
        @Override
        public void onFailure(Call call, IOException error) {
          UploadTask current = uploads.remove(uploadId);
          if (current == null) return;
          current.reject("CLOUD_UPLOAD_FAILED",
              error.getMessage() == null ? "上传失败" : error.getMessage(), error);
        }

        @Override
        public void onResponse(Call call, Response response) {
          UploadTask current = uploads.remove(uploadId);
          if (current == null) {
            response.close();
            return;
          }
          try (ResponseBody responseBody = response.body()) {
            String text = responseBody == null ? "" : responseBody.string();
            if (response.isSuccessful()) {
              current.resolve(null);
            } else {
              current.reject("CLOUD_UPLOAD_HTTP_" + response.code(),
                  "上传失败（HTTP " + response.code() + "）" + snippet(text), null);
            }
          } catch (Exception error) {
            current.reject("CLOUD_UPLOAD_FAILED",
                error.getMessage() == null ? "读取上传响应失败" : error.getMessage(), error);
          }
        }
        });
      } catch (Exception enqueueError) {
        uploads.remove(uploadId);
        throw enqueueError;
      }
    } catch (Exception error) {
      promise.reject("CLOUD_UPLOAD_FAILED",
          error.getMessage() == null ? "上传失败" : error.getMessage(), error);
    }
  }

  @ReactMethod
  public void cancelUpload(String uploadId, Promise promise) {
    UploadTask task = uploadId == null ? null : uploads.remove(uploadId);
    if (task == null) {
      promise.resolve(false);
      return;
    }
    task.reject("CLOUD_UPLOAD_CANCELLED", "上传已取消", null);
    if (task.call != null) task.call.cancel();
    promise.resolve(true);
  }

  private Uri requireReadableUri(String uriString) {
    if (uriString == null || uriString.isEmpty()) throw new IllegalArgumentException("文件 URI 不能为空");
    Uri uri = Uri.parse(uriString);
    String scheme = uri.getScheme();
    if (!"content".equals(scheme) && !"file".equals(scheme)) {
      throw new IllegalArgumentException("仅支持 content:// 或 file:// 文件 URI");
    }
    if ("file".equals(scheme) && (uri.getPath() == null || uri.getPath().isEmpty())) {
      throw new IllegalArgumentException("文件路径不能为空");
    }
    return uri;
  }

  private InputStream openStream(Uri uri) throws IOException {
    if ("file".equals(uri.getScheme())) {
      return new FileInputStream(new File(uri.getPath()));
    }
    InputStream input = getReactApplicationContext().getContentResolver().openInputStream(uri);
    if (input == null) throw new IOException("无法读取所选文件");
    return input;
  }

  private void emitProgress(String uploadId, long loaded, long total) {
    if (invalidated.get()) return;
    try {
      WritableMap payload = Arguments.createMap();
      payload.putString("uploadId", uploadId);
      payload.putDouble("loaded", (double) loaded);
      payload.putDouble("total", (double) total);
      getReactApplicationContext().emitDeviceEvent("CloudUploadProgress", payload);
    } catch (Exception ignored) {
      // JS 引擎已卸载时进度事件没有接收方，不能影响上传本身。
    }
  }

  private static String toHex(byte[] bytes) {
    char[] output = new char[bytes.length * 2];
    for (int index = 0; index < bytes.length; index += 1) {
      int value = bytes[index] & 0xff;
      output[index * 2] = HEX[value >>> 4];
      output[index * 2 + 1] = HEX[value & 0x0f];
    }
    return new String(output);
  }

  private static String snippet(String text) {
    if (text == null || text.isEmpty()) return "";
    String trimmed = text.trim();
    return trimmed.length() <= 200 ? "：" + trimmed : "：" + trimmed.substring(0, 200);
  }

  private static final class UploadTask {
    private final Promise promise;
    private final AtomicBoolean settled = new AtomicBoolean(false);
    private Call call;

    UploadTask(Promise promise) {
      this.promise = promise;
    }

    void resolve(Object value) {
      if (settled.compareAndSet(false, true)) promise.resolve(value);
    }

    void reject(String code, String message, Throwable error) {
      if (!settled.compareAndSet(false, true)) return;
      if (error == null) promise.reject(code, message);
      else promise.reject(code, message, error);
    }
  }

  private final class ProgressRequestBody extends RequestBody {
    private final Uri uri;
    private final long fileSize;
    private final MediaType mediaType;
    private final String uploadId;
    private long lastEmitAt;

    ProgressRequestBody(Uri uri, long fileSize, String mimeType, String uploadId) {
      this.uri = uri;
      this.fileSize = fileSize;
      this.uploadId = uploadId;
      MediaType parsed = mimeType == null || mimeType.isEmpty()
          ? null : MediaType.parse(mimeType);
      this.mediaType = parsed == null ? MediaType.parse("application/octet-stream") : parsed;
    }

    @Override
    public MediaType contentType() {
      return mediaType;
    }

    @Override
    public long contentLength() {
      return fileSize;
    }

    @Override
    public void writeTo(BufferedSink sink) throws IOException {
      long loaded = 0;
      byte[] buffer = new byte[BUFFER_SIZE];
      emitProgress(uploadId, 0, fileSize);
      lastEmitAt = SystemClock.elapsedRealtime();
      try (InputStream input = openStream(uri)) {
        int read;
        while ((read = input.read(buffer)) != -1) {
          if (Thread.currentThread().isInterrupted()) throw new IOException("上传已取消");
          sink.write(buffer, 0, read);
          loaded += read;
          long now = SystemClock.elapsedRealtime();
          if (loaded >= fileSize || now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
            emitProgress(uploadId, loaded, fileSize);
            lastEmitAt = now;
          }
        }
        sink.flush();
      }
      if (loaded != fileSize) {
        throw new IOException("文件读取长度与预期不一致");
      }
      emitProgress(uploadId, loaded, fileSize);
    }
  }
}
