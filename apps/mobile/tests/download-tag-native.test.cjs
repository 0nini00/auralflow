const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, before, after } = require('node:test');

const nativeDir = path.resolve(__dirname, '../android/app/src/main/java/cn/chenle/auralflow/mobile');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'auralflow-download-tag-test-'));
let jar;
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 25000, windowsHide: true });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function javaTool(name) { return process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name; }
before(() => {
  const dependencyDir = path.join(process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle'),
    'caches/modules-2/files-2.1/net.jthink/jaudiotagger/3.0.1');
  jar = process.env.JAUDIOTAGGER_JAR || fs.readdirSync(dependencyDir)
    .map(hash => path.join(dependencyDir, hash, 'jaudiotagger-3.0.1.jar')).find(file => fs.existsSync(file));
  assert.ok(jar && fs.existsSync(jar));
  const source = fs.readFileSync(path.join(nativeDir, 'DownloadTagModule.java'), 'utf8');
  const methods = ['writeMp3Tags', 'writeMp3TagsInBackground', 'setText', 'requirePrivateFile', 'invalidate']
    .map(name => {
      const match = source.match(new RegExp(`^  (?:public|private) (?:static )?[^\\n]+ ${name}\\([^]*?^  }`, 'm'));
      assert.ok(match, `Missing native method: ${name}`);
      return match[0];
    }).join('\n');
  const executor = source.match(/^  private final ExecutorService executor = [^]*?;$/m);
  assert.ok(executor);
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/native-background-io/DownloadTagHarness.java'), 'utf8');
  const harness = path.join(work, 'DownloadTagHarness.java');
  fs.writeFileSync(harness, fixture.replace('/* METHODS */', executor[0] + '\n' + methods));
  run(javaTool('javac'), ['-encoding', 'UTF-8', '-cp', jar, '-d', work, harness, path.join(nativeDir, 'LocalTagEditor.java')]);
  run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=0.3', '-c:a', 'libmp3lame', path.join(work, 'fixture.mp3')]);
});
after(() => {
  const resolved = path.resolve(work);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('auralflow-download-tag-test-'));
  fs.rmSync(resolved, { recursive: true });
});
for (const mode of ['roundtrip', 'invalid-input', 'private-path', 'lifecycle']) {
  test(`下载原生标签实际 jaudiotagger 验证：${mode}`, { timeout: 60000 }, () => {
    assert.match(run(javaTool('java'), ['-cp', `${work}${path.delimiter}${jar}`,
      'cn.chenle.auralflow.mobile.DownloadTagHarness', work, mode]), new RegExp(`PASS ${mode}`));
    if (mode === 'roundtrip') {
      const hash = file => run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error',
        '-i', path.join(work, file), '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 'hash', '-hash', 'sha256', '-']);
      assert.equal(hash('fixture.mp3'), hash('roundtrip/files/audio.part'));
    }
  });
}
