package cn.chenle.auralflow.mobile;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 月文件规则独立于 Android 桥；原子提交与 JSON 校验由平台注入。 */
final class ListeningStatsFiles {
  private static final String MONTH = "(?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])";
  private static final Pattern MONTH_PATTERN = Pattern.compile(MONTH);
  private static final Pattern FILE_PATTERN = Pattern.compile("(" + MONTH + ")\\.json(?:\\.bak|\\.new)?");

  interface AtomicHandle {
    InputStream openRead() throws IOException;
    FileOutputStream startWrite() throws IOException;
    void finishWrite(FileOutputStream stream) throws IOException;
    void failWrite(FileOutputStream stream) throws IOException;
  }
  interface AtomicFactory { AtomicHandle open(File file); }
  interface JsonValidator { void validate(String contents) throws IOException; }

  private final File directory;
  private final AtomicFactory atomicFactory;
  private final JsonValidator validator;

  ListeningStatsFiles(File directory, AtomicFactory atomicFactory, JsonValidator validator) {
    this.directory = directory;
    this.atomicFactory = atomicFactory;
    this.validator = validator;
  }

  List<String> listMonths() throws IOException {
    if (!directory.exists()) return new ArrayList<>();
    File[] files = directory.listFiles();
    if (files == null) throw new IOException("无法读取统计目录");
    TreeSet<String> months = new TreeSet<>();
    for (File file : files) {
      Matcher matcher = FILE_PATTERN.matcher(file.getName());
      if (!matcher.matches()) continue;
      if (!file.isFile()) throw new IOException("统计月文件不是普通文件：" + file.getName());
      months.add(matcher.group(1));
    }
    return new ArrayList<>(months);
  }

  String readMonth(String month) throws IOException {
    File file = monthFile(month);
    if (!file.exists() && !new File(file.getPath() + ".bak").exists()) {
      // 只有 .new 说明该月首次写入被中断（AtomicFile 的 finishWrite 才会改名）。
      // 没有 base 就没有已提交的数据，按空月处理；抛错会让整库永久读不出来。
      return null;
    }
    StringBuilder contents = new StringBuilder();
    try (Reader reader = new InputStreamReader(atomicFactory.open(file).openRead(),
        StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT))) {
      char[] buffer = new char[4096];
      int count;
      while ((count = reader.read(buffer)) != -1) contents.append(buffer, 0, count);
    }
    String value = contents.toString();
    validator.validate(value);
    return value;
  }

  void writeMonth(String month, String contents) throws IOException {
    File file = monthFile(month);
    if (contents == null) throw new IllegalArgumentException("统计内容不能为 null");
    validator.validate(contents);
    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建统计目录");
    byte[] bytes = contents.getBytes(StandardCharsets.UTF_8);
    AtomicHandle atomic = atomicFactory.open(file);
    FileOutputStream stream = atomic.startWrite();
    try {
      stream.write(bytes);
      // AtomicFile 部分系统版本只记录 fsync/rename 失败；主动同步并核对提交结果。
      stream.getFD().sync();
      atomic.finishWrite(stream);
      if (!file.isFile() || file.length() != bytes.length
          || new File(file.getPath() + ".new").exists() || new File(file.getPath() + ".bak").exists()) {
        throw new IOException("统计月文件未完成原子提交：" + month);
      }
    } catch (IOException | RuntimeException error) {
      try { atomic.failWrite(stream); }
      catch (IOException rollbackError) { error.addSuppressed(rollbackError); }
      throw error;
    }
  }

  private File monthFile(String month) throws IOException {
    if (month == null || !MONTH_PATTERN.matcher(month).matches()) {
      throw new IllegalArgumentException("统计月份必须为有效的 YYYY-MM");
    }
    File file = new File(directory, month + ".json");
    if (!directory.getCanonicalFile().equals(file.getCanonicalFile().getParentFile())) {
      throw new IOException("统计文件越出专用目录");
    }
    return file;
  }
}
