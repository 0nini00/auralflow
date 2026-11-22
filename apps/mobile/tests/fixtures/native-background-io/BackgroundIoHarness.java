package cn.chenle.auralflow.mobile;

import java.io.*;
import java.util.*;
import java.util.concurrent.*;

class BackgroundIoBaseModule { public void invalidate() {} }

public final class BackgroundIoHarness extends BackgroundIoBaseModule {
  private static final String MEDIA_STORE_SCOPE = "mediaStore:external:music";
  private static final int REQUEST_PICK_AUDIO = 1, REQUEST_UPDATE_AUDIO = 2, REQUEST_WRITE_AUDIO = 3;
  private static final String[] SIDECAR_COVER_NAMES = { "folder.jpg", "cover.jpg" };
  private final ExecutorService localIoExecutor = Executors.newSingleThreadExecutor();
  private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor();
  private final ExecutorService audioAssetsExecutor = Executors.newSingleThreadExecutor();
  private final Object writeActivityEventListener = new Object();
  private volatile boolean invalidated;
  private final ContentResolver resolver = new ContentResolver();
  private Promise pickAudioPromise;
  private PendingWrite writePending;
  private PendingMetadataUpdate updatePending;
  private BackgroundIoHarness getReactApplicationContext() { return this; }
  private ContentResolver getContentResolver() { return resolver; }
  private void emitScanProgress(int scanned, int total) {}
  private void removeActivityEventListener(Object listener) {}
  private static final class UiThreadUtil { static void runOnUiThread(Runnable action) { action.run(); } }
  private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
  private static void background() { check(!Thread.currentThread().getName().equals("main"), "I/O ran on main/bridge caller"); }
  private static final class Activity { static final int RESULT_OK = 1; }
  private static final class Uri { public String toString() { return "content://test/audio/1"; } }
  private static final class Intent {
    ClipData getClipData() { return null; }
    Uri getData() { return new Uri(); }
  }
  private static final class ClipData {
    int getItemCount() { return 1; }
    ClipData getItemAt(int index) { return this; }
    Uri getUri() { return new Uri(); }
  }
  private static final class ContentUris { static Uri withAppendedId(Uri uri, long id) { return uri; } }
  private static final class MediaStore {
    static final class Audio {
      static final class Media {
        static final Uri EXTERNAL_CONTENT_URI = new Uri();
        static final String _ID="id", TITLE="title", ARTIST="artist", ALBUM="album", ALBUM_ID="albumId",
          DURATION="duration", DATA="data", DATE_MODIFIED="modified", SIZE="size", IS_MUSIC="music";
      }
    }
  }
  private static final class ContentResolver {
    final CountDownLatch scanStarted = new CountDownLatch(1), releaseScan = new CountDownLatch(1);
    Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
      background(); scanStarted.countDown();
      try { check(releaseScan.await(3, TimeUnit.SECONDS), "Scan timed out"); }
      catch (InterruptedException error) { throw new RuntimeException(error); }
      return new Cursor(projection);
    }
    int update(Uri uri, Object values, String where, String[] args) { background(); return 1; }
  }
  private static final class Cursor implements AutoCloseable {
    final String[] columns;
    int row;
    Cursor(String[] columns) { this.columns = columns; }
    int getColumnIndexOrThrow(String column) { return Arrays.asList(columns).indexOf(column); }
    int getColumnCount() { return columns.length; }
    int getCount() { return 1; }
    boolean moveToNext() { return row++ == 0; }
    boolean isNull(int i) { return false; }
    long getLong(int i) { return i == 0 ? 1L : 0L; }
    String getString(int i) { return i == 6 ? "" : columns[i]; }
    public void close() {}
  }
  private static class ReadableMap {
    boolean hasKey(String key) { return false; }
    boolean isNull(String key) { return true; }
    String getString(String key) { return null; }
  }
  private static final class WritableMap {
    void putString(String key, String value) {}
    void putNull(String key) {}
    void putBoolean(String key, boolean value) {}
    void putDouble(String key, double value) {}
    void putArray(String key, WritableArray value) {}
  }
  private static final class WritableArray { void pushMap(WritableMap value) {} }
  private static final class Arguments {
    static WritableMap createMap() { return new WritableMap(); }
    static WritableArray createArray() { return new WritableArray(); }
  }
  private static final class Promise {
    final CountDownLatch done = new CountDownLatch(1);
    Throwable error;
    void resolve(Object value) { done.countDown(); }
    void reject(String code, Throwable error) { this.error = error; done.countDown(); }
    void reject(String code, String message) { reject(code, new IOException(message)); }
    void await(boolean rejected) throws Exception {
      check(done.await(3, TimeUnit.SECONDS), "Promise not settled");
      check(rejected == (error != null), "Unexpected rejection: " + error);
    }
  }
  private interface TagMutator {}
  private static final class PendingWrite {
    final Uri audioUri = new Uri();
    final TagMutator mutator = null;
    final Promise promise;
    PendingWrite(Promise promise) { this.promise = promise; }
  }
  private static final class PendingMetadataUpdate {
    final Uri audioUri = new Uri();
    final Object values = new Object();
    final Promise promise;
    PendingMetadataUpdate(Promise promise) { this.promise = promise; }
  }
  private void takeReadPermission(ContentResolver resolver, Uri uri, Intent data) { background(); }
  private WritableMap buildSongFromUri(ContentResolver resolver, Uri uri) { background(); return new WritableMap(); }
  private void writeTagToFile(Uri uri, TagMutator mutator, Promise promise) { background(); promise.resolve(true); }
  private static String resolveLyrics(File file) { background(); return null; }
  private static String resolveCover(ContentResolver resolver, long albumId, File file) { background(); return null; }
  /* CALLBACK */
  /* METHODS */
  public static void main(String[] args) throws Exception {
    BackgroundIoHarness module = new BackgroundIoHarness();
    try {
      Promise picked = new Promise(); module.pickAudioPromise = picked;
      module.onActivityResult(new Activity(), REQUEST_PICK_AUDIO, Activity.RESULT_OK, new Intent());
      picked.await(false);
      Promise written = new Promise(); module.writePending = new PendingWrite(written);
      module.onActivityResult(new Activity(), REQUEST_WRITE_AUDIO, Activity.RESULT_OK, null);
      written.await(false);
      Promise updated = new Promise(); module.updatePending = new PendingMetadataUpdate(updated);
      module.onActivityResult(new Activity(), REQUEST_UPDATE_AUDIO, Activity.RESULT_OK, null);
      updated.await(false);
      Promise scanned = new Promise(); module.scanLocalMusic(null, scanned);
      check(module.resolver.scanStarted.await(3, TimeUnit.SECONDS), "Scan never started");
      Promise independent = new Promise(); module.pickAudioPromise = independent;
      module.onActivityResult(new Activity(), REQUEST_PICK_AUDIO, Activity.RESULT_OK, new Intent());
      independent.await(false);
      Promise waitingPick = new Promise(), waitingWrite = new Promise(), waitingUpdate = new Promise();
      module.pickAudioPromise = waitingPick; module.writePending = new PendingWrite(waitingWrite);
      module.updatePending = new PendingMetadataUpdate(waitingUpdate);
      module.invalidate();
      waitingPick.await(true); waitingWrite.await(true); waitingUpdate.await(true);
      Promise late = new Promise(); module.scanLocalMusic(null, late); late.await(true);
      Promise latePick = new Promise(); module.pickAudioPromise = latePick;
      module.onActivityResult(new Activity(), REQUEST_PICK_AUDIO, Activity.RESULT_OK, new Intent());
      latePick.await(true);
      module.resolver.releaseScan.countDown(); scanned.await(false);
      System.out.println("PASS background");
    } finally {
      module.resolver.releaseScan.countDown(); module.scanExecutor.shutdown(); module.localIoExecutor.shutdown();
      module.audioAssetsExecutor.shutdown();
    }
  }
}
