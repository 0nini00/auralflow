package cn.chenle.auralflow.mobile;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;

import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.images.Artwork;
import org.jaudiotagger.tag.images.ArtworkFactory;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** 下载临时 MP3 的后台标签事务，不把音频字节传过 JS 桥。 */
public class DownloadTagModule extends ReactContextBaseJavaModule {
  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  public DownloadTagModule(ReactApplicationContext context) {
    super(context);
  }

  @Override
  public String getName() {
    return "DownloadTagModule";
  }

  @Override
  public void invalidate() {
    // 已接受的事务排空后结束，调用方才能安全清理取消任务的文件。
    executor.shutdown();
    super.invalidate();
  }

  @ReactMethod
  public void writeMp3Tags(String audioFilePath, ReadableMap metadata, String coverPath, Promise promise) {
    try {
      executor.execute(() -> writeMp3TagsInBackground(audioFilePath, metadata, coverPath, promise));
    } catch (RejectedExecutionException error) {
      promise.reject("DOWNLOAD_TAG_WRITE_FAILED", error);
    }
  }

  private void writeMp3TagsInBackground(String audioFilePath, ReadableMap metadata, String coverPath, Promise promise) {
    try {
      File audio = requirePrivateFile(audioFilePath);
      if (!audio.getName().endsWith(".part")) throw new IOException("下载标签只能写入临时文件");
      if (!"mp3".equals(LocalTagEditor.resolveSuffix(audio, null, null))) {
        throw new IOException("下载标签只支持 MP3 音频");
      }
      File cover = coverPath == null ? null : requirePrivateFile(coverPath);
      File staging = new File(getReactApplicationContext().getFilesDir(), "local-tag-edit");
      if (!staging.mkdirs() && !staging.isDirectory()) throw new IOException("无法创建标签编辑暂存目录");
      LocalTagEditor.write(staging, "download.mp3", "audio/mpeg", new LocalTagEditor.Source() {
        @Override
        public InputStream openInput() throws IOException { return new FileInputStream(audio); }
        @Override
        public OutputStream openOutput() throws IOException { return new FileOutputStream(audio); }
      }, (audioFile, tag) -> {
        setText(tag, FieldKey.TITLE, metadata, "title");
        setText(tag, FieldKey.ARTIST, metadata, "artist");
        setText(tag, FieldKey.ALBUM, metadata, "album");
        setText(tag, FieldKey.LYRICS, metadata, "lyrics");
        if (cover != null) {
          Artwork artwork = ArtworkFactory.createArtworkFromFile(cover);
          tag.deleteField(FieldKey.COVER_ART);
          tag.setField(artwork);
        }
      });
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("DOWNLOAD_TAG_WRITE_FAILED", error);
    }
  }

  private static void setText(Tag tag, FieldKey field, ReadableMap metadata, String key) throws Exception {
    if (!metadata.hasKey(key) || metadata.isNull(key)) return;
    String value = metadata.getString(key);
    if (value != null && !value.isEmpty()) tag.setField(field, value);
  }

  private File requirePrivateFile(String value) throws IOException {
    if (value == null || value.isEmpty()) throw new IOException("文件路径不能为空");
    File file = new File(value).getCanonicalFile();
    String path = file.getPath();
    String filesRoot = getReactApplicationContext().getFilesDir().getCanonicalPath() + File.separator;
    String cacheRoot = getReactApplicationContext().getCacheDir().getCanonicalPath() + File.separator;
    if (!path.startsWith(filesRoot) && !path.startsWith(cacheRoot)) {
      throw new IOException("下载标签只允许访问应用私有文件");
    }
    if (!file.isFile() || file.length() == 0) throw new IOException("文件不存在或为空：" + path);
    return file;
  }
}
