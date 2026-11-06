const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('原生统计月文件拒绝越界、恢复备份，写入或提交失败保留旧文件', { timeout: 60000 }, () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'auralflow-listening-stats-'));
  const native = path.resolve(__dirname, '../android/app/src/main/java/cn/chenle/auralflow/mobile');
  const java = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 25000, windowsHide: true });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  try {
    run(java('javac'), ['-encoding', 'UTF-8', '-Xlint:all', '-d', work,
      path.join(native, 'ListeningStatsFiles.java'),
      path.join(__dirname, 'fixtures/listening-stats/ListeningStatsFilesHarness.java')]);
    assert.match(run(java('java'), ['-cp', work, 'cn.chenle.auralflow.mobile.ListeningStatsFilesHarness', work]), /PASS listening-stats-files/);
  } finally {
    assert.equal(path.dirname(path.resolve(work)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(work).startsWith('auralflow-listening-stats-'));
    fs.rmSync(work, { recursive: true, force: true });
  }
});
