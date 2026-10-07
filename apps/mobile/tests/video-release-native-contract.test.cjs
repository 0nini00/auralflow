const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { mobileRequire, deferred } = require('./helpers/loadTs.cjs');
const ts = mobileRequire('typescript');
const options = { timeout: 5000 };
const mobileDir = path.resolve(__dirname, '..');
const patchPath = path.join(mobileDir, 'apply-video-release-patch.js');
const installed = path.join(mobileDir, 'node_modules/react-native-video');
const videoPath = 'src/Video.tsx';
const refPath = 'src/types/video-ref.ts';
const specPath = 'src/specs/NativeVideoManager.ts';
const declarationPath = 'lib/types/video-ref.d.ts';
const nativePath = 'android/src/main/java/com/brentvatne/react/VideoManagerModule.kt';
const targets = [videoPath, refPath, specPath, declarationPath, nativePath];

function fixture() {
  return new Map([
    ['package.json', JSON.stringify({ name: 'react-native-video', version: '6.19.2' })],
    [videoPath, [
      '    const pause = useCallback(() => {',
      '      return NativeVideoManager.setPlayerPauseStateCmd(',
      '        getReactTag(nativeRef),',
      '        true,',
      '      );',
      '    }, []);',
      '',
      '    const resume = useCallback(() => {',
      '      return NativeVideoManager.setPlayerPauseStateCmd(getReactTag(nativeRef), false);',
      '    }, []);',
      '    useImperativeHandle(',
      '      ref,',
      '      () => ({',
      '        pause,',
      '        resume,',
      '      }),',
      '      [',
      '        pause,',
      '        resume,',
      '      ],',
      '    );',
      '',
    ].join('\n')],
    [refPath, 'export interface VideoRef {\n  pause: () => void;\n  presentFullscreenPlayer: () => void;\n}\n'],
    [declarationPath, 'export interface VideoRef {\n    pause: () => void;\n    presentFullscreenPlayer: () => void;\n}\n'],
    [specPath, 'export interface VideoManagerType {\n  setPlayerPauseStateCmd: (reactTag: Int32, paused: boolean) => Promise<void>;\n}\n'],
    [nativePath, [
      'class VideoManagerModule {',
      '    @ReactMethod',
      '    fun getCurrentPosition(reactTag: Int, promise: Promise) {',
      '        performOnPlayerView(reactTag) {',
      '            it?.getCurrentPosition(promise)',
      '        }',
      '    }',
      '',
      '    companion object {',
      '        private const val REACT_CLASS = "VideoManager"',
      '    }',
      '}',
      '',
    ].join('\n')],
  ]);
}

function apply(files) {
  const writes = [];
  const nameOf = filename => {
    const relative = path.relative(installed, filename).replaceAll('\\', '/');
    assert.ok(!relative.startsWith('..'), '补丁不得写出 RNV 依赖目录');
    return relative;
  };
  const memoryFs = {
    existsSync: filename => files.has(nameOf(filename)),
    readFileSync: filename => { const name = nameOf(filename); assert.ok(files.has(name), '文件缺失: ' + name); return files.get(name); },
    writeFileSync: (filename, content) => { const name = nameOf(filename); writes.push(name); files.set(name, content); },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(patchPath, 'utf8'), {
    __dirname: mobileDir, module,
    require: name => { if (name === 'fs') return memoryFs; if (name === 'path') return path; throw new Error('未声明补丁依赖: ' + name); },
    console: { log() {} },
  }, { filename: patchPath, timeout: 5000 });
  assert.equal(typeof module.exports, 'function');
  module.exports();
  return writes;
}

