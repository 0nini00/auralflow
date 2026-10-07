const fs = require('fs');
const path = require('path');

const VIDEO_VERSION = '6.19.2';
const MARKER = 'AURALFLOW_VIDEO_RELEASE_V1';
const baseDir = path.join(__dirname, 'node_modules', 'react-native-video');

const pauseAnchor = [
  '    const pause = useCallback(() => {',
  '      return NativeVideoManager.setPlayerPauseStateCmd(',
  '        getReactTag(nativeRef),',
  '        true,',
  '      );',
  '    }, []);',
  '',
  '    const resume = useCallback(() => {',
].join('\n');
const releaseCallback = [
  `    // ${MARKER}: 等待原生释放确认，不以 pause 或 ref(null) 代替。`,
  '    const release = useCallback(async (): Promise<void> => {',
  "      if (Platform.OS !== 'android') {",
  "        throw new Error('VideoRef.release 目前仅支持 Android');",
  '      }',
  "      if (typeof NativeVideoManager?.releasePlayerCmd !== 'function') {",
  "        throw new Error('当前安装包不支持视频释放确认，请安装包含 releasePlayerCmd 的新 APK');",
  '      }',
  '      await NativeVideoManager.releasePlayerCmd(getReactTag(nativeRef));',
  '    }, []);',
  '',
].join('\n');

const nativeRelease = [
  `    // ${MARKER}: cleanup 完成后才能恢复其它音频播放器。`,
  '    @ReactMethod',
  '    fun releasePlayerCmd(reactTag: Int, promise: Promise) {',
  '        try {',
  '            UiThreadUtil.runOnUiThread {',
  '                try {',
  '                    val uiManager = UIManagerHelper.getUIManager(',
  '                        reactApplicationContext,',
  '                        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) UIManagerType.FABRIC else UIManagerType.DEFAULT',
  '                    )',
  '                    val view = uiManager?.resolveView(reactTag)',
  '                    if (view !is ReactExoplayerView) {',
  '                        promise.reject("E_VIDEO_RELEASE_VIEW", "Cannot resolve video view $reactTag")',
  '                        return@runOnUiThread',
  '                    }',
  '                    view.cleanUpResources()',
  '                    promise.resolve(null)',
  '                } catch (error: Exception) {',
  '                    promise.reject("E_VIDEO_RELEASE", "Cannot release video view $reactTag", error)',
  '                }',
  '            }',
  '        } catch (error: Exception) {',
  '            promise.reject("E_VIDEO_RELEASE_DISPATCH", "Cannot dispatch video release to UI thread", error)',
  '        }',
  '    }',
  '',
].join('\n');

const files = [
  {
    target: 'src/Video.tsx',
    collision: 'releasePlayerCmd',
    replacements: [
      {
        from: pauseAnchor,
        to: pauseAnchor.replace('    const resume = useCallback(() => {', releaseCallback + '    const resume = useCallback(() => {'),
      },
      {
        from: '        pause,\n        resume,',
        to: '        pause,\n        release,\n        resume,',
        count: 2,
      },
    ],
  },
  ...[
    ['src/types/video-ref.ts', '  '],
    ['lib/types/video-ref.d.ts', '    '],
  ].map(([target, indent]) => ({
    target,
    collision: 'release:',
    replacements: [{
      from: `${indent}pause: () => void;\n`,
      to: `${indent}pause: () => void;\n${indent}// ${MARKER}: Android 原生资源释放完成后 resolve。\n${indent}release: () => Promise<void>;\n`,
    }],
  })),
  {
    target: 'src/specs/NativeVideoManager.ts',
    collision: 'releasePlayerCmd',
    replacements: [{
      from: '  setPlayerPauseStateCmd: (reactTag: Int32, paused: boolean) => Promise<void>;\n',
      to: '  setPlayerPauseStateCmd: (reactTag: Int32, paused: boolean) => Promise<void>;\n' +
        `  // ${MARKER}\n` +
        '  releasePlayerCmd: (reactTag: Int32) => Promise<void>;\n',
    }],
  },
  {
    target: 'android/src/main/java/com/brentvatne/react/VideoManagerModule.kt',
    collision: 'releasePlayerCmd',
    replacements: [{
      from: '    companion object {\n',
      to: nativeRelease + '    companion object {\n',
    }],
  },
];

function count(content, text) {
  return content.split(text).length - 1;
}

function drift(target, detail) {
  throw new Error(`react-native-video ${VIDEO_VERSION} patch anchor drift in ${target}: ${detail}`);
}

function transform(original, { target, replacements, collision }) {
  const content = original.replaceAll('\r\n', '\n');
  const markerCount = count(content, MARKER);
  if (markerCount > 1) drift(target, 'duplicate patch marker');
  if (markerCount === 1) {
    for (const { from, to, count: expected = 1 } of replacements) {
      if (count(content, to) !== expected || count(content.split(to).join(''), from) !== 0) {
        drift(target, 'installed patch is incomplete or modified');
      }
    }
    return original;
  }
  if (content.includes(collision)) drift(target, 'unrecognized release implementation');
  let next = content;
  for (const { from, to, count: expected = 1 } of replacements) {
    if (count(next, from) !== expected) drift(target, 'missing or duplicated upstream anchor');
    next = next.split(from).join(to);
  }
  return original.includes('\r\n') ? next.replaceAll('\n', '\r\n') : next;
}

function applyVideoReleasePatch() {
  const packageJsonPath = path.join(baseDir, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (metadata.name !== 'react-native-video' || metadata.version !== VIDEO_VERSION) {
    throw new Error(`Unsupported react-native-video version: expected ${VIDEO_VERSION}, found ${metadata.name}@${metadata.version}`);
  }
  // 所有文件先校验，再写入；版本或任一锚点漂移不能留下半套契约。
  const changes = files.map(file => {
    const filePath = path.join(baseDir, file.target);
    const original = fs.readFileSync(filePath, 'utf8');
    return { filePath, target: file.target, original, next: transform(original, file) };
  });
  for (const { filePath, target, original, next } of changes) {
    if (original === next) continue;
    fs.writeFileSync(filePath, next, 'utf8');
    console.log(`Patched: react-native-video/${target}`);
  }
}

module.exports = applyVideoReleasePatch;
if (require.main === module) applyVideoReleasePatch();
