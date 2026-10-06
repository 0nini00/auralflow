package cn.chenle.auralflow.mobile;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import java.io.File;
import java.io.IOException;

/** 下载完成文件的发布边界：只允许应用私有目录内同目录重命名，禁止复制回退。 */
public class DownloadFileModule extends ReactContextBaseJavaModule {
  public DownloadFileModule(ReactApplicationContext context) {
    super(context);
  }

  @Override
  public String getName() {
    return "DownloadFileModule";
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

  private boolean isPrivateFile(File file) throws IOException {
    ReactApplicationContext context = getReactApplicationContext();
    String path = file.getPath();
    String filesRoot = context.getFilesDir().getCanonicalPath() + File.separator;
    String cacheRoot = context.getCacheDir().getCanonicalPath() + File.separator;
    return path.startsWith(filesRoot) || path.startsWith(cacheRoot);
  }
}
