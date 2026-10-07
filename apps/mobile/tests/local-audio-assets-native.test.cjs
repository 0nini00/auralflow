const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, before, after } = require('node:test');

const nativeDir = path.resolve(__dirname, '../android/app/src/main/java/cn/chenle/auralflow/mobile');
const deadline = Date.now() + 55000;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'auralflow-audio-assets-test-'));
const gradleHome = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');
let jar;
function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', timeout: Math.max(1, Math.min(15000, deadline - Date.now())),
    maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined, `${command}: ${result.error}`);
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function javaTool(name) {
  return process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
}
before(() => {
  const source = fs.readFileSync(path.join(nativeDir, 'LocalMusicModule.java'), 'utf8');
  assert.match(source, /@ReactMethod\s+public void readAudioAssets\(String \w+, Promise promise\)/,
    'Missing approved readAudioAssets native API');
  jar = process.env.JAUDIOTAGGER_JAR;
  if (!jar) {
    const dependencyDir = path.join(gradleHome, 'caches/modules-2/files-2.1/net.jthink/jaudiotagger/3.0.1');
    assert.ok(fs.existsSync(dependencyDir), 'Actual jaudiotagger 3.0.1 JAR is required');
    jar = fs.readdirSync(dependencyDir).map(hash => path.join(dependencyDir, hash, 'jaudiotagger-3.0.1.jar'))
      .find(file => fs.existsSync(file));
  }
  assert.ok(jar && fs.existsSync(jar), 'Set JAUDIOTAGGER_JAR; do not skip the actual-library test');
  // 只替换 Android/RN 边界；Native API、线程与生命周期方法直接从当前源码编译。
  const methods = ['readAudioAssets', 'readLocalAudioAssets', 'getAudioAssetsFile', 'getAudioDisplayName', 'invalidate']
    .map(name => {
      const match = source.match(new RegExp(`^  (?:public|private) (?:static )?[^\\n]+ ${name}\\([^]*?^  }`, 'm'));
      assert.ok(match, `Missing native method: ${name}`);
      return match[0];
    }).join('\n');
  const executor = source.match(/^  private final ExecutorService audioAssetsExecutor = [^]*?;$/m);
  assert.ok(executor, 'Reader must own a background executor');
  const harness = fs.readFileSync(path.join(__dirname, 'fixtures/local-audio-assets/LocalAudioAssetsHarness.java'), 'utf8');
  const harnessPath = path.join(work, 'LocalAudioAssetsHarness.java');
  fs.writeFileSync(harnessPath, harness.replace('/* NATIVE_READ_METHODS */', executor[0] + '\n' + methods));
  run(javaTool('javac'), ['-encoding', 'UTF-8', '-Xlint:all', '-cp', jar, '-d', work,
    harnessPath, path.join(nativeDir, 'LocalTagEditor.java'), path.join(nativeDir, 'LocalAudioAssetsReader.java')]);
  for (const [extension, codec, extra = []] of [
    ['mp3', 'libmp3lame'], ['flac', 'flac'], ['m4a', 'aac'], ['aac', 'aac'], ['opus', 'libopus'],
    ['bare.mp3', 'libmp3lame', ['-id3v2_version', '0', '-write_xing', '0']],
  ]) {
    run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=0.3', '-c:a', codec, ...extra, path.join(work, `fixture.${extension}`)]);
  }
});
after(() => {
  const resolved = path.resolve(work);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('auralflow-audio-assets-test-'));
  fs.rmSync(resolved, { recursive: true });
});
for (const mode of ['file-space', 'file-hash', 'file-percent', 'file-unicode', 'uri-boundaries',
  'embedded', 'sidecars', 'signature', 'limits', 'failures', 'publication', 'async']) {
  test(`read-only native audio assets: ${mode}`, { timeout: 15000 }, () => {
    assert.match(run(javaTool('java'), ['-cp', `${work}${path.delimiter}${jar}`,
      'cn.chenle.auralflow.mobile.LocalAudioAssetsHarness', work, mode]), new RegExp(`PASS ${mode}`));
  });
}
test('reader never enters tag writes or database updates; invalidate exists once', () => {
  const reader = fs.readFileSync(path.join(nativeDir, 'LocalAudioAssetsReader.java'), 'utf8');
  assert.doesNotMatch(reader, /\.commit\(|\.setField\(|\.deleteField\(|LocalTagEditor\.write\(|openOutputStream\(/);
  const source = fs.readFileSync(path.join(nativeDir, 'LocalMusicModule.java'), 'utf8');
  assert.equal((source.match(/public void invalidate\(/g) || []).length, 1);
  assert.match(source, /MAX_LOCAL_LYRICS_BYTES = LocalAudioAssetsReader\.MAX_LYRICS_BYTES/);
});
