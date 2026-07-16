const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, 'node_modules', 'react-native-track-player');

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
    // 变调功能以 setRate(rate, pitch) 两参调用，但 track-player 的 TS 声明只有单参，
    // 会导致 androidPitchService.ts typecheck 报 "Expected 1 arguments, but got 2"。
    // 把 pitch 补成可选参数，与原生侧的两参 setRate 对齐。
    target: 'lib/src/trackPlayer.d.ts',
    replacements: [
      {
        from: 'export declare function setRate(rate: number): Promise<void>;',
        to: 'export declare function setRate(rate: number, pitch?: number): Promise<void>;',
      },
    ],
  },
  {
    target: 'android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt',
    transform: (content, target) => {
      let next = content;
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
      return next;
    },
    replacements: [
      { from: 'import com.google.android.exoplayer2.PlaybackParameters\n', to: '', optional: true },
      { from: '    fun getPitch(): Float = player.playbackParameters?.pitch ?: 1f\n', to: '    fun getPitch(): Float = player.playbackSpeed\n', optional: true },
      { from: '    fun setRate(value: Float, pitch: Float = value) {\n        player.playbackParameters = PlaybackParameters(value, pitch)\n    }\n', to: '    fun setRate(value: Float) {\n        player.playbackSpeed = value\n    }\n' },
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
      { from: '        musicService.setRate(rate, pitch)\n', to: '        musicService.setRate(rate)\n' },
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

console.log('Track player patch applied manually.');
