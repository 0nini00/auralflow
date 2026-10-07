package cn.chenle.auralflow.mobile;

import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.logging.*;
import org.jaudiotagger.audio.*;
import org.jaudiotagger.tag.*;
import org.jaudiotagger.tag.images.*;

class AudioAssetsBaseModule {
  boolean invalidated;
  public void invalidate() { invalidated = true; }
}

public final class LocalAudioAssetsHarness extends AudioAssetsBaseModule {
  private final File cache;
  private final ContentResolver resolver;
  private final Object writeActivityEventListener = new Object();
  private LocalAudioAssetsHarness(File cache, ContentResolver resolver) {
    this.cache = cache;
    this.resolver = resolver;
  }
  private LocalAudioAssetsHarness getReactApplicationContext() { return this; }
  private File getCacheDir() { return cache; }
  private ContentResolver getContentResolver() { return resolver; }
  private void removeActivityEventListener(Object listener) { check(listener == writeActivityEventListener, "Wrong listener"); }
  private static final class Uri {
    final URI value;
    Uri(URI value) { this.value = value; }
    static Uri parse(String text) { return new Uri(URI.create(text)); }
    static Uri fromFile(File file) { return new Uri(file.toURI()); }
    String getScheme() { return value.getScheme(); }
    String getPath() { return value.getPath(); }
    String getLastPathSegment() { return new File(value.getPath()).getName(); }
    public String toString() { return value.toString(); }
  }
  private static final class OpenableColumns { static final String DISPLAY_NAME = "_display_name"; }
  private static final class MediaStore {
    static final class Audio { static final class Media { static final String DATA = "_data"; } }
  }
  private static final class Cursor implements AutoCloseable {
    final String text;
    Cursor(String text) { this.text = text; }
    boolean moveToFirst() { return text != null; }
    int getColumnIndex(String key) { return 0; }
    boolean isNull(int column) { return text == null; }
    String getString(int column) { return text; }
    public void close() {}
  }
  private static final class ContentResolver {
    final File source;
    String name;
    String mime;
    String data;
    String fault = "";
    final CountDownLatch opened = new CountDownLatch(1);
    final CountDownLatch unblock = new CountDownLatch(1);
    ContentResolver(File source) { this.source = source; name = source.getName(); }
    Cursor query(Uri uri, String[] columns, String where, String[] args, String order) {
      check(!Thread.currentThread().getName().equals("main"), "Query blocked bridge thread");
      if (fault.equals("metadata")) throw new IllegalArgumentException("Provider has no metadata columns");
      return new Cursor(columns[0].equals(OpenableColumns.DISPLAY_NAME) ? name : data);
    }
    String getType(Uri uri) {
      if (fault.equals("metadata")) throw new SecurityException("MIME unavailable");
      return mime;
    }
    InputStream openInputStream(Uri uri) throws IOException {
      check(!Thread.currentThread().getName().equals("main"), "Source read blocked bridge thread");
      opened.countDown();
      if (fault.equals("null")) return null;
      if (fault.equals("unreadable")) throw new FileNotFoundException("Source unavailable");
      if (fault.equals("security")) throw new SecurityException("No read grant");
      if (fault.equals("stream")) return new InputStream() {
        public int read() throws IOException { throw new IOException("Stream disconnected"); }
      };
      if (fault.equals("slow")) {
        try { check(unblock.await(3, TimeUnit.SECONDS), "Blocked stream timeout"); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException(e); }
      }
      return new FileInputStream(source);
    }
  }
  private static final class WritableMap {
    final Map<String, Object> values = new HashMap<>();
    void putString(String key, String value) { values.put(key, value); }
    void putArray(String key, WritableArray value) { values.put(key, value.values); }
  }
  private static final class WritableArray {
    final List<String> values = new ArrayList<>();
    void pushString(String value) { values.add(value); }
  }
  private static final class Arguments {
    static WritableMap createMap() { return new WritableMap(); }
    static WritableArray createArray() { return new WritableArray(); }
  }
  private static final class Promise {
    final CountDownLatch done = new CountDownLatch(1);
    volatile WritableMap result;
    volatile Throwable error;
    void resolve(Object value) { result = (WritableMap) value; done.countDown(); }
    void reject(String code, Throwable value) { error = value; done.countDown(); }
    Map<String, Object> await() throws Exception {
      check(done.await(4, TimeUnit.SECONDS), "Promise never settled");
      if (error != null) throw new IOException("Native rejected", error);
      check(result != null, "Missing result");
      check(result.values.get("signature") instanceof String, "Missing signature");
      check(result.values.get("warnings") instanceof List, "Missing warnings");
      check(Set.of("signature", "lyrics", "coverUri", "warnings").containsAll(result.values.keySet()), "Unexpected API fields");
      return result.values;
    }
  }
  /* NATIVE_READ_METHODS */

