import java.io.*;
import java.net.URI;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;

public final class ExternalFileNativeHarness {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  static final class Uri {
    final URI value;
    private Uri(URI value) { this.value = value; }
    static Uri parse(String text) { return new Uri(URI.create(text)); }
    String getScheme() { return value.getScheme(); }
    String getAuthority() { return value.getAuthority(); }
    String getPath() { return value.getPath(); }
    @Override public boolean equals(Object other) { return other instanceof Uri && value.equals(((Uri) other).value); }
    @Override public int hashCode() { return value.hashCode(); }
    @Override public String toString() { return value.toString(); }
  }

  static final class Intent {
    final Uri data;
    final String type;
    Intent(String uri, String type) { data = Uri.parse(uri); this.type = type; }
    Uri getData() { return data; }
    String getType() { return type; }
  }

  static final class Activity {
    Intent intent;
    Intent getIntent() { return intent; }
  }

  static final class OpenableColumns { static final String DISPLAY_NAME = "_display_name"; }
  static final class Cursor implements AutoCloseable {
    final String name;
    boolean closed;
    Cursor(String name) { this.name = name; }
    boolean moveToFirst() { return name != null; }
    int getColumnIndex(String column) { return column.equals(OpenableColumns.DISPLAY_NAME) ? 0 : -1; }
    boolean isNull(int index) { return name == null; }
    String getString(int index) { return name; }
    @Override public void close() { closed = true; }
  }

