package cn.chenle.auralflow.mobile;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;

public final class ListeningStatsFilesHarness {
  private static boolean failWrite;
  private static boolean failCommit;
  private static int writesStarted;

  private static final class AtomicBoundary implements ListeningStatsFiles.AtomicHandle {
    private final File base;
    private final File pending;
    private final File backup;
    AtomicBoundary(File base) {
      this.base = base;
      pending = new File(base.getPath() + ".new");
      backup = new File(base.getPath() + ".bak");
    }
    @Override public InputStream openRead() throws IOException {
      if (backup.exists()) Files.move(backup.toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING);
      Files.deleteIfExists(pending.toPath());
      return new FileInputStream(base);
    }
    @Override public FileOutputStream startWrite() throws IOException {
      writesStarted++;
      return new FileOutputStream(pending) {
        @Override public void write(byte[] bytes) throws IOException {
          if (failWrite) {
            super.write(bytes, 0, Math.max(1, bytes.length / 2));
            throw new IOException("injected write failure");
          }
          super.write(bytes);
        }
      };
    }
    @Override public void finishWrite(FileOutputStream stream) throws IOException {
      stream.close();
      if (failCommit) return;
      Files.move(pending.toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }
    @Override public void failWrite(FileOutputStream stream) throws IOException {
      stream.close();
      Files.deleteIfExists(pending.toPath());
    }
  }

  private interface Check { void run() throws Exception; }
  private static void require(boolean result, String message) {
    if (!result) throw new AssertionError(message);
  }
  private static void rejects(Check check, String message) throws Exception {
    try { check.run(); } catch (IOException | IllegalArgumentException expected) { return; }
    throw new AssertionError(message);
  }

  public static void main(String[] args) throws Exception {
    File directory = new File(args[0], "data");
    // JSON 解析由 Android JsonReader 负责；此边界验证失败必须先于任何落盘。
    ListeningStatsFiles files = new ListeningStatsFiles(directory, AtomicBoundary::new, value -> {
      if (!value.startsWith("[") || !value.endsWith("]")) throw new IOException("invalid JSON array");
    });
    require(files.listMonths().isEmpty(), "missing directory must be empty");
    require(files.readMonth("2026-11") == null, "missing month must be null");
    for (String month : new String[] { "../2026-11", "2026-00", "2026-13", "2026-1", "0000-01", null }) {
      rejects(() -> files.writeMonth(month, "[]"), "invalid month accepted");
    }
    rejects(() -> files.writeMonth("2026-11", "{}"), "non-array accepted");
    require(writesStarted == 0, "invalid input opened a write");
    files.writeMonth("2026-11", "[{\"song\":\"旧歌\"}]");
    files.writeMonth("2026-10", "[]");
    require(files.listMonths().equals(Arrays.asList("2026-10", "2026-11")), "months must be sorted");
    require(files.readMonth("2026-11").equals("[{\"song\":\"旧歌\"}]"), "UTF-8 round trip failed");
    rejects(() -> files.writeMonth("2026-11", "{}"), "invalid replacement accepted");
    require(files.readMonth("2026-11").contains("旧歌"), "invalid replacement changed old data");
    failWrite = true;
    rejects(() -> files.writeMonth("2026-11", "[{\"song\":\"new\"}]"), "write failure hidden");
    failWrite = false;
    require(files.readMonth("2026-11").contains("旧歌"), "failed write replaced previous month");
    failCommit = true;
    rejects(() -> files.writeMonth("2026-11", "[1]"), "uncommitted write reported success");
    failCommit = false;
    require(files.readMonth("2026-11").contains("旧歌"), "failed commit replaced previous month");
    File backup = new File(directory, "2026-09.json.bak");
    Files.write(backup.toPath(), "[9]".getBytes(StandardCharsets.UTF_8));
    require(files.listMonths().contains("2026-09"), "backup-only month omitted");
    require(files.readMonth("2026-09").equals("[9]"), "backup was not recovered");
    Files.write(new File(directory, "2026-09.json.new").toPath(), "broken".getBytes(StandardCharsets.UTF_8));
    require(files.readMonth("2026-09").equals("[9]"), "unfinished replacement hid committed data");
    Files.write(new File(directory, "2026-08.json.new").toPath(), "[8]".getBytes(StandardCharsets.UTF_8));
    require(files.listMonths().contains("2026-08"), "unfinished month omitted");
    // 首次写入被中断只会留下 .new：没有已提交数据，按空月处理，不能让整库永久读不出来。
    require(files.readMonth("2026-08") == null, "unfinished month without base must read as empty");
    Files.write(new File(directory, "2026-07.json").toPath(), "broken".getBytes(StandardCharsets.UTF_8));
    rejects(() -> files.readMonth("2026-07"), "corrupt disk data accepted");
    Files.write(new File(directory, "2026-06.json").toPath(), new byte[] { '[', '"', (byte) 0xff, '"', ']' });
    rejects(() -> files.readMonth("2026-06"), "invalid UTF-8 silently replaced");
    System.out.println("PASS listening-stats-files");
  }
}
