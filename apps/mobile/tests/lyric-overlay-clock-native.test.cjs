const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const nativeDir = path.resolve(__dirname, "../android/app/src/main/java/cn/chenle/auralflow/mobile");
const serviceSource = fs.readFileSync(path.join(nativeDir, "LyricOverlayService.java"), "utf8");
const moduleSource = fs.readFileSync(path.join(nativeDir, "LyricOverlayModule.java"), "utf8");

function method(source, name) {
  const match = source.match(new RegExp(`^    (?:private|public) [^\\n]+ ${name}\\([^]*?^    }`, "m"));
  assert.ok(match, `缺少原生方法 ${name}`);
  return match[0];
}

function run(tool, args) {
  const command = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", tool) : tool;
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 25000, windowsHide: true });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("真实原生暂停命令定位并渲染42秒，null位置保留即时冻结行为", { timeout: 60000 }, () => {
  const bridge = method(moduleSource, "pauseLyricClock");
  assert.match(bridge, /pauseLyricClock\(@Nullable Double position, Promise promise\)/);
  const action = serviceSource.match(/            if \(ACTION_PAUSE_CLOCK.equals\(action\)\) \{[^]*?(?=            if \(ACTION_SET_CLOCK_RATE)/);
  assert.ok(action, "缺少暂停动作分发");
  const methods = ["pauseClock", "getCurrentPosition", "findCurrentLineIndex", "renderCurrentIndex", "updateTextsForIndex"]
    .map(name => method(serviceSource, name)).join("\n");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "auralflow-lyric-clock-"));
  try {
    const source = `import java.util.*;
public class LyricOverlayClockHarness {
  @interface Nullable {}
  static class Promise {}
  static class Intent {
    String action; Double position;
    Intent(Object context, Class<?> type) {}
    void setAction(String action) { this.action=action; }
    void putExtra(String key,double position) { this.position=position; }
    boolean hasExtra(String key) { return position!=null; }
    double getDoubleExtra(String key,double fallback) { return position==null?fallback:position; }
  }
  static class Handler { int removed; void removeCallbacks(Runnable callback) { removed++; } }
  static class SystemClock { static long elapsedRealtime() { return 5000; } }
  static class LyricLineEntry {
    double time; String text,tr="";
    LyricLineEntry(double time,String text) { this.time=time;this.text=text; }
  }
  static class LyricOverlayService {
    static final String ACTION_PAUSE_CLOCK="pause", EXTRA_POSITION="position";
    boolean isClockRunning=false, windowAttached=true;
    double currentClockPosition=0; long clockStartTimeMs=0; float clockPlaybackRate=1;
    String currentText="", nextText="", fallbackText="song";
    int renders=0;
    final Handler clockHandler=new Handler(); final Runnable clockTickRunnable=()->{};
    final List<LyricLineEntry> lyricEntries=Arrays.asList(new LyricLineEntry(0,"first"),new LyricLineEntry(30,"paused line"),new LyricLineEntry(60,"later"));
    void sendSuccess(Object receiver) {}
    void renderState() { if (isClockRunning) throw new AssertionError("暂停校准意外开启时钟"); renders++; }
    void dispatch(Intent intent) { String action=intent.action; Object receiver=null;
${action[0]}
    }
${methods}
  }
  static class Module {
    Object context=new Object(); Intent dispatched;
    void dispatchOperation(Intent intent,Promise promise,boolean resolveVoid) { dispatched=intent; }
${bridge}
  }
  static void check(boolean condition,String message) { if(!condition) throw new AssertionError(message); }
  public static void main(String[] args) {
    Module module=new Module(); LyricOverlayService service=new LyricOverlayService();
    module.pauseLyricClock(42.0,new Promise()); service.dispatch(module.dispatched);
    check(!service.isClockRunning,"42秒校准必须保持暂停");
    check(service.currentClockPosition==42.0,"必须保存42秒位置");
    check(service.currentText.equals("paused line"),"必须显示42秒对应歌词");
    check(service.renders==1,"暂停定位必须立即渲染一次");
    check(service.clockHandler.removed==1,"必须撤销旧时钟调度");
    module.pauseLyricClock(null,new Promise());
    check(!module.dispatched.hasExtra("position"),"null不能被替换为0秒");
    service.currentClockPosition=10;service.isClockRunning=true;
    service.dispatch(module.dispatched);
    check(!service.isClockRunning && service.currentClockPosition==15.0,"无位置暂停应立即冻结当前外推位置");
    check(service.renders==1,"无位置暂停不能重设歌词");
    System.out.println("PASS paused position and immediate freeze");
  }
}`;
    const file = path.join(work, "LyricOverlayClockHarness.java");
    fs.writeFileSync(file, source);
    run("javac", ["-encoding", "UTF-8", "-d", work, file]);
    assert.match(run("java", ["-cp", work, "LyricOverlayClockHarness"]), /PASS paused position and immediate freeze/);
  } finally {
    const resolved = path.resolve(work);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("auralflow-lyric-clock-"));
    fs.rmSync(resolved, { recursive: true });
  }
});
