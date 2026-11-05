const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("Android 10 使用异常携带的媒体授权，Android 11 起使用 MediaStore 写入授权", { timeout: 60000 }, () => {
  const source = fs.readFileSync(path.join(__dirname, "../android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicModule.java"), "utf8");
  const methods = ["requestUpdateAccess", "requestWriteAccess", "createWriteAccessIntent"].flatMap(name => {
    const match = source.match(new RegExp(`^  private (?:static )?[^\\n]+ ${name}\\([^]*?^  }`, "m"));
    return match ? [match[0].replaceAll("android.app.RecoverableSecurityException", "RecoverableSecurityException")] : [];
  }).join("\n");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralflow-media-permission-"));
  const harness = `
import java.util.Collections;
public class PermissionHarness {
  static final int REQUEST_UPDATE_AUDIO = 1, REQUEST_WRITE_AUDIO = 2;
  PendingMetadataUpdate updatePending;
  PendingWrite writePending;
  Activity activity = new Activity();
  Activity getCurrentActivity() { return activity; }
  PermissionHarness getReactApplicationContext() { return this; }
  Object getContentResolver() { return new Object(); }
  interface TagMutator {}
  static class Uri {}
  static class ContentValues { ContentValues() {} ContentValues(ContentValues value) {} }
  static class Promise {
    Throwable error;
    void reject(String code, Object cause) { error = cause instanceof Throwable ? (Throwable) cause : new Exception(code); }
  }
  static class PendingMetadataUpdate { PendingMetadataUpdate(Uri uri, ContentValues value, Promise promise) {} }
  static class PendingWrite { PendingWrite(Uri uri, TagMutator value, Promise promise) {} }
  static class PendingIntent {
    String origin;
    PendingIntent(String value) { origin = value; }
    Object getIntentSender() { return origin; }
  }
  static class Activity {
    Object launched;
    void startIntentSenderForResult(Object sender, int code, Object data, int a, int b, int c) { launched = sender; }
  }
  static class Build {
    static class VERSION { static int SDK_INT; }
    static class VERSION_CODES { static final int Q = 29, R = 30; }
  }
  static class RecoverableSecurityException extends SecurityException {
    RecoverableSecurityException getUserAction() { return this; }
    PendingIntent getActionIntent() { return new PendingIntent("recoverable"); }
  }
  static class MediaStore {
    static PendingIntent createWriteRequest(Object resolver, Object uris) {
      if (Build.VERSION.SDK_INT < 30) throw new NoSuchMethodError("createWriteRequest requires API 30");
      return new PendingIntent("media-store");
    }
  }
${methods}
  public static void main(String[] args) throws Exception {
    for (int sdk : new int[] {29, 30, 35}) {
      for (String name : new String[] {"requestUpdateAccess", "requestWriteAccess"}) {
        PermissionHarness target = new PermissionHarness();
        Build.VERSION.SDK_INT = sdk;
        Promise promise = new Promise();
        java.lang.reflect.Method method = java.util.Arrays.stream(PermissionHarness.class.getDeclaredMethods()).filter(m -> m.getName().equals(name)).findFirst().get();
        Object payload = name.equals("requestUpdateAccess") ? new ContentValues() : new TagMutator() {};
        Object[] values = method.getParameterCount() == 3 ? new Object[] {new Uri(), payload, promise} : new Object[] {new Uri(), payload, promise, new RecoverableSecurityException()};
        method.invoke(target, values);
        if (promise.error != null) throw new AssertionError(promise.error);
        if (!(sdk == 29 ? "recoverable" : "media-store").equals(target.activity.launched)) throw new AssertionError("Wrong consent intent on SDK " + sdk);
      }
    }
  }
}`;
  try {
    const file = path.join(directory, "PermissionHarness.java");
    fs.writeFileSync(file, harness);
    for (const [command, args] of [["javac", ["-encoding", "UTF-8", "-d", directory, file]], ["java", ["-cp", directory, "PermissionHarness"]]]) {
      const executable = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", command) : command;
      const result = spawnSync(executable, args, { encoding: "utf8", timeout: 25000, windowsHide: true });
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true });
  }
});
