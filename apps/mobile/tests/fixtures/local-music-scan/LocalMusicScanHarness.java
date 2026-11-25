package cn.chenle.auralflow.mobile;

import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import java.util.logging.Level;
import java.util.logging.Logger;

public final class LocalMusicScanHarness {
  private static final String MEDIA_STORE_SCOPE = "mediaStore:external:music";
  private static final String[] SIDECAR_COVER_NAMES = {"folder.jpg", "Folder.jpg", "cover.jpg", "Cover.jpg", "folder.png", "Folder.png", "cover.png", "Cover.png"};
  private final ContentResolver resolver = new ContentResolver();
  private LocalMusicScanHarness getReactApplicationContext() { return this; }
  private ContentResolver getContentResolver() { return resolver; }
  private void emitScanProgress(int scanned, int total) {}
  private static String resolveCover(ContentResolver resolver, long albumId, File file) { return null; }
  private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }

  private static final class Uri {
    final String value;
    Uri(String value) { this.value = value; }
    public String toString() { return value; }
  }
  private static final class ContentUris {
    static Uri withAppendedId(Uri collection, long id) { return new Uri(collection + "/" + id); }
  }
  private static final class MediaStore {
    static final class Audio {
      static final class Media {
        static final Uri EXTERNAL_CONTENT_URI = new Uri("content://media/external/audio/media");
        static final String _ID="id", TITLE="title", ARTIST="artist", ALBUM="album", ALBUM_ID="albumId",
          DURATION="duration", DATA="data", DATE_MODIFIED="modified", SIZE="size", IS_MUSIC="music";
      }
    }
  }
  private static final class Row {
    final Map<String, String> values = new HashMap<>();
    Runnable beforeRecheck;
    int dataReads;
    Row(long id, File file) {
      String filePath = file.getAbsolutePath().replace(File.separatorChar, '/');
      if (filePath.length() > 2 && filePath.charAt(1) == ':') filePath = filePath.substring(2);
      check(filePath.startsWith("/") && new File(filePath).isFile(), "Fixture must exercise the Android absolute path branch");
      values.put("id", Long.toString(id)); values.put("title", file.getName());
      values.put("artist", "Artist"); values.put("album", "Album"); values.put("albumId", "0");
      values.put("duration", "300"); values.put("data", filePath);
      values.put("modified", Long.toString(file.lastModified() / 1000)); values.put("size", Long.toString(file.length()));
    }
  }
  private static final class ContentResolver {
    final List<Row> rows = new ArrayList<>();
    boolean queryFails;
    Cursor query(Uri uri, String[] columns, String selection, String[] args, String order) throws IOException {
      if (queryFails) throw new IOException("media query failed");
      return new Cursor(columns, rows);
    }
  }
  private static final class Cursor implements AutoCloseable {
    final String[] columns;
    final List<Row> rows;
    int at = -1;
    Cursor(String[] columns, List<Row> rows) { this.columns = columns; this.rows = rows; }
    int getColumnIndexOrThrow(String name) { return Arrays.asList(columns).indexOf(name); }
    int getColumnCount() { return columns.length; }
    int getCount() { return rows.size(); }
    boolean moveToNext() { return ++at < rows.size(); }
    boolean isNull(int index) { return rows.get(at).values.get(columns[index]) == null; }
    long getLong(int index) { return Long.parseLong(getString(index)); }
    String getString(int index) {
      Row row = rows.get(at);
      if (columns[index].equals("data") && ++row.dataReads == 3 && row.beforeRecheck != null) row.beforeRecheck.run();
      return row.values.get(columns[index]);
    }
    public void close() {}
  }
  private static final class ReadableMap {
    final Map<String, String> values = new HashMap<>();
    boolean hasKey(String key) { return values.containsKey(key); }
    boolean isNull(String key) { return values.get(key) == null; }
    String getString(String key) { return values.get(key); }
  }
  private static final class WritableMap extends HashMap<String, Object> {
    private static final long serialVersionUID = 1L;
    void putString(String key, String value) { put(key, value); }
    void putNull(String key) { put(key, null); }
    void putBoolean(String key, boolean value) { put(key, value); }
    void putDouble(String key, double value) { put(key, value); }
    void putArray(String key, WritableArray value) { put(key, value); }
  }
  private static final class WritableArray extends ArrayList<Object> {
    private static final long serialVersionUID = 1L;
    void pushMap(WritableMap value) { add(value); }
    void pushString(String value) { add(value); }
  }
  private static final class Arguments {
    static WritableMap createMap() { return new WritableMap(); }
    static WritableArray createArray() { return new WritableArray(); }
  }
  private static final class Promise {
    WritableMap result;
    Throwable error;
    void resolve(WritableMap value) { result = value; }
    void reject(String code, Throwable value) { error = value; }
  }
  /* METHODS */

  private static File copy(File root, String extension, String name) throws IOException {
    File file = new File(root, name);
    Files.copy(new File(root.getParentFile(), "fixture." + extension).toPath(), file.toPath());
    return file;
  }
  private static WritableMap song(Promise promise, int index) {
    check(promise.error == null, "Optional tag failure rejected the whole scan: " + promise.error);
    check(promise.result != null && Boolean.TRUE.equals(promise.result.get("complete")), "Scan did not return its complete collection");
    List<?> songs = (List<?>) promise.result.get("songs");
    check(songs.size() == 2, "A readable MediaStore row was dropped");
    return (WritableMap) songs.get(index);
  }
  private static void warning(WritableMap song, String prefix) {
    Object warnings = song.get("warnings");
    check(warnings instanceof List<?> && ((List<?>) warnings).stream().anyMatch(value -> value.toString().startsWith(prefix)),
      "Expected explicit " + prefix + " diagnostic, got: " + warnings);
  }
  public static void main(String[] args) throws Exception {
    Logger.getLogger("org.jaudiotagger").setLevel(Level.OFF);
    File root = new File(args[0], args[1]); check(root.mkdir(), "Fixture directory exists");
    File good = copy(root, "mp3", "good.mp3");
    AudioFile tagged = AudioFileIO.read(good);
    Tag tag = tagged.getTagOrCreateAndSetDefault();
    tag.setField(FieldKey.LYRICS, "[00:00.00]embedded lyrics"); tagged.commit();
    Files.writeString(new File(root, "good.lrc").toPath(), "sidecar must not override embedded lyrics");
    LocalMusicScanHarness module = new LocalMusicScanHarness();
    module.resolver.rows.add(new Row(1, good));
    File other = copy(root, args[1].equals("aac-sidecar") ? "aac" : "mp3", args[1].equals("aac-sidecar") ? "other.aac" : "other.mp3");
    if (args[1].equals("broken-tag")) Files.writeString(other.toPath(), "broken audio tag");
    if (args[1].equals("aac-sidecar")) Files.writeString(new File(root, "other.lrc").toPath(), "\ufeff[00:00.00]sidecar lyrics\r\n");
    if (args[1].equals("sidecar-error")) check(new File(root, "other.lrc").mkdir(), "Cannot create unreadable sidecar fixture");
    Row changed = new Row(2, other);
    module.resolver.rows.add(changed);
    if (args[1].equals("query-error")) module.resolver.queryFails = true;
    if (args[1].equals("signature-change")) changed.beforeRecheck = () -> {
      try (FileOutputStream out = new FileOutputStream(other, true)) { out.write(0); }
      catch (IOException error) { throw new UncheckedIOException(error); }
    };
    Promise promise = new Promise(); module.scanLocalMusicInBackground(null, promise);
    if (args[1].equals("query-error") || args[1].equals("signature-change")) {
      check(promise.error != null && promise.result == null, "Incomplete or changing query was published as complete");
    } else {
      WritableMap normal = song(promise, 0);
      check(normal.get("id").equals("1"), "Normal song was not preserved");
      check("[00:00.00]embedded lyrics".equals(normal.get("lyrics")), "Normal embedded lyrics lost priority");
      check(!normal.containsKey("warnings"), "Normal song inherited another song's warning");
      WritableMap result = song(promise, 1);
      if (args[1].equals("aac-sidecar")) {
        warning(result, "EMBEDDED_LYRICS_FAILED:");
        check("[00:00.00]sidecar lyrics\r\n".equals(result.get("lyrics")), "AAC must still read BOM sidecar lyrics");
      } else if (args[1].equals("broken-tag")) {
        warning(result, "EMBEDDED_LYRICS_FAILED:");
        check(!result.containsKey("lyrics"), "Broken tag must not invent lyrics");
      } else if (args[1].equals("sidecar-error")) {
        warning(result, "SIDECAR_LYRICS_FAILED:");
        check(!result.containsKey("lyrics"), "Unreadable sidecar must not invent lyrics");
      } else if (args[1].equals("unchanged")) {
        ReadableMap known = new ReadableMap();
        for (Object item : (List<?>) promise.result.get("songs")) {
          WritableMap row = (WritableMap) item; known.values.put((String) row.get("id"), (String) row.get("signature"));
        }
        Promise repeated = new Promise(); module.scanLocalMusicInBackground(known, repeated);
        check(Boolean.TRUE.equals(song(repeated, 0).get("tagsUnchanged")), "Valid unchanged tags were reread");
      }
    }
    System.out.println("PASS " + args[1]);
  }
}
