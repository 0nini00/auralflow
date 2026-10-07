const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, mobileRequire } = require('./helpers/loadTs.cjs');
function setup() {
  const files = new Map(), calls = [], nativeCalls = [];
  const native = { readAudioAssets: async uri => { nativeCalls.push(uri); return { signature: 'sha', warnings: [] }; } };
  const fs = {
    CachesDirectoryPath: '/app/cache', mkdir: async () => {}, exists: async path => files.has(path),
    readFile: async path => files.get(path), writeFile: async (path, data) => { calls.push(['write', path]); files.set(path, data); },
    unlink: async path => { calls.push(['unlink', path]); files.delete(path); },
  };
  const mocks = {
    'react-native-fs': fs, 'crypto-js': mobileRequire('crypto-js'),
    'react-native': { NativeModules: { LocalMusicModule: native }, Image: { getSize: (_uri, done) => done(100, 100) } },
    './musicApi': { getLyrics: async song => song.localLyrics ? [{ time: 1, text: song.localLyrics }] : [] },
    './localMediaSearchService': { findLocalMediaAssets: async () => ({ status: 'matched', lyrics: [{ time: 1, text: 'online', tr: 'translation' }], coverUrl: 'https://example.test/art', issues: [] }) },
    './cacheService': { cacheCover: async () => { files.set('/app/cache/covers/art', 'image'); return 'file:///app/cache/covers/art'; }, enforceCacheSizeLimit: async () => {} },
    './fileDownloadCommit': { createPartialDownloadPath: path => path + '.part', commitDownloadedFile: async (from, to) => { files.set(to, files.get(from)); files.delete(from); }, discardPartialDownload: async path => files.delete(path) },
  };
  const load = createLoader(mocks);
  return { load, files, calls, nativeCalls, native, mocks };
}
const song = { source: 'local', id: 'local-id', url: 'file:///music/a.flac', name: 'A', singer: '', albumName: '', interval: 100 };

test('运行时只调用只读原生API，结果仅存应用缓存且可离线复用', async () => {
  const h = setup(), runtime = h.load('src/services/localMediaRuntime.ts');
  const first = await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  assert.equal(first.status, 'matched');
  assert.ok(h.calls.filter(c => c[0] === 'write').every(c => c[1].startsWith('/app/cache/auralflow/lyrics/local-media-')));
  assert.ok(h.nativeCalls.every(uri => uri === song.url));
  const second = await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  assert.equal(second.status, 'cached'); assert.equal(second.lyrics[0].tr, 'translation');
  assert.equal(h.calls.some(c => c[1].startsWith('/music')), false);
});
test('非法本地URI和缺失原生模块显式失败，不向网络传本地ID', async () => {
  const h = setup(), runtime = h.load('src/services/localMediaRuntime.ts');
  const result = await runtime.resolveLocalMediaAssets({ ...song, url: 'https://example.test/song' }, () => {}, () => true);
  assert.equal(result.status, 'error'); assert.deepEqual(h.nativeCalls, []);
  h.native.readAudioAssets = undefined;
  const missing = await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  assert.equal(missing.status, 'error'); assert.match(missing.issues.join(' '), /原生|新版/);
});
test('损坏缓存明确报告后重建，不把坏数据当歌词', async () => {
  const h = setup(), runtime = h.load('src/services/localMediaRuntime.ts');
  await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  const key = [...h.files.keys()].find(path => path.includes('local-media-'));
  h.files.set(key, '{broken');
  const result = await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  assert.equal(result.lyrics[0].text, 'online'); assert.match(result.issues.join(' '), /缓存读取失败/);
  assert.doesNotThrow(() => JSON.parse(h.files.get(key)));
});
test('图片解码失败不把下载成功的错误页面当封面', async () => {
  const h = setup(); h.mocks['react-native'].Image.getSize = (_uri, _done, fail) => fail(new Error('not an image'));
  const runtime = h.load('src/services/localMediaRuntime.ts');
  const result = await runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  assert.equal(result.coverUri, undefined); assert.equal(result.status, 'partial');
  assert.match(result.issues.join(' '), /not an image/);
});

