const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createLoader, deferred, mobileRoot } = require('./helpers/loadTs.cjs');

const song = { id: '42', source: 'local', isLocal: true, url: 'file:///music/a.flac', name: '歌曲', singer: '歌手', albumName: '专辑', interval: 210 };

function setup() {
  const calls = [], updates = [];
  const behavior = { native: { signature: 'file-v1', warnings: [] }, valid: true };
  const deps = {
    readLocal: async () => { calls.push('native'); return behavior.native; },
    parse: async raw => raw.split('\n').map((text, index) => ({ time: index + 1, text })),
  };
  const resolver = createLoader({})('src/services/localMediaAssetsService.ts').createLocalMediaResolver(deps);
  return {
    deps, behavior, calls, updates,
    resolve: target => resolver.resolve(target || song, update => updates.push(update), () => behavior.valid),
  };
}

test('文件里的内嵌 / 旁挂歌词直接成为结果：不联网、不缓存、不改传入歌曲', async () => {
  const h = setup(), before = structuredClone(song);
  h.behavior.native = { signature: 'file-v1', lyrics: '第一行\n第二行', warnings: [] };
  const result = await h.resolve();
  assert.equal(result.status, 'local');
  assert.deepEqual(result.lyrics, [{ time: 1, text: '第一行' }, { time: 2, text: '第二行' }]);
  assert.equal(result.message, '');
  assert.deepEqual(result.issues, []);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(song, before);
});

test('记录上的按曲歌词优先，且不再读文件：用户手写 / 下载曲编辑的词照样能显示', async () => {
  const h = setup();
  h.behavior.native = { signature: 'file-v1', lyrics: '文件里的词', warnings: [] };
  const result = await h.resolve({ ...song, localLyrics: '记录里的手写词', localEditedFields: ['localLyrics'] });
  assert.equal(result.status, 'local');
  assert.deepEqual(result.lyrics, [{ time: 1, text: '记录里的手写词' }]);
  assert.equal(h.calls.length, 0);
});

test('记录上的歌词被清空就是「无歌词」，不再回落到文件里那份', async () => {
  const h = setup();
  h.behavior.native = { signature: 'file-v1', lyrics: '文件里的词', warnings: [] };
  const result = await h.resolve({ ...song, localLyrics: '', localEditedFields: ['localLyrics'] });
  assert.equal(result.status, 'not-found');
  assert.deepEqual(result.lyrics, []);
  assert.equal(result.message, '无歌词');
  assert.equal(h.calls.length, 0);
});

test('只有空白歌词按「没有歌词」处理，不产生空结果之外的噪音', async () => {
  const h = setup();
  h.behavior.native = { signature: 'file-v1', lyrics: '  \n\t', warnings: [] };
  const result = await h.resolve();
  assert.equal(result.status, 'not-found');
  assert.equal(result.message, '无歌词');
});

test('原生告警逐条并入 issues，解析失败也不冒充成功', async () => {
  const h = setup();
  h.behavior.native = { signature: 'file-v1', lyrics: '词', warnings: ['旁挂 .lrc 编码异常'] };
  const result = await h.resolve();
  assert.deepEqual(result.issues, ['旁挂 .lrc 编码异常']);
  assert.equal(result.status, 'local');

  const failing = setup();
  failing.deps.parse = async () => { throw new Error('parse failed'); };
  failing.behavior.native = { signature: 'file-v1', lyrics: '词', warnings: [] };
  const broken = await failing.resolve();
  assert.equal(broken.status, 'error');
  assert.deepEqual(broken.lyrics, []);
  assert.match(broken.issues.join(' '), /parse failed/);
});

test('原生读取失败时报告 error，播放链据此只显示提示', async () => {
  const h = setup();
  h.deps.readLocal = async () => { throw new Error('read failed'); };
  const result = await h.resolve();
  assert.equal(result.status, 'error');
  assert.equal(result.message, '资料读取失败，播放不受影响');
  assert.deepEqual(result.lyrics, []);
  assert.match(result.issues.join(' '), /read failed/);
});

test('切歌期间迟到的读取不发布结果', async () => {
  const h = setup(), gate = deferred();
  h.deps.readLocal = () => gate.promise;
  const pending = h.resolve();
  h.behavior.valid = false;
  gate.resolve({ signature: 'file-v1', lyrics: '别人的词', warnings: [] });
  assert.equal(await pending, null);
  assert.equal(h.updates.some(update => update.status === 'local'), false);
});

test('补全键只剩歌曲身份：已删除的歌词选择字段不再影响它', async () => {
  const { localMediaInputKey } = createLoader({})('src/services/localMediaAssetsService.ts');
  const base = localMediaInputKey(song);
  assert.equal(localMediaInputKey({
    ...song, lyricsMode: 'picked', lyricsFingerprint: 'file-v1', lyricsSourceLabel: 'QQ音乐',
  }), base);
  assert.notEqual(localMediaInputKey({ ...song, name: '另一首歌' }), base);
  assert.notEqual(localMediaInputKey({ ...song, url: 'file:///music/b.flac' }), base);
});

test('联网找词 / 候选 / 三态选择 / 孤儿表整层删除，移动端源码里不再有残留', () => {
  const removed = [
    'localMediaSearchService', 'lrclibLyricsService', 'localLyricsChoiceModel', 'localLyricsChoiceOrphan',
    'LyricsChoiceSheet', 'useLyricOriginNote', 'selectLocalMediaMatch', 'selectLocalMediaLyricOrigin',
    'lyricOrigin', 'lyricOriginNote', 'localLyricsChoiceOrphans', '选择歌词',
  ];
  const root = path.join(mobileRoot, 'src');
  const offenders = [];
  for (const relative of fs.readdirSync(root, { recursive: true })) {
    if (!/\.tsx?$/.test(relative)) continue;
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const token of removed) if (source.includes(token)) offenders.push(`${relative}: ${token}`);
  }
  assert.deepEqual(offenders, []);
});

test('本地歌词解析链不含联网、缓存与选择分支', () => {
  const read = name => fs.readFileSync(path.join(mobileRoot, 'src', name), 'utf8');
  const banned = [
    'findLocalMediaAssets', 'lrclib', 'LRCLIB', 'readCache', 'writeCache', 'LocalMediaCache',
    'lyricOrigin', 'claimOrphanedLyricsChoice', 'localLyricsChoice', 'localLyricsModeOf',
  ];
  for (const name of ['services/localMediaAssetsService.ts', 'services/localMediaRuntime.ts']) {
    const source = read(name);
    for (const token of banned) assert.equal(source.includes(token), false, `${name} 不得包含 ${token}`);
  }
});
