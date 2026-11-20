package cn.chenle.auralflow.mobile;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.logging.*;
import org.jaudiotagger.audio.*;
import org.jaudiotagger.tag.*;
import org.jaudiotagger.tag.images.*;

class DownloadTagBaseModule { public void invalidate() {} }

public final class DownloadTagHarness extends DownloadTagBaseModule {
  private final File files;
  private final File cache;
  private DownloadTagHarness(File root) throws IOException {
    files = new File(root, "files"); cache = new File(root, "cache");
    Files.createDirectories(files.toPath()); Files.createDirectories(cache.toPath());
  }
  private DownloadTagHarness getReactApplicationContext() { return this; }
  private File getFilesDir() { background(); return files; }
  private File getCacheDir() { background(); return cache; }
  private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
  private static void background() { check(!Thread.currentThread().getName().equals("main"), "File I/O ran on bridge caller"); }
  private static final class ReadableMap {
    final Map<String, String> values = Map.of("title", "Title", "artist", "Artist", "album", "Album", "lyrics", "[00:00.00]歌词");
    final CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1);
    boolean blocked;
    boolean hasKey(String key) { return values.containsKey(key); }
    boolean isNull(String key) { return !hasKey(key); }
    String getString(String key) {
      background(); started.countDown();
      if (blocked) {
        try { check(release.await(3, TimeUnit.SECONDS), "Write gate timeout"); }
        catch (InterruptedException error) { throw new RuntimeException(error); }
      }
      return values.get(key);
    }
  }
  private static final class Promise {
    final CountDownLatch done = new CountDownLatch(1);
    Throwable error;
    void resolve(Object value) { done.countDown(); }
    void reject(String code, Throwable error) { this.error = error; done.countDown(); }
    void await(boolean rejected) throws Exception {
      check(done.await(5, TimeUnit.SECONDS), "Promise never settled");
      check(rejected == (error != null), "Unexpected result: " + error);
    }
  }
  /* METHODS */
  public static void main(String[] args) throws Exception {
    Logger.getLogger("org.jaudiotagger").setLevel(Level.OFF);
    TagOptionSingleton.getInstance().setAndroid(true);
    File root = new File(args[0], args[1]);
    DownloadTagHarness module = new DownloadTagHarness(root);
    File audio = new File(module.files, "audio.part");
    Files.copy(new File(args[0], "fixture.mp3").toPath(), audio.toPath());
    ReadableMap metadata = new ReadableMap();
    Promise first = new Promise();
    try {
      switch (args[1]) {
        case "roundtrip": {
          byte[] png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=");
          File cover = new File(module.cache, "cover.tmp"); Files.write(cover.toPath(), png);
          module.writeMp3Tags(audio.getPath(), metadata, cover.getPath(), first); first.await(false);
          File readable = new File(module.files, "readable.mp3"); Files.copy(audio.toPath(), readable.toPath());
          Tag tag = AudioFileIO.read(readable).getTag();
          check("Title".equals(tag.getFirst(FieldKey.TITLE)), "Title missing");
          check("Artist".equals(tag.getFirst(FieldKey.ARTIST)), "Artist missing");
          check("Album".equals(tag.getFirst(FieldKey.ALBUM)), "Album missing");
          check("[00:00.00]歌词".equals(tag.getFirst(FieldKey.LYRICS)), "Lyrics missing");
          check(Arrays.equals(png, tag.getFirstArtwork().getBinaryData()), "Cover changed");
          check(new File(module.files, "local-tag-edit").list().length == 0, "Transaction files leaked");
          break;
        }
        case "invalid-input": {
          Files.writeString(audio.toPath(), "this is not mp3 audio"); byte[] original = Files.readAllBytes(audio.toPath());
          module.writeMp3Tags(audio.getPath(), metadata, null, first); first.await(true);
          check(Arrays.equals(original, Files.readAllBytes(audio.toPath())), "Invalid input overwritten");
          break;
        }
        case "private-path": {
          File outside = new File(root, "outside.part"); Files.copy(audio.toPath(), outside.toPath());
          byte[] original = Files.readAllBytes(outside.toPath());
          module.writeMp3Tags(outside.getPath(), metadata, null, first); first.await(true);
          check(Arrays.equals(original, Files.readAllBytes(outside.toPath())), "Outside file overwritten");
          Promise completed = new Promise(); File finalFile = new File(module.files, "completed.mp3");
          Files.copy(audio.toPath(), finalFile.toPath());
          module.writeMp3Tags(finalFile.getPath(), metadata, null, completed); completed.await(true);
          break;
        }
        case "lifecycle": {
          metadata.blocked = true;
          module.writeMp3Tags(audio.getPath(), metadata, null, first);
          check(metadata.started.await(3, TimeUnit.SECONDS), "Background write never started");
          File queuedFile = new File(module.files, "queued.part"); Files.copy(audio.toPath(), queuedFile.toPath());
          Promise queued = new Promise(); module.writeMp3Tags(queuedFile.getPath(), new ReadableMap(), null, queued);
          module.invalidate();
          Promise late = new Promise(); module.writeMp3Tags(audio.getPath(), new ReadableMap(), null, late); late.await(true);
          metadata.release.countDown(); first.await(false); queued.await(false);
          check(module.executor.awaitTermination(3, TimeUnit.SECONDS), "Executor did not terminate");
          break;
        }
        default: throw new AssertionError(args[1]);
      }
      System.out.println("PASS " + args[1]);
    } finally { metadata.release.countDown(); module.invalidate(); }
  }
}