test('getLyrics 对缺少歌词的本地歌曲不提交本地 ID 到网关', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const { mobileRoot } = require('./helpers/loadTs.cjs');
  const ts = mobileRequire('typescript');
  const file = ts.createSourceFile('musicApi.ts', fs.readFileSync(path.join(mobileRoot, 'src/services/musicApi.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getLyrics');
  assert.ok(fn);
  const code = ts.transpileModule(fn.getText(file).replace('export ', '') + '\nmodule.exports = getLyrics;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'parseLyricSource', 'fetchSongLyrics', code)(module, () => [], async () => { assert.fail('本地ID不得作为在线ID请求歌词'); });
  assert.deepEqual(await module.exports(song), []);
  assert.deepEqual(await module.exports({ ...song, source: 'tx', isLocal: true }), []);
  assert.equal((await module.exports({ ...song, localLyrics: '第一行\n第二行' }))[1].text, '第二行');
});

test('content URI 封面由图片解码器读取，不用文件路径 exists 判定', async () => {
  const h = setup(), decoded = [];
  h.native.readAudioAssets = async () => ({ signature: 'sha', lyrics: 'embedded', warnings: [] });
  h.mocks['react-native'].Image.getSize = (uri, done) => { decoded.push(uri); done(100, 100); };
  const runtime = h.load('src/services/localMediaRuntime.ts');
  const uri = 'content://media/external/audio/albumart/9';
  const result = await runtime.resolveLocalMediaAssets({ ...song, picUrl: uri }, () => {}, () => true);
  assert.equal(result.status, 'local'); assert.equal(result.coverUri, uri);
  assert.ok(decoded.includes(uri));
});

test('同键旧缓存写入失效后，不能删除新请求的完整结果', async () => {
  const { deferred } = require('./helpers/loadTs.cjs');
  const h = setup(), entered = deferred(), gate = deferred();
  let firstWrite = true, oldCurrent = true, queries = 0;
  const originalWrite = h.mocks['react-native-fs'].writeFile;
  h.mocks['react-native-fs'].writeFile = async (...args) => {
    if (firstWrite) { firstWrite = false; entered.resolve(); await gate.promise; }
    return originalWrite(...args);
  };
  h.mocks['./localMediaSearchService'].findLocalMediaAssets = async () => ++queries === 1
    ? { status: 'matched', lyrics: [{ time: 1, text: 'old' }], issues: [] }
    : { status: 'matched', lyrics: [{ time: 1, text: 'new' }], coverUrl: 'https://example.test/art', issues: [] };
  const runtime = h.load('src/services/localMediaRuntime.ts');
  const old = runtime.resolveLocalMediaAssets(song, () => {}, () => oldCurrent);
  await entered.promise; oldCurrent = false;
  const next = runtime.resolveLocalMediaAssets(song, () => {}, () => true);
  await new Promise(setImmediate);
  gate.resolve(); await Promise.all([old, next]);
  const file = [...h.files.keys()].find(name => name.includes('local-media-') && name.endsWith('.json'));
  const cached = JSON.parse(h.files.get(file));
  assert.equal(cached.lyrics[0].text, 'new'); assert.equal(cached.coverUri, 'file:///app/cache/covers/art');
});

test('本地 content 封面不会阻止在线歌词缓存，离线仍能复用歌词', async () => {
  const h = setup(), uri = 'content://media/external/audio/albumart/9';
  const runtime = h.load('src/services/localMediaRuntime.ts');
  const input = { ...song, picUrl: uri };
  const first = await runtime.resolveLocalMediaAssets(input, () => {}, () => true);
  assert.equal(first.status, 'matched'); assert.equal(first.issues.length, 0);
  h.mocks['./localMediaSearchService'].findLocalMediaAssets = async () => { throw new Error('offline'); };
  const second = await runtime.resolveLocalMediaAssets(input, () => {}, () => true);
  assert.equal(second.status, 'cached'); assert.equal(second.lyrics[0].text, 'online');
  assert.equal(second.coverUri, uri);
});
