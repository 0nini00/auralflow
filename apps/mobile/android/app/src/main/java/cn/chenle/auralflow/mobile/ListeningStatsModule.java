package cn.chenle.auralflow.mobile;

import android.util.AtomicFile;
import android.util.JsonReader;
import android.util.JsonToken;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 独立文件存储，避免真实收听历史占满共享 AsyncStorage 数据库。 */
public final class ListeningStatsModule extends ReactContextBaseJavaModule {
  // RN 上下文重建时仍共用一个串行队列，禁止两个 AtomicFile 同时写同一个月。
  private static final ExecutorService IO_EXECUTOR = Executors.newSingleThreadExecutor();
  private final ListeningStatsFiles files;

  public ListeningStatsModule(ReactApplicationContext context) {
    super(context);
    files = new ListeningStatsFiles(new File(context.getFilesDir(), "listening-stats"),
      AndroidAtomicHandle::new, ListeningStatsModule::validateJsonArray);
  }

  @Override public String getName() { return "ListeningStatsStore"; }

  @ReactMethod public void listMonths(Promise promise) {
    IO_EXECUTOR.execute(() -> {
      try {
        WritableArray months = Arguments.createArray();
        for (String month : files.listMonths()) months.pushString(month);
        promise.resolve(months);
      } catch (Exception error) {
        promise.reject("LISTENING_STATS_LIST_FAILED", "读取统计月份失败：" + error.getMessage(), error);
      }
    });
  }

  @ReactMethod public void readMonth(String month, Promise promise) {
    IO_EXECUTOR.execute(() -> {
      try { promise.resolve(files.readMonth(month)); }
      catch (Exception error) {
        promise.reject("LISTENING_STATS_READ_FAILED", "读取统计月文件失败：" + error.getMessage(), error);
      }
    });
  }

  @ReactMethod public void writeMonth(String month, String contents, Promise promise) {
    IO_EXECUTOR.execute(() -> {
      try {
        files.writeMonth(month, contents);
        promise.resolve(null);
      } catch (Exception error) {
        promise.reject("LISTENING_STATS_WRITE_FAILED", "保存统计月文件失败：" + error.getMessage(), error);
      }
    });
  }

  private static void validateJsonArray(String contents) throws IOException {
    try (JsonReader reader = new JsonReader(new StringReader(contents))) {
      reader.setLenient(false);
      reader.beginArray();
      while (reader.hasNext()) reader.skipValue();
      reader.endArray();
      if (reader.peek() != JsonToken.END_DOCUMENT) throw new IOException("统计内容包含数组后的额外数据");
    }
  }

  private static final class AndroidAtomicHandle implements ListeningStatsFiles.AtomicHandle {
    private final AtomicFile file;
    AndroidAtomicHandle(File base) { file = new AtomicFile(base); }
    @Override public InputStream openRead() throws IOException { return file.openRead(); }
    @Override public FileOutputStream startWrite() throws IOException { return file.startWrite(); }
    @Override public void finishWrite(FileOutputStream stream) { file.finishWrite(stream); }
    @Override public void failWrite(FileOutputStream stream) { file.failWrite(stream); }
  }
}
