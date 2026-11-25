const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, after } = require('node:test');

const nativeDir = path.resolve(__dirname, '../android/app/src/main/java/cn/chenle/auralflow/mobile');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'auralflow-background-io-test-'));
after(() => {
  const resolved = path.resolve(work);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('auralflow-background-io-test-'));
  fs.rmSync(resolved, { recursive: true });
});
function run(tool, args) {
  const command = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', tool) : tool;
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 25000, windowsHide: true });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function extract(source, name) {
  const match = source.match(new RegExp(`^  (?:public|private) (?:static )?(?:synchronized )?[^\\n]+ ${name}\\([^]*?^  }`, 'm'));
  return match?.[0] ?? '';
}

test('Activity 导入和授权回调及全库扫描隔离 I/O，关闭后每个 Promise 仍结算', { timeout: 60000 }, () => {
  const source = fs.readFileSync(path.join(nativeDir, 'LocalMusicModule.java'), 'utf8');
  const names = ['handlePickAudioResult', 'readPickedAudioFiles', 'handleUpdateAccessResult', 'scanLocalMusic',
    'scanLocalMusicInBackground', 'submitIo', 'buildScanSignature', 'buildDirectoryCoverSignature',
    'appendSignaturePart', 'appendFileStamp', 'safeString', 'applyLyrics', 'invalidate', 'rejectPendingActivityRequests'];
  const methods = names.map(name => extract(source, name)).join('\n').replaceAll('LocalMusicModule::', 'BackgroundIoHarness::');
  const callback = source.match(/public void onActivityResult\(Activity activity, int requestCode, int resultCode, Intent data\) \{[^]*?^    }/m);
  assert.ok(callback);
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/native-background-io/BackgroundIoHarness.java'), 'utf8');
  const harness = path.join(work, 'BackgroundIoHarness.java');
  fs.writeFileSync(harness, fixture.replace('/* METHODS */', methods).replace('/* CALLBACK */', callback[0]));
  const stampSource = path.join(nativeDir, 'ScanDirectorySignatures.java');
  run('javac', ['-encoding', 'UTF-8', '-d', work, harness, ...(fs.existsSync(stampSource) ? [stampSource] : [])]);
  assert.match(run('java', ['-cp', work, 'cn.chenle.auralflow.mobile.BackgroundIoHarness']), /PASS background/);
});

test('授权请求显式回到 UI，初始封面和歌词写入也进入有序 I/O 队列', () => {
  const source = fs.readFileSync(path.join(nativeDir, 'LocalMusicModule.java'), 'utf8');
  for (const method of ['requestUpdateAccess', 'requestWriteAccess', 'pickLocalAudioFiles']) {
    assert.match(extract(source, method), /UiThreadUtil\.runOnUiThread/);
  }
  for (const method of ['requestUpdateAccessOnUiThread', 'requestWriteAccessOnUiThread', 'launchAudioPicker']) {
    assert.match(extract(source, method), /if \(invalidated\)/);
  }
  for (const method of ['writeAudioCover', 'writeAudioLyrics', 'updateAudioMetadata']) {
    assert.match(extract(source, method), /submitIo\(localIoExecutor/);
  }
});

test('公共封面签名每目录读取两次且跨扫描刷新，扫描中变更显式失败', { timeout: 60000 }, () => {
  const stampSource = path.join(nativeDir, 'ScanDirectorySignatures.java');
  assert.ok(fs.existsSync(stampSource), '缺少单次扫描目录签名复用边界');
  const fixture = path.join(__dirname, 'fixtures/native-background-io/ScanDirectorySignaturesHarness.java');
  run('javac', ['-encoding', 'UTF-8', '-d', work, stampSource, fixture]);
  assert.match(run('java', ['-cp', work, 'cn.chenle.auralflow.mobile.ScanDirectorySignaturesHarness', work]), /PASS signatures/);
});
