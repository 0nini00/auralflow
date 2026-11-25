const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, before, after } = require('node:test');

const nativeDir = path.resolve(__dirname, '../android/app/src/main/java/cn/chenle/auralflow/mobile');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'auralflow-scan-native-test-'));
let jar;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: work, encoding: 'utf8', timeout: 25000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined, `${command}: ${result.error}`);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function javaTool(name) {
  return process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
}

function extract(source, name) {
  return source.match(new RegExp(`^  (?:public|private) (?:static )?[^\\n]+ ${name}\\([^]*?^  }`, 'm'))?.[0] ?? '';
}

before(() => {
  const gradleHome = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');
  const dependencyDir = path.join(gradleHome, 'caches/modules-2/files-2.1/net.jthink/jaudiotagger/3.0.1');
  jar = process.env.JAUDIOTAGGER_JAR || fs.readdirSync(dependencyDir)
    .map(hash => path.join(dependencyDir, hash, 'jaudiotagger-3.0.1.jar')).find(file => fs.existsSync(file));
  assert.ok(jar && fs.existsSync(jar), '扫描回归必须使用真实 jaudiotagger 3.0.1');
  const source = fs.readFileSync(path.join(nativeDir, 'LocalMusicModule.java'), 'utf8');
  const methods = ['scanLocalMusicInBackground', 'buildScanSignature', 'buildDirectoryCoverSignature',
    'appendSignaturePart', 'appendFileStamp', 'safeString', 'applyLyrics']
    .map(name => extract(source, name)).join('\n').replaceAll('LocalMusicModule::', 'LocalMusicScanHarness::');
  assert.ok(methods.includes('scanLocalMusicInBackground('));
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/local-music-scan/LocalMusicScanHarness.java'), 'utf8');
  const harness = path.join(work, 'LocalMusicScanHarness.java');
  fs.writeFileSync(harness, fixture.replace('/* METHODS */', methods));
  run(javaTool('javac'), ['-encoding', 'UTF-8', '-Xlint:all', '-cp', jar, '-d', work, harness,
    ...['ScanDirectorySignatures.java', 'LocalTagEditor.java', 'LocalAudioAssetsReader.java'].map(name => path.join(nativeDir, name))]);
  for (const [extension, codec] of [['mp3', 'libmp3lame'], ['aac', 'aac']]) {
    run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=0.3', '-c:a', codec, path.join(work, `fixture.${extension}`)]);
  }
}, { timeout: 60000 });

after(() => {
  const resolved = path.resolve(work);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('auralflow-scan-native-test-'));
  fs.rmSync(resolved, { recursive: true });
});

for (const mode of ['aac-sidecar', 'broken-tag', 'sidecar-error', 'unchanged', 'query-error', 'signature-change']) {
  test(`原生扫描保留完整曲目并区分可选资料错误：${mode}`, { timeout: 30000 }, () => {
    assert.match(run(javaTool('java'), ['-cp', `${work}${path.delimiter}${jar}`,
      'cn.chenle.auralflow.mobile.LocalMusicScanHarness', work, mode]), new RegExp(`PASS ${mode}`));
  });
}
