const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, before, after } = require('node:test');

const nativeDir = path.resolve(__dirname, '../android/app/src/main/java/cn/chenle/auralflow/mobile');
const deadline = Date.now() + 55000;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'auralflow-local-tag-test-'));
const gradleHome = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');
const dependencyDir = path.join(gradleHome, 'caches/modules-2/files-2.1/net.jthink/jaudiotagger/3.0.1');
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
  jar = process.env.JAUDIOTAGGER_JAR;
  if (!jar) {
    assert.ok(fs.existsSync(dependencyDir), 'Set JAUDIOTAGGER_JAR to the actual net.jthink:jaudiotagger:3.0.1 jar, or resolve the Android Gradle dependency first');
    jar = fs.readdirSync(dependencyDir).map(hash => path.join(dependencyDir, hash, 'jaudiotagger-3.0.1.jar')).find(file => fs.existsSync(file));
  }
  assert.ok(jar && fs.existsSync(jar), 'Actual jaudiotagger 3.0.1 jar is required; do not skip this regression');
  const source = fs.readFileSync(path.join(nativeDir, 'LocalMusicModule.java'), 'utf8');
  // 仅替换 Android 边界；被测写入方法直接取自 Native 源码，不复制业务实现。
  const methods = ['writeTagToFile', 'copyStream', 'getAudioDisplayName'].flatMap(name => {
    const match = source.match(new RegExp(`^  private (?:static )?[^\\n]+ ${name}\\([^]*?^  }`, 'm'));
    if (!match) {
      assert.notEqual(name, 'writeTagToFile', `Missing native method: ${name}`);
      return [];
    }
    return match[0].replaceAll('android.app.RecoverableSecurityException', 'RecoverableSecurityException');
  }).join('\n');
  const harness = fs.readFileSync(path.join(__dirname, 'fixtures/local-tag-edit/LocalTagEditHarness.java'), 'utf8');
  const harnessPath = path.join(work, 'LocalTagEditHarness.java');
  fs.writeFileSync(harnessPath, harness.replace('/* NATIVE_WRITE_METHODS */', methods));
  const helper = path.join(nativeDir, 'LocalTagEditor.java');
  run(javaTool('javac'), ['-encoding', 'UTF-8', '-cp', jar, '-d', work, harnessPath, ...(fs.existsSync(helper) ? [helper] : [])]);
  for (const [extension, codec, extra = []] of [
    ['mp3', 'libmp3lame'], ['flac', 'flac'], ['wav', 'pcm_s16le', ['-fflags', '+bitexact']], ['info.wav', 'pcm_s16le'],
    ['m4a', 'aac'], ['ogg', 'libvorbis'], ['aiff', 'pcm_s16be'],
    ['bare.mp3', 'libmp3lame', ['-id3v2_version', '0', '-write_xing', '0']],
    ['aac', 'aac'], ['opus', 'libopus'],
  ]) {
    run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=0.3', '-c:a', codec, ...extra, path.join(work, `fixture.${extension}`)]);
  }
});
after(() => {
  const resolved = path.resolve(work);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('auralflow-local-tag-test-'));
  fs.rmSync(resolved, { recursive: true });
});
function scenario(...args) {
  return run(javaTool('java'), ['-cp', `${work}${path.delimiter}${jar}`,
    'cn.chenle.auralflow.mobile.LocalTagEditHarness', work, ...args]);
}
test('actual jaudiotagger reproduces No Reader for valid MP3 copied to .tmp', () => {
  assert.match(scenario('legacy'), /No Reader associated with this extension:tmp/);
});
for (const format of ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'aiff']) {
  test(`native shared write path round-trips lyrics and cover without transcoding: ${format}`, () => {
    scenario('roundtrip', format);
    const hash = file => run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error',
      '-i', path.join(work, file), '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 'hash', '-hash', 'sha256', '-']);
    assert.equal(hash(`source-roundtrip.${format}`), hash(`fixture.${format}`), 'Decoded audio samples changed');
  });
}
for (const mode of ['unknown-name', 'mime-only', 'misnamed', 'bare-mp3', 'unknown-format', 'unsupported-aac',
  'unsupported-opus', 'wav-lyrics-unsupported', 'invalid-known', 'mutator-failure', 'input-failure', 'null-input', 'partial-write', 'close-failure',
  'open-failure', 'open-unmodified-failure', 'write-security', 'null-output', 'restore-failure', 'permission']) {
  test(`native shared write path: ${mode}`, () => scenario(mode));
}
