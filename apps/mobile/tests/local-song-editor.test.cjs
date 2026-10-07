const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createLoader, mobileRequire, mobileRoot } = require('./helpers/loadTs.cjs');
const ts = mobileRequire('typescript');
const model = createLoader({})('src/services/localMusicMetadataModel.ts');
const filename = path.join(mobileRoot, 'src/screens/LibraryScreen.tsx');
const file = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let saveFunction;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleSaveLocalSongMetadata') saveFunction = node.initializer.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(saveFunction, '必须测试实际编辑表单的保存处理函数');
const code = ts.transpileModule(`module.exports = ${saveFunction};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function setup({ previousLyrics = '', lyrics = previousLyrics, name = '新标题', coverUri = '', downloaded = false, tagFailure = null } = {}) {
  const calls = [], errors = [];
  const bindings = {
    editingLocalSong: { id: '42', source: 'local', name: '原标题', localLyrics: previousLyrics },
    savingLocalSongMetadata: false,
    localSongName: name, localSongSinger: '歌手', localSongAlbumName: '专辑',
    localSongCoverUri: coverUri, localSongCoverUrl: '', localSongLyrics: lyrics,
    setSavingLocalSongMetadata: value => calls.push(['saving', value]),
    updateLocalSongMetadata: async (...args) => { model.buildLocalMusicMetadataUpdate(args[1]); calls.push(['metadata', ...args]); },
    buildLocalMusicMetadataUpdate: model.buildLocalMusicMetadataUpdate,
    isDownloadedLocalSong: () => downloaded,
    writeLocalMusicCover: async (...args) => { calls.push(['cover', ...args]); if (tagFailure) throw tagFailure; },
    writeLocalMusicLyrics: async (...args) => { calls.push(['lyrics', ...args]); if (tagFailure) throw tagFailure; },
    closeLocalSongEditor: () => calls.push(['close']),
    Alert: { alert: (...args) => errors.push(args) },
  };
  const module = { exports: {} };
  new Function(...Object.keys(bindings), 'module', code)(...Object.values(bindings), module);
  return { save: module.exports, calls, errors };
}
for (const previousLyrics of ['', '[00:01.00]原歌词']) {
  test('仅编辑标题不得重写未改变的歌词：' + Boolean(previousLyrics), async () => {
    const h = setup({ previousLyrics, tagFailure: new Error('unsupported tag format') }); await h.save();
    assert.equal(h.calls.some(c => c[0] === 'lyrics' || c[0] === 'cover'), false);
    assert.equal(h.calls.filter(c => c[0] === 'metadata').length, 1);
    assert.deepEqual(h.errors, []);
  });
}
for (const lyrics of ['[00:02.00]新歌词', '']) {
  test('用户新增或清除歌词时，先写音频再发布曲库：' + Boolean(lyrics), async () => {
    const h = setup({ previousLyrics: '[00:01.00]旧歌词', lyrics }); await h.save();
    const calls = h.calls.filter(c => !['saving', 'close'].includes(c[0]));
    assert.equal(calls[0][0], 'lyrics'); assert.equal(calls[0][2], lyrics);
    assert.equal(calls[1][0], 'metadata'); assert.deepEqual(h.errors, []);
  });
}
test('标签写回失败不能先发布曲库修改或关闭表单', async () => {
  const h = setup({ lyrics: '新歌词', tagFailure: new Error('native write failed') }); await h.save();
  assert.equal(h.calls.some(c => ['metadata', 'close'].includes(c[0])), false);
  assert.match(h.errors[0][1], /native write failed/);
  assert.deepEqual(h.calls.at(-1), ['saving', false]);
});
test('输入验证先于任何音频写入，非法标题不修改文件', async () => {
  const h = setup({ name: ' ', lyrics: '新歌词', coverUri: 'content://photo/1' }); await h.save();
  assert.equal(h.calls.some(c => ['metadata', 'lyrics', 'cover', 'close'].includes(c[0])), false);
  assert.match(h.errors[0][1], /标题不能为空/);
});
test('选封面只写所选封面，未改歌词不附带写入', async () => {
  const h = setup({ coverUri: 'content://photo/1' }); await h.save();
  assert.deepEqual(h.calls.filter(c => c[0] === 'cover'), [['cover', '42', 'content://photo/1']]);
  assert.equal(h.calls.some(c => c[0] === 'lyrics'), false);
});
test('下载入库歌曲仍只更新曲库，不把下载ID传给MediaStore', async () => {
  const h = setup({ downloaded: true, lyrics: '新歌词', coverUri: 'content://photo/1' }); await h.save();
  assert.equal(h.calls.some(c => c[0] === 'cover' || c[0] === 'lyrics'), false);
  assert.equal(h.calls.filter(c => c[0] === 'metadata').length, 1);
});
