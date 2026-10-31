const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createLoader, mobileRequire, mobileRoot } = require('./helpers/loadTs.cjs');
function setup() {
  const nativeCalls = [], parsed = [];
  const native = { readAudioAssets: async uri => { nativeCalls.push(uri); return { signature: 'sha', warnings: [] }; } };
  const mocks = {
    // 只提供原生模块：本地曲歌词只来自文件自己，网络、文件系统缓存都不再是依赖。
    'react-native': { NativeModules: { LocalMusicModule: native } },
    './musicApi': {
      getLyrics: async song => {
        if (!song.localLyrics) return [];
        parsed.push(song.localLyrics);
        return song.localLyrics.split('\n').map((text, index) => ({ time: index + 1, text }));
      },
    },
  };
  const load = createLoader(mocks);
  return { load, nativeCalls, native, mocks, parsed };
}
const song = { source: 'local', id: 'local-id', url: 'file:///music/a.flac', name: 'A', singer: '', albumName: '', interval: 100 };

test('运行时只调用只读原生 API，歌词直接来自文件、不落任何缓存文件', async () => {
  const h = setup(), runtime = h.load('src/services/localMediaRuntime.ts');
  h.native.readAudioAssets = async uri => {
    h.nativeCalls.push(uri);
    return { signature: 'sha', lyrics: '第一行\n第二行', warnings: [] };
  };
  const result = await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  assert.equal(result.status, 'local');
  assert.deepEqual(result.lyrics, [{ time: 1, text: '第一行' }, { time: 2, text: '第二行' }]);
  assert.deepEqual(h.nativeCalls, [song.url]);
  assert.deepEqual(h.parsed, ['第一行\n第二行']);
});

test('文件里没有歌词时不解析、不联网，如实报告「无歌词」', async () => {
  const h = setup(), runtime = h.load('src/services/localMediaRuntime.ts');
  const result = await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  assert.equal(result.status, 'not-found');
  assert.equal(result.message, '无歌词');
  assert.deepEqual(result.lyrics, []);
  assert.deepEqual(h.parsed, []);
  assert.deepEqual(h.nativeCalls, [song.url]);
});

test('非法本地URI和缺失原生模块显式失败，不向网络传本地ID', async () => {
  const h = setup(), runtime = h.load('src/services/localMediaRuntime.ts');
  const result = await runtime.resolveLocalMediaAssets({ ...song, url: 'https://example.test/song' }, () => {}, () => true);
  assert.equal(result.status, 'error'); assert.deepEqual(h.nativeCalls, []);
  h.native.readAudioAssets = undefined;
  const missing = await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  assert.equal(missing.status, 'error'); assert.match(missing.issues.join(' '), /原生|新版/);
});

test('原生读取结果结构不合法时按失败处理，不把坏数据当歌词', async () => {
  const h = setup(), runtime = h.load('src/services/localMediaRuntime.ts');
  h.native.readAudioAssets = async () => ({ warnings: [] });
  const result = await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  assert.equal(result.status, 'error');
  assert.match(result.issues.join(' '), /无效/);
  assert.deepEqual(result.lyrics, []);
});

test('getLyrics 对缺少歌词的本地歌曲不提交本地 ID 到网关', async () => {
  const ts = mobileRequire('typescript');
  const file = ts.createSourceFile('musicApi.ts', fs.readFileSync(path.join(mobileRoot, 'src/services/musicApi.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getLyrics');
  assert.ok(fn);
  const code = ts.transpileModule(fn.getText(file).replace('export ', '') + '\nmodule.exports = getLyrics;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  // 本地分支会用 localLyricsTranslation / localLyricsRomanization 合并副行（对齐桌面），
  // 这里注入恒等实现，只关注「本地歌不联网」与解析结果本身。
  const identity = (lines) => lines;
  new Function('module', 'parseLyricSource', 'fetchSongLyrics', 'mergeTranslation', 'mergeRomanization', code)(
    module, () => [], async () => { assert.fail('本地ID不得作为在线ID请求歌词'); }, identity, identity
  );
  assert.deepEqual(await module.exports(song), []);
  assert.deepEqual(await module.exports({ ...song, source: 'tx', isLocal: true }), []);
  assert.equal((await module.exports({ ...song, localLyrics: '第一行\n第二行' }))[1].text, '第二行');
});

test('封面不再是本地补全的一部分：运行时不再读取或校验任何封面', () => {
  const source = fs.readFileSync(path.join(mobileRoot, 'src/services/localMediaRuntime.ts'), 'utf8');
  for (const removed of ['cacheCover', 'Image', 'validateImage', 'coverUri', 'IMAGE_TIMEOUT_MS']) {
    assert.equal(source.includes(removed), false, `运行时不得重新引入封面路径：${removed}`);
  }
});

test('运行时不再有缓存目录、联网搜索与孤儿认领', () => {
  const source = fs.readFileSync(path.join(mobileRoot, 'src/services/localMediaRuntime.ts'), 'utf8');
  for (const removed of ['react-native-fs', 'crypto-js', 'CacheDirectory', 'writeCache', 'readCache',
    'findLocalMediaAssets', 'lrclib', 'readLocalLyricsFile', 'claimOrphanedLyricsChoice', 'cacheService']) {
    assert.equal(source.includes(removed), false, `运行时不得重新引入：${removed}`);
  }
});
