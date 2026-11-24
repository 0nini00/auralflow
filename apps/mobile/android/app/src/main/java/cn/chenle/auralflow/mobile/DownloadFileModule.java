package cn.chenle.auralflow.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableMap;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 下载完成文件的发布边界：只允许应用私有目录内同目录重命名，禁止复制回退。 */
public class DownloadFileModule extends ReactContextBaseJavaModule {
  private static final int REQUEST_PICK_DIRECTORY = 4101;
  private final ExecutorService copyExecutor = Executors.newSingleThreadExecutor();
  private Promise pickDirectoryPromise;

  private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
      if (requestCode != REQUEST_PICK_DIRECTORY) return;
      Promise promise = pickDirectoryPromise;
      pickDirectoryPromise = null;
      if (promise == null) return;
      if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
        promise.resolve(null);
        return;
      }
      try {
        Uri uri = data.getData();
        ContentResolver resolver = getReactApplicationContext().getContentResolver();
        try {
          resolver.takePersistableUriPermission(
              uri,
              Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
          );
        } catch (SecurityException ignored) {
          // 部分文档提供方不支持持久授权，当前会话内仍可使用。
        }
        String name = queryDisplayName(resolver, uri);
        WritableMap result = Arguments.createMap();
        result.putString("uri", uri.toString());
        result.putString("name", name == null || name.isEmpty() ? "已选文件夹" : name);
        promise.resolve(result);
      } catch (Exception error) {
        promise.reject("DOWNLOAD_DIRECTORY_FAILED", error.getMessage(), error);
      }
    }
  };

  public DownloadFileModule(ReactApplicationContext context) {
    super(context);
    context.addActivityEventListener(activityEventListener);
  }

  @Override
  public String getName() {
    return "DownloadFileModule";
  }

  @Override
  public void invalidate() {
    getReactApplicationContext().removeActivityEventListener(activityEventListener);
    if (pickDirectoryPromise != null) {
      pickDirectoryPromise.reject("DOWNLOAD_MODULE_INVALIDATED", "下载模块已关闭");
      pickDirectoryPromise = null;
    }
    copyExecutor.shutdown();
    super.invalidate();
  }

  @ReactMethod
  public synchronized void commitDownload(String partialPath, String finalPath, Promise promise) {
    try {
      if (partialPath == null || finalPath == null || partialPath.isEmpty() || finalPath.isEmpty()) {
        throw new IOException("下载提交路径不能为空");
      }
      File source = new File(partialPath).getCanonicalFile();
      File target = new File(finalPath).getCanonicalFile();
      if (!source.getName().endsWith(".part") || target.getName().endsWith(".part")) {
        throw new IOException("下载提交必须从临时文件到最终文件");
      }
      if (!source.getParentFile().equals(target.getParentFile()) || !isPrivateFile(source)) {
        throw new IOException("只允许应用私有目录内的同目录下载提交");
      }
      if (!source.isFile() || source.length() <= 0) throw new IOException("下载临时文件不存在或为空");
      if (target.exists()) throw new IOException("目标文件已存在，拒绝覆盖已完成下载");
      // RNFS.moveFile 在 rename 失败时会复制，复制失败会暴露半成品，不能用于此边界。
      if (!source.renameTo(target)) throw new IOException("下载文件原子重命名失败");
      promise.resolve(null);
    } catch (IOException | SecurityException error) {
      promise.reject("DOWNLOAD_COMMIT_FAILED", error.getMessage(), error);
    }
  }

  /** 让用户选择一个系统文件夹，返回持久授权的 tree URI。 */
  @ReactMethod
  public void pickDownloadDirectory(Promise promise) {
    UiThreadUtil.runOnUiThread(() -> {
      if (pickDirectoryPromise != null) {
        promise.reject("DOWNLOAD_DIRECTORY_BUSY", "已有文件夹选择请求正在进行");
        return;
      }
      Activity activity = getCurrentActivity();
      if (activity == null) {
        promise.reject("DOWNLOAD_DIRECTORY_NO_ACTIVITY", "当前没有可用的 Android Activity");
        return;
      }
      Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
      intent.addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION
              | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
              | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
              | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
      );
      pickDirectoryPromise = promise;
      try {
        activity.startActivityForResult(intent, REQUEST_PICK_DIRECTORY);
      } catch (Exception error) {
        pickDirectoryPromise = null;
        promise.reject("DOWNLOAD_DIRECTORY_FAILED", error.getMessage(), error);
      }
    });
  }

  /** 把应用私有目录里的下载文件复制到用户选择的文件夹；同名时自动加序号，不覆盖用户文件。 */
  @ReactMethod
  public void copyFileToDirectory(String sourcePath, String treeUriString, String fileName, Promise promise) {
    copyExecutor.execute(() -> {
      try {
        if (sourcePath == null || treeUriString == null || fileName == null || fileName.isEmpty()) {
          throw new IOException("复制参数不能为空");
        }
        File source = new File(sourcePath).getCanonicalFile();
        if (!source.isFile() || source.length() <= 0) throw new IOException("源文件不存在或为空");
        if (!isPrivateFile(source)) throw new IOException("只允许复制应用私有目录内的下载文件");

        ContentResolver resolver = getReactApplicationContext().getContentResolver();
        Uri treeUri = Uri.parse(treeUriString);
        String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri parentDocument = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
        String finalName = uniqueChildName(resolver, treeUri, treeDocId, fileName);
        Uri target = DocumentsContract.createDocument(resolver, parentDocument, mimeTypeFor(finalName), finalName);
        if (target == null) throw new IOException("无法在所选文件夹创建文件");
        try (InputStream in = new BufferedInputStream(new FileInputStream(source));
             OutputStream out = new BufferedOutputStream(resolver.openOutputStream(target))) {
          if (out == null) throw new IOException("无法写入所选文件夹");
          byte[] buffer = new byte[64 * 1024];
          int read;
          while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
          out.flush();
        } catch (Exception error) {
          try {
            DocumentsContract.deleteDocument(resolver, target);
          } catch (Exception ignored) {}
          throw error;
        }
        promise.resolve(target.toString());
      } catch (Exception error) {
        promise.reject("DOWNLOAD_COPY_FAILED", error.getMessage(), error);
      }
    });
  }

  @ReactMethod
  public void deleteFile(String documentUri, Promise promise) {
    copyExecutor.execute(() -> {
      try {
        Uri uri = Uri.parse(documentUri);
        if (!"content".equals(uri.getScheme())) throw new IOException("只支持删除所选文件夹中的文档");
        boolean deleted = DocumentsContract.deleteDocument(
            getReactApplicationContext().getContentResolver(), uri);
        promise.resolve(deleted);
      } catch (Exception error) {
        promise.reject("DOWNLOAD_DELETE_FAILED", error.getMessage(), error);
      }
    });
  }

  @ReactMethod
  public void getFileSize(String documentUri, Promise promise) {
    copyExecutor.execute(() -> {
      try {
        Uri uri = Uri.parse(documentUri);
        if (!"content".equals(uri.getScheme())) throw new IOException("只支持查询所选文件夹中的文档");
        try (Cursor cursor = getReactApplicationContext().getContentResolver().query(
            uri,
            new String[] {DocumentsContract.Document.COLUMN_SIZE},
            null, null, null)) {
          long size = cursor != null && cursor.moveToFirst() && !cursor.isNull(0) ? cursor.getLong(0) : 0L;
          promise.resolve((double) size);
        }
      } catch (Exception error) {
        promise.reject("DOWNLOAD_SIZE_FAILED", error.getMessage(), error);
      }
    });
  }

  private String uniqueChildName(ContentResolver resolver, Uri treeUri, String treeDocId, String fileName) {
    Set<String> used = new HashSet<>();
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeDocId);
    try (Cursor cursor = resolver.query(
        children,
        new String[] {DocumentsContract.Document.COLUMN_DISPLAY_NAME},
        null, null, null)) {
      if (cursor != null) {
        int index = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
        while (cursor.moveToNext()) {
          if (index >= 0) used.add(cursor.getString(index));
        }
      }
    } catch (Exception ignored) {
      // 查询失败时按原名尝试，由 createDocument 的结果决定成败。
    }
    if (!used.contains(fileName)) return fileName;
    String stem = fileName;
    String ext = "";
    int dot = fileName.lastIndexOf('.');
    if (dot > 0) {
      stem = fileName.substring(0, dot);
      ext = fileName.substring(dot);
    }
    for (int index = 1; index < 1000; index += 1) {
      String candidate = stem + " (" + index + ")" + ext;
      if (!used.contains(candidate)) return candidate;
    }
    throw new IllegalStateException("目标文件夹同名文件过多");
  }

  private String queryDisplayName(ContentResolver resolver, Uri uri) {
    try (Cursor cursor = resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) {
        int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
        if (index >= 0) return cursor.getString(index);
      }
    } catch (Exception ignored) {}
    return null;
  }

  private String mimeTypeFor(String fileName) {
    String lower = fileName.toLowerCase(Locale.ROOT);
    String ext = lower.substring(lower.lastIndexOf('.') + 1);
    switch (ext) {
      case "flac": return "audio/flac";
      case "m4a": return "audio/mp4";
      case "aac": return "audio/aac";
      case "ogg": return "audio/ogg";
      case "opus": return "audio/opus";
      case "wav": return "audio/wav";
      case "mp3":
      default: return "audio/mpeg";
    }
  }

  private boolean isPrivateFile(File file) throws IOException {
    ReactApplicationContext context = getReactApplicationContext();
    String path = file.getPath();
    String filesRoot = context.getFilesDir().getCanonicalPath() + File.separator;
    String cacheRoot = context.getCacheDir().getCanonicalPath() + File.separator;
    return path.startsWith(filesRoot) || path.startsWith(cacheRoot);
  }
}
