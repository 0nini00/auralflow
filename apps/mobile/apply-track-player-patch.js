const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, 'node_modules', 'react-native-track-player');
const RNTP_VERSION = '4.1.2';
const KEEP_AWAKE_VERSION = '4.0.0';

function replaceAllRequired(content, target, from, to, optional = false) {
  if (!content.includes(from)) {
    if (to && content.includes(to)) return content;
    if (optional) return content;
    throw new Error(`Pattern not found in ${target}: ${from.trim()}`);
  }
  return content.split(from).join(to);
}

const files = [
  {
    target: 'android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt',
    transform: (content, target) => {
      let next = content;
      const lyricPatchMarker = '    // AURALFLOW_LYRIC_NOTIFICATION_ACTION\n';
      const lyricConstants = [
        '        private const val LYRIC_OVERLAY_PREFERENCES_NAME = "auralflow_lyric_overlay"',
        '        private const val LYRIC_OVERLAY_VISIBLE_KEY = "visible"',
        '        private const val LYRIC_NOTIFICATION_BUTTON_ENABLED_KEY = "notification_button_enabled"',
        '        private const val LYRIC_NOTIFICATION_STATE_CHANGED_ACTION = "cn.chenle.auralflow.mobile.lyrics.NOTIFICATION_STATE_CHANGED"',
        '        private const val LYRIC_NOTIFICATION_TOGGLE_ACTION = "cn.chenle.auralflow.mobile.lyrics.NOTIFICATION_TOGGLE"',
        '        private const val LYRIC_NOTIFICATION_RECEIVER_CLASS = "cn.chenle.auralflow.mobile.LyricNotificationReceiver"',
      ].join('\n');
      next = replaceAllRequired(
        next,
        target,
        'import cn.chenle.auralflow.mobile.LyricNotificationReceiver\nimport cn.chenle.auralflow.mobile.LyricOverlayPreferences\nimport cn.chenle.auralflow.mobile.R as AppR\n',
        '',
        true,
      );
      next = replaceAllRequired(
        next,
        target,
        'LyricOverlayPreferences.ACTION_NOTIFICATION_STATE_CHANGED',
        'LYRIC_NOTIFICATION_STATE_CHANGED_ACTION',
        true,
      );
      next = replaceAllRequired(
        next,
        target,
        [
          '        if (!LyricOverlayPreferences.isNotificationButtonEnabled(this)) return baseNotification',
          '        val toggleIntent = Intent(this, LyricNotificationReceiver::class.java).apply {',
          '            action = LyricNotificationReceiver.ACTION_TOGGLE',
          '        }',
        ].join('\n'),
        [
          '        val preferences = getSharedPreferences(LYRIC_OVERLAY_PREFERENCES_NAME, Context.MODE_PRIVATE)',
          '        if (!preferences.getBoolean(LYRIC_NOTIFICATION_BUTTON_ENABLED_KEY, true)) return baseNotification',
          '        val receiverClass = Class.forName(LYRIC_NOTIFICATION_RECEIVER_CLASS)',
          '        val toggleIntent = Intent(this, receiverClass).apply {',
          '            action = LYRIC_NOTIFICATION_TOGGLE_ACTION',
          '        }',
        ].join('\n'),
        true,
      );
      next = replaceAllRequired(
        next,
        target,
        [
          '        val title = if (LyricOverlayPreferences.isVisible(this)) "歌词关" else "歌词开"',
          '        return NotificationCompat.Builder.recoverBuilder(this, baseNotification)',
          '            .addAction(AppR.drawable.ic_notification_lyrics, title, togglePendingIntent)',
        ].join('\n'),
        [
          '        val title = if (preferences.getBoolean(LYRIC_OVERLAY_VISIBLE_KEY, false)) "歌词关" else "歌词开"',
          '        val icon = resources.getIdentifier("ic_notification_lyrics", "drawable", packageName)',
          '            .takeIf { it != 0 } ?: baseNotification.smallIcon.resId',
          '        val action = NotificationCompat.Action.Builder(icon, title, togglePendingIntent).build()',
          '        return NotificationCompat.Builder.recoverBuilder(this, baseNotification)',
          '            .addAction(action)',
        ].join('\n'),
        true,
      );
      next = replaceAllRequired(
        next,
        target,
        'NotificationCompat.Builder.recoverBuilder(this, baseNotification)',
        'NotificationCompat.Builder(this, baseNotification)',
        true,
      );
      next = replaceAllRequired(
        next,
        target,
        'reactNativeHost.reactInstanceManager.currentReactContext',
        'reactContext',
      );
      next = replaceAllRequired(
        next,
        target,
        [
          '    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {',
          '        startTask(getTaskConfig(intent))',
          '        startAndStopEmptyNotificationToAvoidANR()',
          '        return START_STICKY',
          '    }',
        ].join('\n'),
        [
          '    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {',
          '        if (intent == null) return START_NOT_STICKY',
          '        startTask(getTaskConfig(intent))',
          '        startAndStopEmptyNotificationToAvoidANR()',
          '        return START_NOT_STICKY',
          '    }',
        ].join('\n'),
      );
      if (!next.includes(lyricPatchMarker)) {
        next = replaceAllRequired(
          next,
          target,
          'import android.content.Context\n',
          'import android.content.BroadcastReceiver\nimport android.content.Context\nimport android.content.IntentFilter\n',
        );
        next = replaceAllRequired(
          next,
          target,
          'import androidx.core.app.NotificationCompat.PRIORITY_LOW\n',
          'import androidx.core.app.NotificationCompat.PRIORITY_LOW\n',
        );
        next = replaceAllRequired(
          next,
          target,
          '    private var progressUpdateJob: Job? = null\n',
          [
            '    private var progressUpdateJob: Job? = null',
            '    // AURALFLOW_LYRIC_NOTIFICATION_ACTION',
            '    private var latestBaseNotification: Notification? = null',
            '    private var latestNotificationId: Int? = null',
            '    private var lyricNotificationReceiverRegistered = false',
            '    private val lyricNotificationStateReceiver = object : BroadcastReceiver() {',
            '        override fun onReceive(context: Context?, intent: Intent?) {',
            '            if (intent?.action == LYRIC_NOTIFICATION_STATE_CHANGED_ACTION) {',
            '                publishLyricNotification()',
            '            }',
            '        }',
            '    }',
            '',
          ].join('\n'),
        );
        next = replaceAllRequired(
          next,
          target,
          '    @MainThread\n    private fun setupForegrounding() {\n',
          [
            '    private fun registerLyricNotificationReceiver() {',
            '        if (lyricNotificationReceiverRegistered) return',
            '        val filter = IntentFilter(LYRIC_NOTIFICATION_STATE_CHANGED_ACTION)',
            '        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {',
            '            registerReceiver(lyricNotificationStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)',
            '        } else {',
            '            @Suppress("DEPRECATION")',
            '            registerReceiver(lyricNotificationStateReceiver, filter)',
            '        }',
            '        lyricNotificationReceiverRegistered = true',
            '    }',
            '',
            '    private fun buildLyricNotification(baseNotification: Notification): Notification {',
            '        val preferences = getSharedPreferences(LYRIC_OVERLAY_PREFERENCES_NAME, Context.MODE_PRIVATE)',
            '        if (!preferences.getBoolean(LYRIC_NOTIFICATION_BUTTON_ENABLED_KEY, true)) return baseNotification',
            '        val receiverClass = Class.forName(LYRIC_NOTIFICATION_RECEIVER_CLASS)',
            '        val toggleIntent = Intent(this, receiverClass).apply {',
            '            action = LYRIC_NOTIFICATION_TOGGLE_ACTION',
            '        }',
            '        val togglePendingIntent = PendingIntent.getBroadcast(',
            '            this,',
            '            43015,',
            '            toggleIntent,',
            '            getPendingIntentFlags()',
            '        )',
            '        val title = if (preferences.getBoolean(LYRIC_OVERLAY_VISIBLE_KEY, false)) "歌词关" else "歌词开"',
            '        val icon = resources.getIdentifier("ic_notification_lyrics", "drawable", packageName)',
            '            .takeIf { it != 0 } ?: baseNotification.smallIcon.resId',
            '        val action = NotificationCompat.Action.Builder(icon, title, togglePendingIntent).build()',
            '        return NotificationCompat.Builder(this, baseNotification)',
            '            .addAction(action)',
            '            .build()',
            '    }',
            '',
            '    private fun publishLyricNotification(): Notification? {',
            '        val baseNotification = latestBaseNotification ?: return null',
            '        val notificationId = latestNotificationId ?: return null',
            '        val builtNotification = buildLyricNotification(baseNotification)',
            '        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager',
            '        notificationManager.notify(notificationId, builtNotification)',
            '        return builtNotification',
            '    }',
            '',
            '    @MainThread',
            '    private fun setupForegrounding() {',
            '        registerLyricNotificationReceiver()',
            '',
          ].join('\n'),
        );
        next = replaceAllRequired(
          next,
          target,
          [
            '                        notificationId = it.notificationId;',
            '                        notification = it.notification;',
          ].join('\n'),
          [
            '                        latestNotificationId = it.notificationId',
            '                        latestBaseNotification = it.notification',
            '                        notificationId = it.notificationId',
            '                        notification = publishLyricNotification() ?: it.notification',
          ].join('\n'),
        );
        next = replaceAllRequired(
          next,
          target,
          '    override fun onDestroy() {\n        super.onDestroy()\n',
          [
            '    override fun onDestroy() {',
            '        if (lyricNotificationReceiverRegistered) {',
            '            unregisterReceiver(lyricNotificationStateReceiver)',
            '            lyricNotificationReceiverRegistered = false',
            '        }',
            '        super.onDestroy()',
            '',
          ].join('\n'),
        );
      }
      if (!next.includes('LYRIC_OVERLAY_PREFERENCES_NAME =')) {
        next = replaceAllRequired(
          next,
          target,
          '        const val DEFAULT_STOP_FOREGROUND_GRACE_PERIOD = 5\n',
          `        const val DEFAULT_STOP_FOREGROUND_GRACE_PERIOD = 5\n${lyricConstants}\n`,
        );
      }
      return next;
    },
    replacements: [
      { from: '        val notificationConfig = NotificationConfig(buttonsList, accentColor, smallIcon, pendingIntent)\n\n        player.notificationManager.createNotification(notificationConfig)\n', to: '        val baseNotificationConfig = NotificationConfig(buttonsList, accentColor, smallIcon, pendingIntent)\n\n        player.notificationManager.createNotification(baseNotificationConfig)\n' },
      // 注意：4.1.2 原生 setRate 只有单参数（playbackSpeed），不支持独立变调（pitch），
      // 因此这里不再包含任何 pitch 相关的补丁条目（历史遗留条目对 4.1.2 是无效 no-op）。
    ],
  },
  {
    target: 'android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt',
    // 批量修复：track-player 4.1.2 有 36 个单行表达式体 @ReactMethod（fun x(...) = scope.launch {}），
    // 全部返回 Job（非 void），违反 RN 0.86 TurboModule interop 的“异步方法必须返回 void”规则，
    // 启动时崩溃：Unable to parse @ReactMethod annotations from TrackPlayerModule。
    // 逐个转成块体 { scope.launch {} } 使其返回 Unit/void。
    // （两行式的 updateMetadataForTrack 由下方 replacements 单独处理。）
    transform: (content) => {
      const lines = content.split('\n');
      const out = [];
      let inMethod = false;
      const funRe = /^(\s*)fun\s+\w+\(.*\)\s*=\s*scope\.launch\s*\{\s*$/;
      for (const line of lines) {
        if (!inMethod) {
          if (funRe.test(line)) {
            out.push(line.replace(/=\s*scope\.launch\s*\{\s*$/, '{ scope.launch {'));
            inMethod = true;
            continue;
          }
          out.push(line);
        } else {
          // 方法级（4 空格缩进）的闭合括号，即 launch/方法结束处，补一个 } 平衡块体
          if (/^    \}\s*$/.test(line)) {
            out.push(line);
            out.push('    }');
            inMethod = false;
            continue;
          }
          out.push(line);
        }
      }
      return out.join('\n');
    },
    replacements: [
      // RN 新架构（0.86）TurboModule interop 解析 @ReactMethod 时要求
      // “返回类型为 void 当且仅当方法同步”。updateMetadataForTrack 是唯一用
      // 表达式体（= scope.launch {}）的异步方法，返回 Job（非 void），会在启动时
      // 崩溃：Unable to parse @ReactMethod annotations from native module: TrackPlayerModule。
      // 改为块体 { scope.launch {} } 使其返回 Unit/void，与同文件其它方法一致。
      {
        from:
          '    fun updateMetadataForTrack(index: Int, map: ReadableMap?, callback: Promise) =\n' +
          '        scope.launch {\n',
        to:
          '    fun updateMetadataForTrack(index: Int, map: ReadableMap?, callback: Promise) { scope.launch {\n',
      },
      {
        from:
          '                callback.resolve(null)\n' +
          '            }\n' +
          '        }\n' +
          '\n' +
          '    @ReactMethod\n' +
          '    fun updateNowPlayingMetadata',
        to:
          '                callback.resolve(null)\n' +
          '            }\n' +
          '        }\n' +
          '    }\n' +
          '\n' +
          '    @ReactMethod\n' +
          '    fun updateNowPlayingMetadata',
      },
      // track-player 4.1.2 的 getTrack/getActiveTrack 把可空的 originalItem: Bundle?
      // 直接传给 RN 0.86 要求非空 Bundle 的 Arguments.fromBundle()，Kotlin 编译报
      // "Argument type mismatch: actual type is 'Bundle?', but 'Bundle' was expected"。
      // 用 ?.let 包一层，null 时解析为 null（与原 fallback 行为一致）。
      {
        from: '            callback.resolve(Arguments.fromBundle(musicService.tracks[index].originalItem))\n',
        to: '            callback.resolve(musicService.tracks[index].originalItem?.let { Arguments.fromBundle(it) })\n',
      },
      {
        from:
          '            if (musicService.tracks.isEmpty()) null\n' +
          '            else Arguments.fromBundle(\n' +
          '                musicService.tracks[musicService.getCurrentTrackIndex()].originalItem\n' +
          '            )\n',
        to:
          '            if (musicService.tracks.isEmpty()) null\n' +
          '            else musicService.tracks[musicService.getCurrentTrackIndex()].originalItem?.let {\n' +
          '                Arguments.fromBundle(it)\n' +
          '            }\n',
      },
    ],
  },
];

const packageJsonPath = path.join(baseDir, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  console.error(`File not found: ${packageJsonPath}`);
  process.exit(1);
}
const installedVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version;
if (installedVersion !== RNTP_VERSION) {
  console.error(`Unsupported react-native-track-player version: expected ${RNTP_VERSION}, found ${installedVersion}`);
  process.exit(1);
}

for (const { target, replacements, transform } of files) {
  const filePath = path.join(baseDir, target);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  let content = fs.readFileSync(filePath, 'utf-8');
  // 先跑批量 transform（若有），再跑精确 replacements
  if (typeof transform === 'function') {
    content = transform(content, target);
  }
  for (const { from, to, optional } of replacements ?? []) {
    content = replaceAllRequired(content, target, from, to, optional);
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Patched: ${target}`);
}

const keepAwakeDir = path.join(__dirname, 'node_modules', 'react-native-keep-awake');
const keepAwakePackageJsonPath = path.join(keepAwakeDir, 'package.json');
if (!fs.existsSync(keepAwakePackageJsonPath)) {
  console.error(`File not found: ${keepAwakePackageJsonPath}`);
  process.exit(1);
}
const installedKeepAwakeVersion = JSON.parse(fs.readFileSync(keepAwakePackageJsonPath, 'utf-8')).version;
if (installedKeepAwakeVersion !== KEEP_AWAKE_VERSION) {
  console.error(`Unsupported react-native-keep-awake version: expected ${KEEP_AWAKE_VERSION}, found ${installedKeepAwakeVersion}`);
  process.exit(1);
}
const keepAwakeBuildGradlePath = path.join(keepAwakeDir, 'android', 'build.gradle');
let keepAwakeBuildGradle = fs.readFileSync(keepAwakeBuildGradlePath, 'utf-8');
keepAwakeBuildGradle = replaceAllRequired(
  keepAwakeBuildGradle,
  'react-native-keep-awake/android/build.gradle',
  '        jcenter()\n',
  '        mavenCentral()\n',
);
fs.writeFileSync(keepAwakeBuildGradlePath, keepAwakeBuildGradle, 'utf-8');
console.log('Patched: react-native-keep-awake/android/build.gradle');

console.log('Mobile dependency patches applied manually.');
