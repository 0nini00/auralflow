package cn.chenle.auralflow.mobile;

import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.images.Artwork;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** 只读音频资料快照。唯一写入目标为应用 cache，不使用标签 Writer 或媒体数据库写接口。 */
final class LocalAudioAssetsReader {
  static final int MAX_LYRICS_BYTES = 1024 * 1024;
  // 与桌面端内嵌封面上限一致，避免把异常标签作为图片导出。
  private static final int MAX_COVER_BYTES = 10 * 1024 * 1024;
  private static final int BUFFER_SIZE = 8192;
  private static final String[] COVER_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"};

  interface Source {
    InputStream openInput() throws IOException;
  }

  static final class Result {
    final String signature;
    final String lyrics;
    final File coverFile;
    final List<String> warnings;

    Result(String signature, Assets assets) {
      this.signature = signature;
      lyrics = assets.lyrics;
      coverFile = assets.coverFile;
      warnings = Collections.unmodifiableList(new ArrayList<>(assets.warnings));
    }
  }

  private static final class Assets {
    String lyrics;
    File coverFile;
    byte[] coverBytes;
    final List<String> warnings = new ArrayList<>();

    void warn(String item, Exception error) {
      warnings.add(item + ": " + error.getClass().getSimpleName() + ": " + error.getMessage());
    }
  }

  private LocalAudioAssetsReader() {}

  static Result read(File cache, String displayName, String mime, Source source, File localFile)
      throws IOException {
    Assets assets = new Assets();
    MessageDigest signature = newDigest();
    // 复制与摘要在同一次流读取中完成；格式识别只操作缓存快照，错误后也不触碰源文件。
    try (TemporaryFile snapshot = new TemporaryFile(cache, "af_audio_", ".tmp")) {
      try (InputStream in = source.openInput(); FileOutputStream out = new FileOutputStream(snapshot.file)) {
        if (in == null) throw new IOException("媒体提供方未返回可读音频流");
        byte[] buffer = new byte[BUFFER_SIZE];
        int count;
        while ((count = in.read(buffer)) != -1) {
          checkInterrupted();
          signature.update(buffer, 0, count);
          out.write(buffer, 0, count);
        }
      }
      readEmbedded(cache, snapshot, displayName, mime, assets);
      if (assets.lyrics == null || assets.coverFile == null) readSidecars(localFile, assets);
    }
    // 把实际选中的旁挂内容纳入摘要，即使文件大小/mtime 未变也能使在线缓存失效。
    update(signature, "lyrics");
    update(signature, assets.lyrics == null ? "" : assets.lyrics);
    update(signature, "cover");
    if (assets.coverBytes != null) signature.update(assets.coverBytes);
    if (assets.coverFile != null) update(signature, assets.coverFile.toURI().toString());
    return new Result(hex(signature.digest()), assets);
  }

  private static void readEmbedded(File cache, TemporaryFile snapshot, String displayName,
      String mime, Assets assets) {
    String suffix;
    try {
      suffix = LocalTagEditor.resolveSuffix(snapshot.file, displayName, mime);
    } catch (IOException error) {
      assets.warn("FORMAT_UNSUPPORTED", error);
      return;
    }
    Tag tag;
    try {
      snapshot.useSuffix(suffix);
      tag = AudioFileIO.read(snapshot.file).getTag();
    } catch (Exception error) {
      assets.warn("EMBEDDED_READ_FAILED", error);
      return;
    }
    if (tag == null) return;
    try {
      assets.lyrics = checkedLyrics(tag.getFirst(FieldKey.LYRICS));
    } catch (Exception error) {
      assets.warn("EMBEDDED_LYRICS_FAILED", error);
    }
    try {
      Artwork artwork = tag.getFirstArtwork();
      if (artwork == null) return;
      byte[] bytes = artwork.getBinaryData();
      String extension = imageExtension(bytes);
      assets.coverFile = publishCover(cache, bytes, extension);
      assets.coverBytes = bytes;
    } catch (Exception error) {
      assets.warn("EMBEDDED_COVER_FAILED", error);
    }
  }

  private static void readSidecars(File audioFile, Assets assets) {
    if (audioFile == null) {
      assets.warnings.add("SIDECAR_UNAVAILABLE: content URI 未提供可访问的本地目录，无法读取旁挂资料");
      return;
    }
    File[] files;
    try {
      File parent = audioFile.getParentFile();
      files = parent == null ? null : parent.listFiles();
      if (files == null) throw new IOException("无法枚举音频所在目录：" + parent);
    } catch (Exception error) {
      assets.warn("SIDECAR_DIRECTORY_FAILED", error);
      return;
    }
    Arrays.sort(files, Comparator.comparing(File::getName));
    String name = audioFile.getName();
    int dot = name.lastIndexOf('.');
    String stem = dot > 0 ? name.substring(0, dot) : name;
    if (assets.lyrics == null) {
      File lrc = find(files, stem + ".lrc");
      if (lrc != null) {
        try {
          byte[] bytes = readBounded(lrc, MAX_LYRICS_BYTES);
          String text = StandardCharsets.UTF_8.newDecoder()
              .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
              .decode(ByteBuffer.wrap(bytes)).toString();
          assets.lyrics = checkedLyrics(text);
        } catch (Exception error) {
          assets.warn("SIDECAR_LYRICS_FAILED", error);
        }
      }
    }
    if (assets.coverFile != null) return;
    for (String base : new String[] {stem, "cover", "folder"}) {
      for (String extension : COVER_EXTENSIONS) {
        File cover = find(files, base + "." + extension);
        if (cover == null) continue;
        try {
          byte[] bytes = readBounded(cover, MAX_COVER_BYTES);
          imageExtension(bytes);
          assets.coverFile = cover;
          assets.coverBytes = bytes;
          return;
        } catch (Exception error) {
          assets.warn("SIDECAR_COVER_FAILED", error);
        }
      }
    }
  }

