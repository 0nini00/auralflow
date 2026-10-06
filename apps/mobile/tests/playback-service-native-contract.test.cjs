const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const mobileDir = path.resolve(__dirname, "..");
const patchPath = path.join(mobileDir, "apply-track-player-patch.js");
const dependencyDir = path.join(mobileDir, "node_modules", "react-native-track-player");
const servicePath = path.join(dependencyDir, "android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt");
const modulePath = path.join(dependencyDir, "android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt");
const keepAwakeDir = path.join(mobileDir, "node_modules", "react-native-keep-awake");
const serviceIdField = "    private val auralflowServiceId = java.util.UUID.randomUUID().toString()\n";
const originalTaskConfig = "        return HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true)";
const lifetimeTaskConfig = [
  "        val taskData = Arguments.createMap().apply {",
  '            putString("serviceId", auralflowServiceId)',
  "        }",
  "        return HeadlessJsTaskConfig(TASK_KEY, taskData, 0, true)",
].join("\n");
const destroyedEvent = [
  '        emit("auralflow-playback-service-destroyed", Bundle().apply {',
  '            putString("serviceId", auralflowServiceId)',
  "        })",
  "",
].join("\n");

// 只保留 RNTP 4.1.2 补丁消费的原始锚点；实际完整源码另由已安装依赖用例覆盖。
const upstreamFixture = [
  "import android.content.Context",
  "import androidx.core.app.NotificationCompat.PRIORITY_LOW",
  "class MusicService : HeadlessJsTaskService() {",
  "    private val binder = MusicBinder()",
  "    private var progressUpdateJob: Job? = null",
  "    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {",
  "        startTask(getTaskConfig(intent))",
  "        startAndStopEmptyNotificationToAvoidANR()",
  "        return START_STICKY",
  "    }",
  "    @MainThread",
  "    private fun setupForegrounding() {",
  "                        notificationId = it.notificationId;",
  "                        notification = it.notification;",
  "    }",
  "    private fun emit() {",
  "        reactNativeHost.reactInstanceManager.currentReactContext",
  "    }",
  "    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {",
  originalTaskConfig,
  "    }",
  "    override fun onHeadlessJsTaskFinish(taskId: Int) {",
  "        // This is empty so ReactNative doesn't kill this service",
  "    }",
  "    override fun onDestroy() {",
  "        super.onDestroy()",
  "        player.destroy()",
  "    }",
  "    fun updateOptions() {",
  "        val notificationConfig = NotificationConfig(buttonsList, accentColor, smallIcon, pendingIntent)",
  "",
  "        player.notificationManager.createNotification(notificationConfig)",
  "    }",
  "    companion object {",
  "        const val DEFAULT_STOP_FOREGROUND_GRACE_PERIOD = 5",
  "    }",
  "}",
  "",
].join("\n");

// 无论 postinstall 是否已执行，均重建此次契约加入之前的已打补丁完整源码。
const legacyFixture = fs.readFileSync(servicePath, "utf8")
  .replaceAll("\r\n", "\n")
  .replace(serviceIdField, "")
  .replace(lifetimeTaskConfig, originalTaskConfig)
  .replace(destroyedEvent, "");
assert.equal(legacyFixture.includes("auralflowServiceId"), false, "旧补丁 fixture 不应预先带有生命周期契约");

function applyPatch(serviceSource) {
  // 执行真实补丁入口，只把文件读写隔离在内存，避免测试篡改已安装的依赖。
  const files = new Map([
    [servicePath, serviceSource],
    [modulePath, fs.readFileSync(modulePath, "utf8")],
    [path.join(dependencyDir, "package.json"), fs.readFileSync(path.join(dependencyDir, "package.json"), "utf8")],
    [path.join(keepAwakeDir, "package.json"), fs.readFileSync(path.join(keepAwakeDir, "package.json"), "utf8")],
    [path.join(keepAwakeDir, "android", "build.gradle"), fs.readFileSync(path.join(keepAwakeDir, "android", "build.gradle"), "utf8")],
  ]);
  const memoryFs = {
    existsSync: (file) => files.has(file),
    readFileSync(file) {
      assert.ok(files.has(file), '意外读取文件: ' + file);
      return files.get(file);
    },
    writeFileSync(file, content) {
      assert.ok(files.has(file), '意外写入文件: ' + file);
      files.set(file, content);
    },
  };
  vm.runInNewContext(fs.readFileSync(patchPath, "utf8"), {
    __dirname: mobileDir,
    require: (name) => name === "fs" ? memoryFs : require(name),
    console: { log() {}, error() {} },
    process: { exit: (code) => { throw new Error('补丁退出: ' + code); } },
  }, { filename: patchPath, timeout: 5000 });
  return files.get(servicePath);
}

function assertLifetimeContract(source) {
  assert.equal(source.split(serviceIdField).length - 1, 1, "每个服务实例必须只创建一次 UUID");
  assert.ok(source.indexOf(serviceIdField) < source.indexOf("    companion object {"), "serviceId 必须属于实例而非静态 companion");
  assert.ok(source.includes(lifetimeTaskConfig), "headless task data 必须携带相同 serviceId，保持 timeout=0 和允许前台执行");
  assert.equal(source.split(destroyedEvent).length - 1, 1, "销毁事件必须只注入一次并携带相同 serviceId");
  const destroy = source.slice(source.indexOf("    override fun onDestroy() {"));
  assert.ok(destroy.indexOf(destroyedEvent) >= 0, "销毁事件必须位于 onDestroy 中");
  assert.ok(destroy.indexOf(destroyedEvent) < destroy.indexOf("        super.onDestroy()"), "必须在原生 headless 清理前通知 JS");
  assert.match(source, /override fun onHeadlessJsTaskFinish\(taskId: Int\) \{\s*\/\/ This is empty so ReactNative doesn't kill this service\s*\}/);
}

for (const [name, fixture] of [["原始 RNTP 锚点", upstreamFixture], ["已有补丁完整源码", legacyFixture]]) {
  test(name + "加入按服务实例隔离的生命周期契约", () => {
    assertLifetimeContract(applyPatch(fixture));
  });
  test(name + "重复应用补丁保持字节级幂等", () => {
    const once = applyPatch(fixture);
    assertLifetimeContract(once);
    assert.equal(applyPatch(once), once);
  });
}

test("保留通知歌词、START_NOT_STICKY、新架构事件和原有销毁逻辑", () => {
  const patched = applyPatch(legacyFixture);
  const withoutLifecycle = patched.replace(serviceIdField, "")
    .replace(lifetimeTaskConfig, originalTaskConfig).replace(destroyedEvent, "");
  assert.equal(withoutLifecycle, legacyFixture);
});

for (const [name, anchor] of [
  ["服务实例字段", "    private val binder = MusicBinder()\n"],
  ["headless 配置", originalTaskConfig],
  ["销毁方法", "    override fun onDestroy() {\n"],
]) {
  test(name + "锚点缺失时明确失败而非静默跳过", () => {
    assert.ok(legacyFixture.includes(anchor));
    assert.throws(() => applyPatch(legacyFixture.replace(anchor, "")), /Pattern not found.*MusicService\.kt/);
  });
}
