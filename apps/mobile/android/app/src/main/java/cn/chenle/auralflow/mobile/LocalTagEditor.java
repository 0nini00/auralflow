package cn.chenle.auralflow.mobile;

import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.Tag;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** content URI 的标签编辑事务；只在缓存中修改标签，不转码音频。 */
final class LocalTagEditor {
  private static final int BUFFER_SIZE = 8192;
  private static final int HEADER_SIZE = 64;

  interface Source {
    InputStream openInput() throws IOException;
    OutputStream openOutput() throws IOException;
  }

  interface Mutator {
    void mutate(AudioFile audioFile, Tag tag) throws Exception;
  }

  private LocalTagEditor() {}

  static void write(File cache, String displayName, String mime, Source source, Mutator mutator)
      throws Exception {
    try (TemporaryFile backup = new TemporaryFile(cache, "af_tag_backup_", ".bak")) {
      try (InputStream in = source.openInput(); OutputStream out = new FileOutputStream(backup.file)) {
        copy(in, out);
      }
      String suffix = resolveSuffix(backup.file, displayName, mime);
      try (TemporaryFile edited = new TemporaryFile(cache, "af_tag_", "." + suffix)) {
        try (InputStream in = new FileInputStream(backup.file);
             OutputStream out = new FileOutputStream(edited.file)) {
          copy(in, out);
        }
        AudioFile audioFile = AudioFileIO.read(edited.file);
        mutator.mutate(audioFile, audioFile.getTagOrCreateAndSetDefault());
        audioFile.commit();
        // 标签提交和复读均成功后才允许截断源文件。
        AudioFileIO.read(edited.file);
        overwrite(source, edited.file, backup);
      }
    }
  }

  // 仅处理当前进程内失败；进程被杀或提供方失联时无法保证 content URI 写回的原子性。
  private static void overwrite(Source source, File edited, TemporaryFile backup) throws Exception {
    try (InputStream in = new FileInputStream(edited)) {
      boolean opened = false;
      try {
        OutputStream output = source.openOutput();
        opened = output != null;
        try (OutputStream out = output) {
          copy(in, out);
        }
      } catch (Exception writeError) {
        // 授权拒绝发生在打开之前，不做第二次写入，让 Native 沿用授权重试流程。
        if (!opened && writeError instanceof SecurityException) throw writeError;
        // openOutput 抛 I/O 异常或返回 null 时，无法知道提供方是否已截断，不能盲目再写。
        if (!opened || !(writeError instanceof IOException)) {
          throw retainBackup(backup, "无法安全恢复标签写入，原始备份保留在：", writeError);
        }
        try (InputStream original = new FileInputStream(backup.file);
             OutputStream out = source.openOutput()) {
          copy(original, out);
        } catch (Exception restoreError) {
          // content URI 无原子替换；恢复也失败时必须保留唯一原始副本并报告位置。
          IOException failure = retainBackup(backup,
              "标签写回失败且原文件恢复失败，原始备份保留在：", writeError);
          failure.addSuppressed(restoreError);
          throw failure;
        }
        throw writeError;
      }
    }
  }

  private static IOException retainBackup(TemporaryFile backup, String message, Exception cause) {
    backup.keep = true;
    return new IOException(message + backup.file.getAbsolutePath(), cause);
  }

  static String resolveSuffix(File file, String displayName, String mime) throws IOException {
    String detected = detectFormat(file);
    if (detected != null) {
      String suffix = supportedSuffix(detected);
      if (suffix != null) return suffix;
      throw new IOException("不支持写入此音频格式：" + detected);
    }
    if (displayName != null) {
      int dot = displayName.lastIndexOf('.');
      if (dot >= 0) {
        String suffix = supportedSuffix(displayName.substring(dot + 1));
        if (suffix != null) return suffix;
      }
    }
    String suffix = suffixFromMime(mime);
    if (suffix != null) return suffix;
    throw new IOException("无法确定受支持的音频格式：名称=" + displayName + "，MIME=" + mime);
  }

  // 只列 jaudiotagger 3.0.1 同时具备 Reader/Writer 的格式；RA/RM/DFF 只有 Reader。
  private static String supportedSuffix(String extension) {
    String suffix = extension.toLowerCase(Locale.ROOT);
    switch (suffix) {
      case "mp3": case "flac": case "wav": case "wma": case "dsf": return suffix;
      case "mp4": case "m4a": case "m4b": case "m4p": return "m4a";
      case "ogg": case "oga": return "ogg";
      case "aif": case "aiff": case "aifc": return "aiff";
      default: return null;
    }
  }