  private static File find(File[] files, String name) {
    for (File file : files) {
      if (file.getName().equalsIgnoreCase(name)) return file;
    }
    return null;
  }

  private static String checkedLyrics(String lyrics) throws IOException {
    if (lyrics == null) return null;
    if (lyrics.getBytes(StandardCharsets.UTF_8).length > MAX_LYRICS_BYTES) {
      throw new IOException("歌词超过 1 MiB 上限");
    }
    String text = lyrics.startsWith("\ufeff") ? lyrics.substring(1) : lyrics;
    return text.trim().isEmpty() ? null : text;
  }

  private static byte[] readBounded(File file, int limit) throws IOException {
    if (!file.isFile()) throw new IOException("资料不是普通文件：" + file);
    if (file.length() > limit) throw new IOException("资料超过字节上限 " + limit + "：" + file);
    try (InputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[BUFFER_SIZE];
      int count;
      while ((count = in.read(buffer)) != -1) {
        checkInterrupted();
        if (count > limit - out.size()) throw new IOException("资料超过字节上限 " + limit + "：" + file);
        out.write(buffer, 0, count);
      }
      return out.toByteArray();
    }
  }

  private static String imageExtension(byte[] bytes) throws IOException {
    if (bytes == null || bytes.length == 0) throw new IOException("封面没有内嵌图片数据");
    if (bytes.length > MAX_COVER_BYTES) throw new IOException("封面超过 10 MiB 上限");
    if (bytes.length >= 8 && (bytes[0] & 0xff) == 0x89 && matches(bytes, 1, "PNG\r\n\u001a\n")) return "png";
    if (bytes.length >= 3 && (bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8
        && (bytes[2] & 0xff) == 0xff) return "jpg";
    if (matches(bytes, 0, "GIF87a") || matches(bytes, 0, "GIF89a")) return "gif";
    if (matches(bytes, 0, "RIFF") && matches(bytes, 8, "WEBP")) return "webp";
    throw new IOException("无法识别封面图片格式");
  }

  private static boolean matches(byte[] bytes, int offset, String magic) {
    if (bytes.length < offset + magic.length()) return false;
    for (int i = 0; i < magic.length(); i++) {
      if ((bytes[offset + i] & 0xff) != magic.charAt(i)) return false;
    }
    return true;
  }

  private static File publishCover(File cache, byte[] bytes, String extension) throws IOException {
    // 复用主端已管理的封面目录，纳入统计、容量回收与清空，不建立独立永久缓存。
    File coverCache = new File(cache, "auralflow/covers");
    if (!coverCache.mkdirs() && !coverCache.isDirectory()) {
      throw new IOException("无法创建受管理的封面缓存目录：" + coverCache);
    }
    File published = new File(coverCache, "local-asset-" + hex(newDigest().digest(bytes)) + "." + extension);
    if (published.exists() && Arrays.equals(bytes, readBounded(published, MAX_COVER_BYTES))) return published;
    try (TemporaryFile temporary = new TemporaryFile(coverCache, "local-asset-", ".tmp")) {
      try (FileOutputStream out = new FileOutputStream(temporary.file)) {
        out.write(bytes);
        out.getFD().sync();
      }
      // 同目录 rename 只在完整写入和关闭后发布；消费者永远看不到半张封面。
      if (!temporary.file.renameTo(published)) throw new IOException("无法发布缓存封面：" + published);
    }
    return published;
  }

  private static MessageDigest newDigest() {
    try {
      return MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("系统缺少 SHA-256", error);
    }
  }

  private static void update(MessageDigest digest, String text) {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
    digest.update(bytes);
  }

  private static String hex(byte[] bytes) {
    StringBuilder result = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) {
      result.append(Character.forDigit((value >>> 4) & 15, 16));
      result.append(Character.forDigit(value & 15, 16));
    }
    return result.toString();
  }

  private static void checkInterrupted() throws InterruptedIOException {
    if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("本地资料读取已取消");
  }

  private static final class TemporaryFile implements AutoCloseable {
    File file;

    TemporaryFile(File cache, String prefix, String suffix) throws IOException {
      file = File.createTempFile(prefix, suffix, cache);
    }

    void useSuffix(String suffix) throws IOException {
      File named = new File(file.getParentFile(), file.getName() + "." + suffix);
      if (!file.renameTo(named)) throw new IOException("无法设置缓存快照的真实扩展名");
      file = named;
    }

    @Override
    public void close() throws IOException {
      if (file.exists() && !file.delete()) throw new IOException("无法清理资料读取临时文件：" + file);
    }
  }
}