  private static final String LYRICS = "[00:00.00]内嵌歌词\n[00:00.20]第二行";
  private static final byte[] COVER = Base64.getDecoder().decode(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=");
  private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
  private static byte[] hash(File file) throws Exception { return MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath())); }
  private static File copy(File root, String format, String name) throws Exception {
    File file = new File(root, name);
    Files.copy(new File(root.getParentFile(), "fixture." + format).toPath(), file.toPath());
    return file;
  }
  private static void tag(File file, String lyrics, boolean cover) throws Exception {
    AudioFile audio = AudioFileIO.read(file);
    Tag tag = audio.getTagOrCreateAndSetDefault();
    if (lyrics != null) tag.setField(FieldKey.LYRICS, lyrics);
    if (cover) {
      Artwork artwork = ArtworkFactory.getNew();
      artwork.setBinaryData(COVER);
      artwork.setMimeType("image/png");
      artwork.setPictureType(3);
      tag.setField(artwork);
    }
    audio.commit();
  }
  private static Map<String, Object> read(File cache, File file, ContentResolver resolver, boolean content) throws Exception {
    return read(cache, file, resolver, content ? "content://downloads/document/42" : file.toURI().toString());
  }
  private static Map<String, Object> read(File cache, File file, ContentResolver resolver, String uri) throws Exception {
    byte[] original = hash(file);
    LocalAudioAssetsHarness module = new LocalAudioAssetsHarness(cache, resolver);
    Promise promise = new Promise();
    try {
      module.readAudioAssets(uri, promise);
      Map<String, Object> result = promise.await();
      check(Arrays.equals(original, hash(file)), "Reader changed original audio hash");
      check(result.get("signature").toString().matches("[0-9a-f]{64}"), "Expected stable SHA-256 signature");
      return result;
    } finally {
      module.invalidate();
      check(module.audioAssetsExecutor.awaitTermination(3, TimeUnit.SECONDS), "Executor leaked");
    }
  }
  private static Map<String, Object> read(File cache, File file) throws Exception {
    return read(cache, file, new ContentResolver(file), false);
  }
  private static List<?> warnings(Map<String, Object> result) { return (List<?>) result.get("warnings"); }
  private static byte[] coverBytes(Map<String, Object> result) throws Exception {
    String uri = (String) result.get("coverUri");
    check(uri != null && uri.startsWith("file:"), "Cover must be a local file URI");
    return Files.readAllBytes(new File(URI.create(uri)).toPath());
  }
  private static void empty(Map<String, Object> result) {
    check(!result.containsKey("lyrics") && !result.containsKey("coverUri"), "Missing assets must omit fields");
  }
  private static void fileUrls(File root, File cache, String mode) throws Exception {
    List<String> names;
    switch (mode) {
      case "file-space": names = List.of("Artist - Song.mp3"); break;
      case "file-hash": names = List.of("Song#1.mp3"); break;
      case "file-percent": names = List.of("100%.mp3", "Song%20take.mp3", "Song%23one.mp3", "Song%2520.mp3"); break;
      case "file-unicode": names = List.of("中文歌曲.mp3", "歌手 - 歌曲#100%.mp3"); break;
      default: throw new AssertionError(mode);
    }
    for (String name : names) {
      File file = copy(root, "mp3", name);
      String lyrics = LYRICS + "\n" + name;
      tag(file, lyrics, true);
      // 同时放置解码后的不同文件，证明百分号原样路径优先，且编码 URI 只解码一次。
      String decodedName = name.replace("%20", " ").replace("%23", "#").replace("%25", "%");
      if (!decodedName.equals(name)) {
        File decoy = copy(root, "mp3", decodedName);
        tag(decoy, "must not read the decoded-name decoy", false);
      }
      String raw = "file://" + file.toURI().getPath();
      String encoded = new URI("file", "", file.toURI().getPath(), null).toASCIIString();
      Map<String, Object> literalResult = read(cache, file, new ContentResolver(file), raw);
      check(lyrics.equals(literalResult.get("lyrics")), "Wrong raw filename read: " + raw);
      check(warnings(literalResult).isEmpty(), "Unexpected raw file warning: " + raw);
      check(Arrays.equals(COVER, coverBytes(literalResult)), "Raw URL lost cover: " + raw);
      Map<String, Object> encodedResult = read(cache, file, new ContentResolver(file), encoded);
      check(literalResult.equals(encodedResult), "Raw/encoded URI must read the same file without double decoding: " + encoded);
    }
  }
  private static void uriBoundaries(File root, File cache) throws Exception {
    File file = copy(root, "mp3", "valid.mp3"); tag(file, LYRICS, true);
    byte[] original = hash(file);
    String path = file.toURI().getRawPath();
    for (String uri : List.of(
        "file://host" + path, "file://localhost" + path, "https://example.test" + path,
        "content://downloads/document/Artist - Song.mp3", "content://downloads/document/Song#1.mp3",
        "content://downloads/document/100%.mp3", "content:///document/1",
        "file:///missing raw song.mp3", "file:///missing%bogus.mp3", "file://" + path + "#fragment",
        "file://" + path + "?query=1")) {
      LocalAudioAssetsHarness module = new LocalAudioAssetsHarness(cache, new ContentResolver(file));
      Promise promise = new Promise();
      try {
        module.readAudioAssets(uri, promise);
        check(promise.done.await(3, TimeUnit.SECONDS) && promise.error != null, "Invalid/nonlocal URI was accepted: " + uri);
        check(Arrays.equals(original, hash(file)), "Rejected URI changed original file");
      } finally {
        module.invalidate();
        check(module.audioAssetsExecutor.awaitTermination(3, TimeUnit.SECONDS), "URI rejection leaked executor");
      }
    }
    Map<String, Object> encodedContent = read(cache, file, new ContentResolver(file),
        "content://downloads/document/Artist%20-%20Song%231%25.mp3");
    check(LYRICS.equals(encodedContent.get("lyrics")), "Valid encoded content URI was rejected");
  }
  private static void embedded(File root, File cache) throws Exception {
    for (String ext : List.of("mp3", "flac", "m4a")) {
      File file = copy(root, ext, "tagged." + ext);
      tag(file, LYRICS, true);
      File renamed = new File(root, "下载 " + ext + ".wrong");
      Files.move(file.toPath(), renamed.toPath());
      Files.writeString(new File(root, "下载 " + ext + ".lrc").toPath(), "sidecar must not win");
      Files.write(new File(root, "下载 " + ext + ".png").toPath(), COVER);
      Map<String, Object> first = read(cache, renamed);
      check(LYRICS.equals(first.get("lyrics")), "Embedded lyrics not preferred: " + ext);
      check(Arrays.equals(COVER, coverBytes(first)), "Embedded cover mismatch: " + ext);
      check(new File(URI.create(first.get("coverUri").toString())).getParentFile().equals(new File(cache, "auralflow/covers")), "Embedded cover outside managed cover cache");
      check(warnings(first).isEmpty(), "Unexpected file warning: " + first);
      Map<String, Object> again = read(cache, renamed);
      check(first.equals(again), "Repeated read must reuse signature and completed cover URI");
      ContentResolver resolver = new ContentResolver(renamed);
      resolver.name = "incorrect.mp3";
      resolver.mime = "audio/mpeg";
      Map<String, Object> content = read(cache, renamed, resolver, true);
      check(LYRICS.equals(content.get("lyrics")), "Content URI real format was ignored: " + ext);
      check(Arrays.equals(COVER, coverBytes(content)), "Content cover mismatch");
    }
    File bare = copy(root, "bare.mp3", "bare.mp3");
    empty(read(cache, bare));
  }
  private static void sidecars(File root, File cache) throws Exception {
    File dir = new File(root, "Downloads.v1"); check(dir.mkdir(), "Directory creation");
    File file = new File(dir, "Track.flac");
    Files.copy(new File(root.getParentFile(), "fixture.flac").toPath(), file.toPath());
    File lrc = new File(dir, "Track.LRC");
    String text = "[00:00.00]旁挂歌词\r\n";
    Files.writeString(lrc.toPath(), "\ufeff" + text);
    File same = new File(dir, "Track.PNG"); Files.write(same.toPath(), COVER);
    File cover = new File(dir, "cover.jpg"); Files.write(cover.toPath(), COVER);
    File folder = new File(dir, "folder.png"); Files.write(folder.toPath(), COVER);
    Map<String, Object> result = read(cache, file);
    check(text.equals(result.get("lyrics")), "UTF-8 BOM/case-insensitive LRC read failed");
    check(new File(URI.create(result.get("coverUri").toString())).equals(same), "Same-name cover must beat cover/folder");
    ContentResolver resolver = new ContentResolver(file); resolver.data = file.getAbsolutePath();
    check(read(cache, file, resolver, true).get("lyrics").equals(text), "MediaStore content sidecar missing");
    Files.delete(same.toPath());
    check(new File(URI.create(read(cache, file).get("coverUri").toString())).equals(cover), "cover must beat folder");
    Files.delete(cover.toPath());
    check(Arrays.equals(COVER, coverBytes(read(cache, file))), "folder cover missing");
    Files.delete(folder.toPath()); Files.delete(lrc.toPath());
    empty(read(cache, file));
    File noExtension = new File(dir, "Track"); Files.move(file.toPath(), noExtension.toPath());
    Files.writeString(new File(dir, "Track.lrc").toPath(), text);
    check(text.equals(read(cache, noExtension).get("lyrics")), "Dotted parent or absent extension broke sidecar stem");
  }
  private static void signature(File root, File cache) throws Exception {
    File file = copy(root, "mp3", "state.mp3");
    Map<String, Object> initial = read(cache, file);
    check(initial.get("signature").equals(read(cache, file).get("signature")), "Unstable signature");
    File lrc = new File(root, "state.lrc"); Files.writeString(lrc.toPath(), "first");
    String before = read(cache, file).get("signature").toString();
    check(!before.equals(initial.get("signature")), "Sidecar addition didn't invalidate");
    long modified = lrc.lastModified(); Files.writeString(lrc.toPath(), "other"); check(lrc.setLastModified(modified), "mtime reset");
    String after = read(cache, file).get("signature").toString();
    check(!before.equals(after), "Same-size/mtime lyric content didn't invalidate");
    File cover = new File(root, "state.png"); Files.write(cover.toPath(), COVER);
    String coverBefore = read(cache, file).get("signature").toString();
    byte[] changed = COVER.clone(); changed[changed.length - 1] ^= 1;
    modified = cover.lastModified(); Files.write(cover.toPath(), changed); check(cover.setLastModified(modified), "cover mtime reset");
    check(!coverBefore.equals(read(cache, file).get("signature")), "Cover content didn't invalidate");
    String beforeAudioChange = read(cache, file).get("signature").toString();
    long originalTime = file.lastModified(); byte[] audio = Files.readAllBytes(file.toPath());
    audio[audio.length - 1] ^= 1; Files.write(file.toPath(), audio); check(file.setLastModified(originalTime), "audio mtime reset");
    check(!beforeAudioChange.equals(read(cache, file).get("signature")), "Source content didn't invalidate");
    String withSidecars = read(cache, file).get("signature").toString();
    Files.delete(lrc.toPath()); Files.delete(cover.toPath());
    check(!withSidecars.equals(read(cache, file).get("signature")), "Removal didn't invalidate");
  }
  private static void limits(File root, File cache) throws Exception {
    check(LocalAudioAssetsReader.MAX_LYRICS_BYTES == 1024 * 1024, "1 MiB rule drifted");
    File file = copy(root, "flac", "limit.flac");
    File lrc = new File(root, "limit.lrc");
    Files.writeString(lrc.toPath(), "x".repeat(1024 * 1024));
    check(((String) read(cache, file).get("lyrics")).length() == 1024 * 1024, "Exact limit rejected");
    Files.writeString(lrc.toPath(), "x".repeat(1024 * 1024 + 1));
    Map<String, Object> oversized = read(cache, file);
    check(!oversized.containsKey("lyrics") && !warnings(oversized).isEmpty(), "Oversized LRC silently accepted");
    tag(file, "界".repeat(350000), true);
    Files.writeString(lrc.toPath(), "usable fallback");
    Map<String, Object> embedded = read(cache, file);
    check("usable fallback".equals(embedded.get("lyrics")) && !warnings(embedded).isEmpty(), "Embedded limit is not UTF-8 byte based");
    check(Arrays.equals(COVER, coverBytes(embedded)), "Lyrics failure suppressed independent cover");
    File invalid = copy(root, "mp3", "invalid.mp3");
    Files.write(new File(root, "invalid.lrc").toPath(), new byte[] {(byte) 0xc3, 0x28});
    Files.writeString(new File(root, "invalid.jpg").toPath(), "not an image");
    Map<String, Object> result = read(cache, invalid);
    empty(result); check(warnings(result).size() >= 2, "Bad sidecars silently accepted");
  }
  private static void failures(File root, File cache) throws Exception {
    for (String ext : List.of("aac", "opus")) {
      File file = copy(root, ext, "unsupported-" + ext + ".mp3");
      Files.writeString(new File(root, "unsupported-" + ext + ".lrc").toPath(), "fallback");
      Map<String, Object> result = read(cache, file);
      check("fallback".equals(result.get("lyrics")) && !warnings(result).isEmpty(), "Unsupported format must warn and still read sidecar");
    }
    File broken = new File(root, "broken.mp3"); Files.writeString(broken.toPath(), "not audio");
    Map<String, Object> result = read(cache, broken); empty(result); check(!warnings(result).isEmpty(), "Malformed audio masked");
    File file = copy(root, "flac", "content.flac"); tag(file, LYRICS, true);
    ContentResolver metadata = new ContentResolver(file); metadata.fault = "metadata";
    result = read(cache, file, metadata, true);
    check(LYRICS.equals(result.get("lyrics")) && !warnings(result).isEmpty(), "Metadata failure must not hide readable stream");
    ContentResolver isolated = new ContentResolver(broken);
    check(!warnings(read(cache, broken, isolated, true)).isEmpty(), "Inaccessible content siblings must be explicit");
    for (String fault : List.of("unreadable", "null", "stream", "security")) {
      ContentResolver resolver = new ContentResolver(file); resolver.fault = fault;
      LocalAudioAssetsHarness module = new LocalAudioAssetsHarness(cache, resolver);
      Promise promise = new Promise(); module.readAudioAssets("content://downloads/42", promise);
      check(promise.done.await(3, TimeUnit.SECONDS) && promise.error != null, "Unreadable source resolved: " + fault);
      module.invalidate(); check(module.audioAssetsExecutor.awaitTermination(3, TimeUnit.SECONDS), "Leaked failure executor");
    }
    for (String uri : Arrays.asList(null, "", "https://example.test/a.mp3", "ftp://localhost/a", "relative.mp3", "content:///42", "file:relative", "file:///bad%xx", new File(root, "missing.mp3").toURI().toString())) {
      LocalAudioAssetsHarness module = new LocalAudioAssetsHarness(cache, new ContentResolver(file));
      Promise promise = new Promise(); module.readAudioAssets(uri, promise);
      check(promise.done.await(3, TimeUnit.SECONDS) && promise.error != null, "Invalid/unreadable URI resolved: " + uri);
      module.invalidate(); check(module.audioAssetsExecutor.awaitTermination(3, TimeUnit.SECONDS), "Leaked invalid-URI executor");
    }
  }
  private static void publication(File root, File cache) throws Exception {
    File file = copy(root, "mp3", "publication.mp3"); tag(file, LYRICS, true);
    String coverHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(COVER));
    File coverCache = new File(cache, "auralflow/covers");
    check(coverCache.mkdirs(), "Cannot create managed cover cache");
    File target = new File(coverCache, "local-asset-" + coverHash + ".png");
    check(target.mkdir(), "Cannot create publication failure fixture");
    Map<String, Object> failed = read(cache, file);
    check(LYRICS.equals(failed.get("lyrics")), "Cover export failure suppressed lyrics");
    check(!failed.containsKey("coverUri") && !warnings(failed).isEmpty(), "Cover export failure masked");
    Files.delete(target.toPath());
    Map<String, Object> recovered = read(cache, file);
    check(Arrays.equals(COVER, coverBytes(recovered)) && warnings(recovered).isEmpty(), "Publish did not recover");
    check(!failed.get("signature").equals(recovered.get("signature")), "Recovered asset did not invalidate signature");
    check(target.isFile(), "Content-addressed complete cover not published");
    Files.delete(target.toPath());
    check(Arrays.equals(COVER, coverBytes(read(cache, file))), "Cache eviction did not regenerate cover");
    AudioFile audio = AudioFileIO.read(file);
    Tag tag = audio.getTag(); tag.deleteField(FieldKey.COVER_ART);
    Artwork invalid = ArtworkFactory.getNew(); invalid.setBinaryData(new byte[] {1, 2, 3});
    invalid.setMimeType("image/png"); invalid.setPictureType(3); tag.setField(invalid); audio.commit();
    Map<String, Object> corrupt = read(cache, file);
    check(LYRICS.equals(corrupt.get("lyrics")) && !corrupt.containsKey("coverUri") && !warnings(corrupt).isEmpty(),
        "Invalid embedded cover did not fail independently");
    File sidecar = new File(root, "publication.png"); Files.write(sidecar.toPath(), COVER);
    Map<String, Object> fallback = read(cache, file);
    check(Arrays.equals(COVER, coverBytes(fallback)) && !warnings(fallback).isEmpty(), "Cover failure lost usable sidecar");
  }
  private static void async(File root, File cache) throws Exception {
    File file = copy(root, "flac", "async.flac");
    ContentResolver resolver = new ContentResolver(file); resolver.fault = "slow";
    LocalAudioAssetsHarness module = new LocalAudioAssetsHarness(cache, resolver);
    Promise first = new Promise(); Promise queued = new Promise();
    module.readAudioAssets("content://downloads/42", first);
    check(resolver.opened.await(2, TimeUnit.SECONDS), "Worker did not start");
    check(first.done.getCount() == 1, "Blocking source unexpectedly completed");
    module.readAudioAssets("content://downloads/43", queued);
    module.invalidate(); check(module.invalidated, "super.invalidate was not called");
    Promise late = new Promise(); module.readAudioAssets("content://downloads/44", late);
    check(late.done.await(1, TimeUnit.SECONDS) && late.error != null, "Submission after invalidation must reject");
    resolver.unblock.countDown(); first.await(); queued.await();
    check(module.audioAssetsExecutor.awaitTermination(3, TimeUnit.SECONDS), "Lifecycle executor leak");
  }
  public static void main(String[] args) throws Exception {
    Logger.getLogger("org.jaudiotagger").setLevel(Level.OFF);
    File root = new File(args[0], args[1]); check(root.mkdir(), "Test directory exists");
    File cache = new File(root, "cache"); check(cache.mkdir(), "Cache creation");
    switch (args[1]) {
      case "file-space": case "file-hash": case "file-percent": case "file-unicode":
        fileUrls(root, cache, args[1]); break;
      case "uri-boundaries": uriBoundaries(root, cache); break;
      case "embedded": embedded(root, cache); break;
      case "sidecars": sidecars(root, cache); break;
      case "signature": signature(root, cache); break;
      case "limits": limits(root, cache); break;
      case "failures": failures(root, cache); break;
      case "async": async(root, cache); break;
      case "publication": publication(root, cache); break;
      default: throw new AssertionError(args[1]);
    }
    try (java.util.stream.Stream<Path> paths = Files.walk(cache.toPath())) {
      paths.filter(Files::isRegularFile).forEach(path -> {
        String name = path.getFileName().toString();
        check(!name.endsWith(".tmp") && !name.startsWith("af_audio_"), "Partial/cache snapshot leaked: " + path);
        check(name.matches("local-asset-[0-9a-f]{64}\\.(png|jpg|gif|webp)"), "Unmanaged cover filename: " + path);
        check(path.getParent().equals(new File(cache, "auralflow/covers").toPath()), "Unmanaged cover directory: " + path);
      });
    }
    System.out.println("PASS " + args[1]);
  }
}