function releaseCallback(source, manager, { platform = 'android', reactTag = () => 71 } = {}) {
  const parsed = ts.createSourceFile(videoPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'release') initializer = node.initializer.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.ok(initializer, '必须通过真实 Video.tsx 暴露 release');
  const code = ts.transpileModule('module.exports = ' + initializer, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('module', 'useCallback', 'NativeVideoManager', 'Platform', 'getReactTag', 'nativeRef', code)(
    module, callback => callback, manager, { OS: platform }, reactTag, { current: {} },
  );
  return module.exports;
}

function assertContract(files) {
  const video = files.get(videoPath);
  assert.match(video, /const release = useCallback\(async/);
  assert.equal((video.match(/^        release,$/gm) ?? []).length, 2, 'imperative handle 和依赖列表都应包含 release');
  assert.match(files.get(refPath), /release: \(\) => Promise<void>;/);
  assert.match(files.get(declarationPath), /release: \(\) => Promise<void>;/);
  assert.match(files.get(specPath), /releasePlayerCmd: \(reactTag: Int32\) => Promise<void>;/);
  const native = files.get(nativePath);
  const method = native.slice(native.indexOf('    fun releasePlayerCmd('), native.indexOf('    companion object {'));
  assert.match(method, /reactTag: Int, promise: Promise/);
  assert.match(method, /UiThreadUtil\.runOnUiThread/);
  assert.match(method, /UIManagerHelper\.getUIManager/);
  assert.match(method, /IS_NEW_ARCHITECTURE_ENABLED/);
  assert.match(method, /resolveView\(reactTag\)/);
  assert.match(method, /view !is ReactExoplayerView/);
  assert.doesNotMatch(method, /performOnPlayerView|setPausedModifier|setSrc\(/);
  assert.equal((method.match(/promise\.resolve\(null\)/g) ?? []).length, 1);
  assert.ok(method.indexOf('view.cleanUpResources()') < method.indexOf('promise.resolve(null)'));
  assert.match(method, /catch \(\w+: Exception\)/);
  assert.match(method, /promise\.reject\(/);
}

test('视频 release 原生边界补丁入口存在', options, () => {
  assert.equal(fs.existsSync(patchPath), true, '需要新增 apply-video-release-patch.js');
});

// 首次红灯只报告缺失能力；补丁存在后执行同一真实入口和全部契约用例。
if (fs.existsSync(patchPath)) {
  test('原始锚点应用后形成完整 JS/类型/Android 契约', options, () => {
    const files = fixture(); assert.equal(apply(files).length, targets.length); assertContract(files);
  });
  test('重复应用字节级幂等且不重复写入', options, () => {
    const files = fixture(); apply(files); const once = new Map(files);
    assert.deepEqual(apply(files), []); assert.deepEqual(files, once);
  });
  test('CRLF 源码仍保持字节级幂等', options, () => {
    const files = fixture(); for (const [name, content] of files) files.set(name, content.replaceAll('\n', '\r\n'));
    apply(files); const once = new Map(files); assert.deepEqual(apply(files), []); assert.deepEqual(files, once);
  });
  test('版本漂移在任何写入前失败', options, () => {
    const files = fixture(); files.set('package.json', JSON.stringify({ name: 'react-native-video', version: '6.20.0' }));
    const before = new Map(files); assert.throws(() => apply(files), /version|版本/i); assert.deepEqual(files, before);
  });
  test('最后一个原生锚点漂移也不会部分写入其它文件', options, () => {
    const files = fixture(); files.set(nativePath, files.get(nativePath).replace('    companion object {', '    companion object Drift {'));
    const before = new Map(files); assert.throws(() => apply(files), /anchor|锚点|drift|漂移/i); assert.deepEqual(files, before);
  });
  test('重复原始锚点必须失败，不批量注入重复命令', options, () => {
    const files = fixture(); files.set(refPath, files.get(refPath) + files.get(refPath));
    const before = new Map(files); assert.throws(() => apply(files), /anchor|锚点|drift|漂移/i); assert.deepEqual(files, before);
  });
  test('已有标记但补丁被改坏必须失败，不能伪装已安装', options, () => {
    const files = fixture(); apply(files); files.set(nativePath, files.get(nativePath).replace('view.cleanUpResources()', 'view.setPausedModifier(true)'));
    const before = new Map(files); assert.throws(() => apply(files), /anchor|锚点|drift|漂移/i); assert.deepEqual(files, before);
  });
  test('release Promise 只在原生确认后完成', options, async () => {
    const files = fixture(); apply(files); const gate = deferred(); const calls = [];
    const release = releaseCallback(files.get(videoPath), { releasePlayerCmd: tag => { calls.push(tag); return gate.promise; } });
    let settled = false; const pending = release().then(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false); assert.deepEqual(calls, [71]);
    gate.resolve(); await pending; assert.equal(settled, true);
  });
  test('旧 APK 缺少命令时明确拒绝，不退回 pause 或 setSource', options, async () => {
    const files = fixture(); apply(files); let fallback = false;
    const release = releaseCallback(files.get(videoPath), { setPlayerPauseStateCmd: () => { fallback = true; }, setSourceCmd: () => { fallback = true; } });
    await assert.rejects(release(), /新\s*APK/); assert.equal(fallback, false);
  });
  test('原生拒绝与找不到组件错误原样传播', options, async () => {
    const files = fixture(); apply(files); const error = new Error('native release failed');
    await assert.rejects(releaseCallback(files.get(videoPath), { releasePlayerCmd: async () => { throw error; } })(), error);
    const missing = new Error('Video Component is not mounted');
    await assert.rejects(releaseCallback(files.get(videoPath), { releasePlayerCmd() { assert.fail('不能发出无效视图命令'); } }, { reactTag: () => { throw missing; } })(), missing);
  });
  test('不支持的平台明确拒绝，不宣称释放成功', options, async () => {
    const files = fixture(); apply(files);
    await assert.rejects(releaseCallback(files.get(videoPath), { releasePlayerCmd() { assert.fail('仅 Android'); } }, { platform: 'ios' })(), /Android/);
  });
  test('已安装依赖具备完整契约且二次检查不写入', options, () => {
    const files = new Map(['package.json', ...targets].map(name => [name, fs.readFileSync(path.join(installed, name), 'utf8').replaceAll('\r\n', '\n')]));
    assertContract(files); assert.deepEqual(apply(files), []);
    const view = fs.readFileSync(path.join(installed, 'android/src/main/java/com/brentvatne/exoplayer/ReactExoplayerView.java'), 'utf8');
    assert.match(view, /public void cleanUpResources\(\) \{\s*stopPlayback\(\)/);
    assert.match(view, /private void onStopPlayback\(\) \{\s*audioManager\.abandonAudioFocus/);
  });
  test('现有安装入口末尾调用新补丁，不改 package 或锁文件', options, () => {
    const entry = fs.readFileSync(path.join(mobileDir, 'apply-track-player-patch.js'), 'utf8');
    assert.match(entry.trimEnd().split(/\r?\n/).at(-1), /require\(.*apply-video-release-patch\.js.*\)\(\);/);
  });
}