  static final class ContentResolver {
    String name = "音频 #1.mp3";
    String mime = "audio/mpeg";
    RuntimeException failure;
    boolean nullStream;
    boolean readFailure;
    boolean opened;
    boolean closed;
    Cursor cursor;
    CountDownLatch started;
    CountDownLatch unblock;
    void assertBackground() {
      check(!Thread.currentThread().getName().equals("main"), "I/O must run outside the bridge thread");
      if (failure != null) throw failure;
    }
    String getType(Uri uri) { assertBackground(); return mime; }
    Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
      assertBackground();
      check(Arrays.equals(projection, new String[] { OpenableColumns.DISPLAY_NAME }), "Wrong metadata projection");
      cursor = new Cursor(name);
      return cursor;
    }
    InputStream openInputStream(Uri uri) throws IOException {
      assertBackground();
      opened = true;
      if (started != null) started.countDown();
      if (unblock != null) {
        try { check(unblock.await(3, TimeUnit.SECONDS), "Read never unblocked"); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException(error); }
      }
      if (nullStream) return null;
      return new ByteArrayInputStream(new byte[] { 1 }) {
        @Override public synchronized int read() {
          if (readFailure) throw new IllegalStateException("Read failed");
          return super.read();
        }
        @Override public void close() throws IOException { closed = true; super.close(); }
      };
    }
  }

  static final class WritableMap {
    final Map<String, Object> values = new HashMap<>();
    void putString(String key, String value) { values.put(key, value); }
    void putNull(String key) { values.put(key, null); }
  }
  static final class Arguments { static WritableMap createMap() { return new WritableMap(); } }
  static final class Promise {
    final CountDownLatch done = new CountDownLatch(1);
    WritableMap result;
    Throwable error;
    void resolve(Object value) { result = (WritableMap) value; done.countDown(); }
    void reject(String code, Throwable cause) { error = cause; done.countDown(); }
    WritableMap value() throws Exception {
      check(done.await(4, TimeUnit.SECONDS), "Promise never settled");
      if (error != null) throw new AssertionError(error);
      return result;
    }
    void rejected(Class<? extends Throwable> type) throws Exception {
      check(done.await(4, TimeUnit.SECONDS), "Rejected promise never settled");
      check(error != null && type.isInstance(error), "Wrong rejection: " + error);
      check(result == null, "Failure must not publish a result");
    }
  }

  static class BaseModule {
    final ContentResolver resolver = new ContentResolver();
    final Activity activity = new Activity();
    boolean invalidated;
    BaseModule getReactApplicationContext() { return this; }
    ContentResolver getContentResolver() { return resolver; }
    Activity getCurrentActivity() { return activity; }
    void removeActivityEventListener(Object listener) {}
    public void invalidate() { invalidated = true; }
  }

  static final class FileInfoModule extends BaseModule {
    final Object activityEventListener = new Object();
/* FILE_INFO_METHODS */
  }

  static final class AudioModule extends BaseModule {
    final Object writeActivityEventListener = new Object();
    int mapped;
    WritableMap buildSongFromUri(ContentResolver resolver, Uri uri) {
      check(!Thread.currentThread().getName().equals("main"), "Song mapping must run in background");
      mapped++;
      WritableMap song = Arguments.createMap();
      song.putString("title", "Existing mapper title");
      song.putString("filePath", "/private/path/without/grant.mp3");
      return song;
    }
/* AUDIO_METHODS */
  }

  private static void metadata(File directory) throws Exception {
    FileInfoModule module = new FileInfoModule();
    String uri = "content://downloads/document/42";
    try {
      Promise provider = new Promise(); module.getFileInfo(uri, provider);
      Map<String, Object> info = provider.value().values;
      check(info.get("fileName").equals("音频 #1.mp3") && info.get("mimeType").equals("audio/mpeg"), "Provider metadata lost");
      check(module.resolver.cursor.closed, "Metadata cursor leaked");

      module.resolver.name = null; module.resolver.mime = null;
      module.activity.intent = new Intent(uri, "application/javascript");
      Promise intent = new Promise(); module.getFileInfo(uri, intent);
      check(intent.value().values.get("fileName") == null, "Missing name must stay null");
      check(intent.result.values.get("mimeType").equals("application/javascript"), "Matching Intent MIME lost");

      module.activity.intent = new Intent("content://downloads/document/99", "audio/flac");
      Promise mismatch = new Promise(); module.getFileInfo(uri, mismatch);
      check(mismatch.value().values.get("mimeType") == null, "Unrelated Intent MIME must not leak");

      File file = new File(directory, "音源 #1%.js");
      Files.writeString(file.toPath(), "test");
      Promise local = new Promise(); module.getFileInfo(file.toURI().toString(), local);
      check(local.value().values.get("fileName").equals(file.getName()), "File URI must decode once");

      module.resolver.failure = new SecurityException("No grant");
      Promise denied = new Promise(); module.getFileInfo(uri, denied); denied.rejected(SecurityException.class);
    } finally { module.invalidate(); }
    Promise late = new Promise(); module.getFileInfo(uri, late); late.rejected(RejectedExecutionException.class);
    check(module.invalidated, "Base module invalidation missing");
  }

  private static void audio(File directory) throws Exception {
    AudioModule module = new AudioModule();
    String uri = "content://downloads/document/42";
    try {
      Promise content = new Promise(); module.readLocalAudioFile(uri, content);
      Map<String, Object> song = content.value().values;
      check(module.resolver.opened && module.resolver.closed && module.mapped == 1, "Read grant not checked or stream leaked");
      check(song.get("title").equals("Existing mapper title"), "Existing mapper result lost");
      check(song.get("filePath").equals(uri) && song.get("contentUri").equals(uri), "Content grant URI replaced by DATA path");

      File file = new File(directory, "音频 #1%.mp3"); Files.write(file.toPath(), new byte[] { 1 });
      String fileUri = file.toURI().toString();
      Promise local = new Promise(); module.readLocalAudioFile(fileUri, local);
      check(local.value().values.get("filePath").equals(fileUri), "File URI was altered");

      int before = module.mapped;
      module.resolver.failure = new SecurityException("Grant revoked");
      Promise denied = new Promise(); module.readLocalAudioFile(uri, denied); denied.rejected(SecurityException.class);
      check(module.mapped == before, "Unreadable file must not reach mapper");
      module.resolver.failure = null; module.resolver.nullStream = true;
      Promise missing = new Promise(); module.readLocalAudioFile(uri, missing); missing.rejected(FileNotFoundException.class);
      check(module.mapped == before, "Null stream must not reach mapper");
    } finally { module.invalidate(); }
    Promise late = new Promise(); module.readLocalAudioFile(uri, late); late.rejected(RejectedExecutionException.class);
  }

  private static void boundaries() throws Exception {
    for (String uri : Arrays.asList(null, "", "https://example.test/a.mp3", "relative.mp3", "content:///42", "file://host/a.mp3", "file:///a%xx.mp3", "content://downloads/42#fragment")) {
      FileInfoModule metadata = new FileInfoModule(); AudioModule audio = new AudioModule();
      try {
        Promise first = new Promise(); metadata.getFileInfo(uri, first); first.rejected(Exception.class);
        Promise second = new Promise(); audio.readLocalAudioFile(uri, second); second.rejected(Exception.class);
        check(!audio.resolver.opened && audio.mapped == 0, "Invalid URI touched file data");
      } finally { metadata.invalidate(); audio.invalidate(); }
    }
  }

  private static void lifecycle() throws Exception {
    AudioModule module = new AudioModule();
    module.resolver.started = new CountDownLatch(1); module.resolver.unblock = new CountDownLatch(1);
    Promise accepted = new Promise(); module.readLocalAudioFile("content://downloads/42", accepted);
    check(module.resolver.started.await(3, TimeUnit.SECONDS), "Background read did not start");
    module.invalidate(); module.resolver.unblock.countDown();
    accepted.value();
    check(module.invalidated, "Base invalidation missing");
  }

  public static void main(String[] args) throws Exception {
    File directory = new File(args[0]);
    metadata(directory); audio(directory); boundaries(); lifecycle();
    System.out.println("PASS external file native boundaries");
  }
}
