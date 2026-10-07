package cn.chenle.auralflow.mobile;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.logging.*;
import org.jaudiotagger.audio.*;
import org.jaudiotagger.tag.*;
import org.jaudiotagger.tag.images.*;

public final class LocalTagEditHarness {
  private final ContentResolver resolver;
  private final File cache;
  private final File files;
  private boolean requested;
  private LocalTagEditHarness(ContentResolver resolver, File cache) {
    this.resolver = resolver;
    this.cache = cache;
    this.files = new File(cache.getParentFile(), "files-" + cache.getName());
    check(files.mkdir(), "files directory exists");
  }
  private LocalTagEditHarness getReactApplicationContext() { return this; }
  private ContentResolver getContentResolver() { return resolver; }
  private File getCacheDir() { return cache; }
  private File getFilesDir() { return files; }
  private void requestWriteAccess(Uri uri, TagMutator mutator, Promise promise) { requested = true; }
  private interface TagMutator { void mutate(AudioFile audio, Tag tag) throws Exception; }
  private static final class Uri {}
  private static final class Build {
    static final class VERSION { static final int SDK_INT = 35; }
    static final class VERSION_CODES { static final int Q = 29; }
  }
  private static final class RecoverableSecurityException extends SecurityException {}
  private static final class OpenableColumns { static final String DISPLAY_NAME = "_display_name"; }
  private static final class Cursor implements AutoCloseable {
    private final String name;
    Cursor(String name) { this.name = name; }
    boolean moveToFirst() { return name != null; }
    int getColumnIndex(String column) { return 0; }
    int getColumnIndexOrThrow(String column) { return 0; }
    boolean isNull(int column) { return name == null; }
    String getString(int column) { return name; }
    public void close() {}
  }
  private static final class Promise {
    Throwable failure;
    boolean success;
    void resolve(Object value) { check(failure == null && !success, "Promise resolved twice"); success = true; }
    void reject(String code, Throwable error) { check(!success && failure == null, "Promise settled twice"); failure = error; }
  }
  private static final class ContentResolver {
    final File source;
    String displayName;
    String mime;
    String fault = "";
    int writes;
    ContentResolver(File source, String name, String mime) {
      this.source = source;
      this.displayName = name;
      this.mime = mime;
    }
    Cursor query(Uri uri, String[] columns, String selection, String[] args, String order) { return new Cursor(displayName); }
    String getType(Uri uri) { return mime; }
    InputStream openInputStream(Uri uri) throws IOException {
      if (fault.equals("null-input")) return null;
      if (fault.equals("input-failure")) return new InputStream() {
        public int read() throws IOException { throw new IOException("input failure"); }
      };
      return new FileInputStream(source);
    }
    OutputStream openOutputStream(Uri uri, String mode) throws IOException {
      check(mode.equals("wt"), "Must truncate when replacing/restoring");
      writes++;
      if (fault.equals("permission")) throw new RecoverableSecurityException();
      if (fault.equals("open-unmodified-failure")) throw new IOException("open failure before truncation");
      FileOutputStream out = new FileOutputStream(source);
      if (writes == 1 && fault.equals("open-failure")) { out.close(); throw new IOException("open failure after truncation"); }
      if (writes == 1 && fault.equals("null-output")) { out.close(); return null; }
      if (writes == 1 && Set.of("partial-write", "restore-failure", "write-security").contains(fault)) {
        return new FilterOutputStream(out) {
          public void write(byte[] bytes, int start, int size) throws IOException {
            out.write(bytes, start, Math.min(19, size));
            if (fault.equals("write-security")) throw new SecurityException("permission lost during write");
            throw new IOException("partial write");
          }
        };
      }
      if (writes > 1 && fault.equals("restore-failure")) { out.close(); throw new IOException("restore failure"); }
      if (writes == 1 && fault.equals("close-failure")) return new FilterOutputStream(out) {
        public void close() throws IOException { super.close(); throw new IOException("close failure"); }
      };
      return out;
    }
  }
  /* NATIVE_WRITE_METHODS */

  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
  private static final String LYRICS = "[00:00.00]本地歌词回归测试";
  private static final byte[] COVER = Base64.getDecoder().decode(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=");
  private static void mutate(AudioFile audio, Tag tag) throws Exception {
    tag.setField(FieldKey.TITLE, "Local tag edit");
    tag.setField(FieldKey.LYRICS, LYRICS);
    tag.deleteField(FieldKey.COVER_ART);
    Artwork artwork = ArtworkFactory.getNew();
    artwork.setBinaryData(COVER);
    artwork.setMimeType("image/png");
    artwork.setPictureType(3);
    tag.setField(artwork);
  }
  public static void main(String[] args) throws Exception {
    Logger.getLogger("org.jaudiotagger").setLevel(Level.OFF);
    File root = new File(args[0]);
    String mode = args[1];
    if (mode.equals("legacy")) {
      File temp = File.createTempFile("af_tag_", ".tmp", root);
      Files.copy(new File(root, "fixture.mp3").toPath(), temp.toPath(), StandardCopyOption.REPLACE_EXISTING);
      try { AudioFileIO.read(temp); throw new AssertionError(".tmp unexpectedly read"); }
      catch (org.jaudiotagger.audio.exceptions.CannotReadException expected) {
        check(expected.getMessage().contains("No Reader"), expected.toString());
        System.out.println(expected.getMessage());
      } finally { Files.delete(temp.toPath()); }
      return;
    }
    String format = mode.equals("roundtrip") ? args[2] : "mp3";
    if (mode.equals("misnamed") || mode.equals("unknown-name")) format = "flac";
    if (mode.equals("unsupported-aac")) format = "aac";
    if (mode.equals("unsupported-opus")) format = "opus";
    if (mode.equals("wav-lyrics-unsupported")) format = "wav";
    File source = new File(root, "source-" + mode + "." + format);
    File fixture = new File(root, mode.equals("bare-mp3") ? "fixture.bare.mp3"
        : mode.equals("wav-lyrics-unsupported") ? "fixture.info.wav" : "fixture." + format);
    Files.copy(fixture.toPath(), source.toPath(), StandardCopyOption.REPLACE_EXISTING);
    if (mode.equals("unknown-format") || mode.equals("invalid-known")) Files.write(source.toPath(), new byte[128]);
    if (mode.equals("mime-only")) {
      // 无 ID3 的 MP3 可有前导填充；这里强制走 MIME 提示而非文件头或名称。
      byte[] audio = Files.readAllBytes(source.toPath());
      byte[] padded = new byte[audio.length + 16];
      System.arraycopy(audio, 0, padded, 16, audio.length);
      Files.write(source.toPath(), padded);
    }
    byte[] original = Files.readAllBytes(source.toPath());
    File cache = new File(root, "cache-" + mode + "-" + format);
    check(cache.mkdir(), "cache exists");
    String name = "歌曲." + format.toUpperCase(Locale.ROOT);
    String mime = "application/octet-stream";
    if (mode.equals("unknown-name") || mode.equals("unknown-format")) name = "recording.unknown";
    if (mode.equals("mime-only")) { name = null; mime = "audio/mpeg"; }
    if (mode.equals("misnamed")) { name = "wrong.mp3"; mime = "audio/mpeg"; }
    ContentResolver resolver = new ContentResolver(source, name, mime);
    resolver.fault = mode;
    LocalTagEditHarness harness = new LocalTagEditHarness(resolver, cache);
    Promise promise = new Promise();
    TagMutator mutator = mode.equals("mutator-failure")
        ? (audio, tag) -> { throw new IOException("mutator failure"); } : LocalTagEditHarness::mutate;
    harness.writeTagToFile(new Uri(), mutator, promise);
    File staging = new File(harness.getFilesDir(), "local-tag-edit");
    check(staging.isDirectory(), "Native staging must be in getFilesDir()/local-tag-edit, not cache");
    check(Objects.requireNonNull(cache.list()).length == 0, "Cache must not hold recoverable backups");
    Set<String> successModes = Set.of("roundtrip", "unknown-name", "mime-only", "misnamed", "bare-mp3");
    if (successModes.contains(mode)) {
      if (promise.failure != null) throw new AssertionError("Native write rejected", promise.failure);
      check(promise.success, "Native write did not resolve");
      AudioFile reread = AudioFileIO.read(source);
      check(reread.getTag().getFirst(FieldKey.TITLE).equals("Local tag edit"), "title did not persist");
      check(reread.getTag().getFirst(FieldKey.LYRICS).equals(LYRICS), "lyrics did not persist");
      check(Arrays.equals(reread.getTag().getFirstArtwork().getBinaryData(), COVER), "cover did not persist");
      AudioFile before = AudioFileIO.read(fixture);
      check(before.getAudioHeader().getFormat().equals(reread.getAudioHeader().getFormat()), "audio format changed");
      check(before.getAudioHeader().getSampleRate().equals(reread.getAudioHeader().getSampleRate()), "sample rate changed");
      check(resolver.writes == 1, "unexpected write count");
    } else if (mode.equals("permission")) {
      check(harness.requested && promise.failure == null && !promise.success, "Existing permission request was not reused");
      check(Arrays.equals(original, Files.readAllBytes(source.toPath())), "permission rejection changed source");
      resolver.fault = "";
      harness.writeTagToFile(new Uri(), mutator, promise);
      check(promise.success, "permission retry failed");
    } else {
      check(promise.failure != null && !promise.success, "Failure must reject");
      if (Set.of("restore-failure", "open-failure", "open-unmodified-failure", "null-output", "write-security").contains(mode)) {
        File[] remaining = staging.listFiles();
        check(remaining != null && remaining.length == 1, "Failed restoration must retain only the original backup");
        check(remaining[0].getParentFile().equals(new File(harness.getFilesDir(), "local-tag-edit")), "Retained backup must be under files/local-tag-edit");
        check(Arrays.equals(original, Files.readAllBytes(remaining[0].toPath())), "retained backup changed");
        check(promise.failure.toString().contains(remaining[0].getAbsolutePath()), "Recovery error must identify backup path");
        check(promise.failure.getCause() != null, "Original failure must be retained");
        check(!harness.requested, "Ambiguous/started write must reject instead of retrying from a damaged source");
        if (mode.equals("restore-failure")) {
          check(promise.failure.getSuppressed().length > 0, "Restoration failure must be retained");
          check(resolver.writes == 2, "Restore must be attempted once");
        } else {
          check(resolver.writes == 1, "Do not attempt an unconfirmed or non-I/O rollback");
        }
        if (mode.equals("open-unmodified-failure")) check(Arrays.equals(original, Files.readAllBytes(source.toPath())), "Failed open changed source");
        return;
      }
      check(Arrays.equals(original, Files.readAllBytes(source.toPath())), "Failure damaged the source: " + mode);
      if (mode.equals("mutator-failure")) check(promise.failure.getMessage().equals("mutator failure"), "Mutation did not run");
      if (mode.equals("input-failure")) check(promise.failure.getMessage().equals("input failure"), "Input failure hidden");
      if (mode.equals("wav-lyrics-unsupported")) check(promise.failure instanceof UnsupportedOperationException, "WAV INFO must reject unsupported lyrics");
      if (Set.of("partial-write", "close-failure").contains(mode)) {
        check(resolver.writes == 2, "Write must be attempted and original restored: " + promise.failure);
      } else {
        check(resolver.writes == 0, "Invalid input/mutation must not open source for writing");
      }
      if (mode.equals("unknown-format") || mode.equals("unsupported-aac") || mode.equals("unsupported-opus")) {
        check(promise.failure.getMessage().contains("不支持") || promise.failure.getMessage().contains("无法确定"), "Unknown/unsupported format must have explicit error: " + promise.failure);
      }
    }
    check(Objects.requireNonNull(staging.list()).length == 0, "Temporary files leaked");
    System.out.println("PASS " + mode + " " + format);
  }
}
