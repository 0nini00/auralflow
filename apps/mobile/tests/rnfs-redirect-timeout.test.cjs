const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('实际RNFS重定向下载保留连接和读取期限，慢连接可结算释放队列', { timeout: 60000 }, () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'auralflow-rnfs-timeout-'));
  const write = (name, content) => { const file = path.join(work, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };
  try {
    const sources = [
      write('android/os/AsyncTask.java', 'package android.os; public class AsyncTask<A,B,C> { protected void publishProgress(B... values) {} protected void onProgressUpdate(B... values) {} }'),
      write('android/os/Build.java', 'package android.os; public class Build { public static class VERSION { public static int SDK_INT=30; } public static class VERSION_CODES { public static int N=24; } }'),
      write('android/util/Log.java', 'package android.util; public class Log { public static int d(String a,String b) { return 0; } }'),
      write('com/facebook/react/bridge/ReadableMapKeySetIterator.java', 'package com.facebook.react.bridge; public interface ReadableMapKeySetIterator { boolean hasNextKey(); String nextKey(); }'),
      write('com/facebook/react/bridge/ReadableMap.java', 'package com.facebook.react.bridge; public interface ReadableMap { ReadableMapKeySetIterator keySetIterator(); String getString(String key); }'),
      write('com/rnfs/RedirectHarness.java', `package com.rnfs;
import java.net.*; import java.io.*; import java.util.*; import java.util.concurrent.*; import com.facebook.react.bridge.*;
public class RedirectHarness {
  static class Connection extends HttpURLConnection {
    Connection(URL url) { super(url); }
    public void connect() {}
    public void disconnect() {}
    public boolean usingProxy() { return false; }
    public int getResponseCode() { return url.getPath().equals("/redirect") ? 307 : 200; }
    public String getHeaderField(String key) { return key.equals("Location") ? "http://fixture.test/slow" : null; }
    public Map<String,List<String>> getHeaderFields() { return Collections.emptyMap(); }
    public InputStream getInputStream() throws IOException {
      if (getReadTimeout() != 125 || getConnectTimeout() != 250) throw new AssertionError("redirect lost timeouts: " + getReadTimeout() + "/" + getConnectTimeout());
      throw new SocketTimeoutException("bounded read");
    }
  }
  public static void main(String[] args) throws Exception {
    URL.setURLStreamHandlerFactory(protocol -> new URLStreamHandler() { protected URLConnection openConnection(URL url) { return new Connection(url); } });
    DownloadParams params = new DownloadParams(); params.src = new URL("http://fixture.test/redirect"); params.dest = new File(args[0]); params.readTimeout = 125; params.connectionTimeout = 250;
    params.headers = new ReadableMap() { public String getString(String key) { return null; } public ReadableMapKeySetIterator keySetIterator() { return new ReadableMapKeySetIterator() { public boolean hasNextKey() { return false; } public String nextKey() { return null; } }; } };
    CountDownLatch done = new CountDownLatch(1); DownloadResult[] result = new DownloadResult[1];
    params.onTaskCompleted = value -> { result[0] = value; done.countDown(); };
    new Downloader().doInBackground(params);
    if (!done.await(2, TimeUnit.SECONDS)) throw new AssertionError("download did not settle");
    if (!(result[0].exception instanceof SocketTimeoutException)) throw new AssertionError("missing bounded read failure", result[0].exception);
    System.out.println("PASS redirect timeout");
  }
}`),
      ...['Downloader', 'DownloadParams', 'DownloadResult'].map(name => path.resolve(__dirname, `../node_modules/react-native-fs/android/src/main/java/com/rnfs/${name}.java`)),
    ];
    for (const [name, args] of [['javac', ['-encoding', 'UTF-8', '-d', work, ...sources]], ['java', ['-cp', work, 'com.rnfs.RedirectHarness', path.join(work, 'download')]]]) {
      const command = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
      const result = spawnSync(command, args, { timeout: 20000, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  } finally {
    assert.equal(path.dirname(work), path.resolve(os.tmpdir()));
    assert.ok(path.basename(work).startsWith('auralflow-rnfs-timeout-'));
    fs.rmSync(work, { recursive: true });
  }
});
