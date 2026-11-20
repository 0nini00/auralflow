package cn.chenle.auralflow.mobile;

import java.io.File;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/** 公共封面签名只在一次扫描内复用，结束前重新读取以检测扫描期间的变化。 */
final class ScanDirectorySignatures {
  interface Reader {
    String read(File directory);
  }

  private final Reader reader;
  private final Map<File, String> signatures = new LinkedHashMap<>();

  ScanDirectorySignatures(Reader reader) {
    this.reader = reader;
  }

  String get(File directory) {
    String signature = signatures.get(directory);
    if (signature != null) return signature;
    signature = reader.read(directory);
    signatures.put(directory, signature);
    return signature;
  }

  void verifyUnchanged() throws IOException {
    for (Map.Entry<File, String> entry : signatures.entrySet()) {
      if (!entry.getValue().equals(reader.read(entry.getKey()))) {
        throw new IOException("公共封面在扫描期间发生变化，请重试：" + entry.getKey());
      }
    }
  }
}
