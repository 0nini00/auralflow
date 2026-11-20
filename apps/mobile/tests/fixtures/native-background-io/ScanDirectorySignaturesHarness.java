package cn.chenle.auralflow.mobile;

import java.io.*;
import java.nio.file.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class ScanDirectorySignaturesHarness {
  private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
  public static void main(String[] args) throws Exception {
    File dir = new File(args[0]);
    File cover = new File(dir, "cover.jpg");
    Files.writeString(cover.toPath(), "first");
    AtomicInteger reads = new AtomicInteger();
    ScanDirectorySignatures.Reader reader = directory -> {
      reads.incrementAndGet();
      File file = new File(directory, "cover.jpg");
      return file.lastModified() + ":" + file.length();
    };
    ScanDirectorySignatures scan = new ScanDirectorySignatures(reader);
    String initial = scan.get(dir);
    for (int i = 0; i < 5000; i++) check(initial.equals(scan.get(dir)), "Inconsistent scan stamp");
    check(reads.get() == 1, "Shared covers re-statted per song");
    scan.verifyUnchanged();
    check(reads.get() == 2, "Publication must verify each directory once");
    Files.writeString(cover.toPath(), "changed-cover");
    try { scan.verifyUnchanged(); throw new AssertionError("Change was hidden by cached stamp"); }
    catch (IOException expected) {}
    ScanDirectorySignatures next = new ScanDirectorySignatures(reader);
    check(!initial.equals(next.get(dir)), "Cache leaked across scans");
    next.verifyUnchanged();
    Files.delete(cover.toPath());
    try { next.verifyUnchanged(); throw new AssertionError("Deleted cover was hidden"); }
    catch (IOException expected) {}
    System.out.println("PASS signatures");
  }
}