  private static String suffixFromMime(String mime) {
    if (mime == null) return null;
    switch (mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT)) {
      case "audio/mpeg": case "audio/mp3": case "audio/x-mp3": return "mp3";
      case "audio/flac": case "audio/x-flac": return "flac";
      case "audio/mp4": case "audio/m4a": case "audio/x-m4a": case "video/mp4": return "m4a";
      case "audio/ogg": case "application/ogg": case "audio/x-ogg": return "ogg";
      case "audio/wav": case "audio/x-wav": case "audio/wave": case "audio/vnd.wave": return "wav";
      case "audio/aiff": case "audio/x-aiff": return "aiff";
      case "audio/x-ms-wma": case "audio/x-ms-asf": return "wma";
      case "audio/dsf": case "audio/x-dsf": return "dsf";
      default: return null;
    }
  }

  private static String detectFormat(File file) throws IOException {
    try (RandomAccessFile in = new RandomAccessFile(file, "r")) {
      byte[] header = new byte[HEADER_SIZE];
      int size = in.read(header);
      if (size < 4) throw new IOException("音频文件为空或文件头不完整");
      // ID3 也可能前置于 FLAC/AAC，跳过后识别真实数据，不能看到 ID3 就默认 MP3。
      if (matches(header, size, 0, "ID3")) {
        if (size < 10) throw new IOException("ID3 文件头不完整");
        long tagSize = 0;
        for (int i = 6; i < 10; i++) {
          if ((header[i] & 0x80) != 0) throw new IOException("无效的 ID3 标签长度");
          tagSize = (tagSize << 7) | header[i];
        }
        long offset = 10 + tagSize;
        if (offset >= in.length()) throw new IOException("ID3 标签后缺少音频数据");
        in.seek(offset);
        size = in.read(header);
      }
      if (matches(header, size, 0, "fLaC")) return "flac";
      if (matches(header, size, 0, "RIFF") && matches(header, size, 8, "WAVE")) return "wav";
      if (matches(header, size, 0, "FORM")
          && (matches(header, size, 8, "AIFF") || matches(header, size, 8, "AIFC"))) return "aiff";
      if (matches(header, size, 4, "ftyp")) return "m4a";
      if (matches(header, size, 0, "OggS")) {
        // Ogg 是容器，不代表 Opus/Speex 也有可用的标签 Writer。
        String start = new String(header, 0, size, StandardCharsets.ISO_8859_1);
        if (start.contains("OpusHead")) return "opus";
        if (start.contains("Speex   ")) return "speex";
        return "ogg";
      }
      if (matches(header, size, 0, "DSD ")) return "dsf";
      if (matches(header, size, 0, "FRM8")) return "dff";
      if (matches(header, size, 0, ".RMF") || matches(header, size, 0, ".ra")) return "ra";
      if (size >= 4 && (header[0] & 0xff) == 0xff && (header[1] & 0xe0) == 0xe0) {
        int layer = header[1] & 6;
        if (layer == 0) return "aac";
        if (layer == 2 && (header[1] & 0x18) != 8
            && (header[2] & 0xf0) != 0xf0 && (header[2] & 0x0c) != 0x0c) return "mp3";
      }
      return null;
    }
  }

  private static boolean matches(byte[] header, int size, int offset, String signature) {
    if (size < offset + signature.length()) return false;
    for (int i = 0; i < signature.length(); i++) {
      if ((header[offset + i] & 0xff) != signature.charAt(i)) return false;
    }
    return true;
  }

  private static void copy(InputStream in, OutputStream out) throws IOException {
    if (in == null || out == null) throw new IOException("媒体提供方未返回有效的读写流");
    byte[] buffer = new byte[BUFFER_SIZE];
    int read;
    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
  }

  private static final class TemporaryFile implements AutoCloseable {
    final File file;
    boolean keep;

    TemporaryFile(File cache, String prefix, String suffix) throws IOException {
      file = File.createTempFile(prefix, suffix, cache);
    }

    @Override
    public void close() throws IOException {
      if (!keep && file.exists() && !file.delete()) {
        throw new IOException("无法清理标签编辑临时文件：" + file.getAbsolutePath());
      }
    }
  }
}
