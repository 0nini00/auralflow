const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, deferred } = require('./helpers/loadTs.cjs');
const song = { id: '42', source: 'local', isLocal: true, url: 'file:///music/a.flac', name: '歌曲', singer: '歌手', albumName: '专辑', interval: 210 };
const lines = [{ time: 1, text: '歌词', tr: 'translation' }];
function setup() {
  const calls = [], updates = [], cache = new Map();
  const behavior = {
    native: { signature: 'file-v1', warnings: [] },
    search: { status: 'matched', lyrics: lines, candidate: { source: 'wy', id: 'remote-id', name: '歌曲', singer: '歌手' }, issues: [] },
    valid: true,
  };
  const deps = {
    readLocal: async () => { calls.push('native'); return behavior.native; },
    readCache: async key => { calls.push(['readCache', key]); return cache.get(key) || null; },
    writeCache: async (key, value) => { calls.push(['writeCache', key]); cache.set(key, value); },
    parse: async raw => raw ? [{ time: 1, text: raw }] : [],
    search: async target => { calls.push(['search', target]); return behavior.search; },
    now: () => 1000,
  };
  const resolver = createLoader({})('src/services/localMediaAssetsService.ts').createLocalMediaResolver(deps);
  return { resolver, deps, behavior, calls, updates, cache, resolve: target => resolver.resolve(target || song, update => updates.push(update), () => behavior.valid) };
}

test('先读内嵌/旁挂资料，齐全时不联网，不修改传入歌曲', async () => {
  const h = setup(); const before = structuredClone(song);
  h.behavior.native = { signature: 'file-v1', lyrics: '内嵌歌词', warnings: [] };
  const result = await h.resolve();
  assert.equal(result.status, 'local'); assert.equal(result.lyrics[0].text, '内嵌歌词');
  assert.equal('coverUri' in result, false);
  assert.equal(h.calls.some(c => c[0] === 'search'), false);
  assert.deepEqual(song, before);
});
test('本地已有歌词时完全不联网，网络歌词接不到覆盖机会', async () => {
  const h = setup(); h.behavior.native.lyrics = '原始歌词';
  const result = await h.resolve();
  assert.equal(result.lyrics[0].text, '原始歌词');
  assert.equal(h.calls.some(c => c[0] === 'search'), false);
  assert.equal(h.calls.some(c => c[0] === 'readCache'), false);
});
test('命中与文件签名绑定的缓存时离线复用，并保留翻译', async () => {
  const h = setup(); await h.resolve(); h.calls.length = 0;
  const result = await h.resolve();
  assert.equal(result.status, 'cached'); assert.deepEqual(result.lyrics, lines);
  assert.equal(h.calls.some(c => c[0] === 'search'), false);
});
test('文件签名或用户标签变化不复用旧匹配', async () => {
  const h = setup(); await h.resolve(); h.calls.length = 0;
  h.behavior.native.signature = 'file-v2'; await h.resolve();
  assert.equal(h.calls.filter(c => c[0] === 'search').length, 1);
  h.calls.length = 0; await h.resolve({ ...song, name: '另一首歌' });
  assert.equal(h.calls.filter(c => c[0] === 'search').length, 1);
});
test('历史编辑标记不把缺失资料永久禁用，补全也不写回空标签', async () => {
  const h = setup();
  h.behavior.native = { signature: 'v1', lyrics: '内嵌歌词', warnings: [] };
  const input = { ...song, localEditedFields: ['localLyrics', 'picUrl', 'img'] };
  const result = await h.resolve(input);
  assert.equal(result.lyrics[0].text, '内嵌歌词');
  assert.equal(h.calls.some(c => c[0] === 'search'), false);
  assert.equal(input.localLyrics, undefined); assert.equal(input.picUrl, undefined);
});
test('用户保存的非空歌词优先于文件旧标签', async () => {
  const h = setup(); h.behavior.native = { signature: 'v1', lyrics: '文件旧歌词', warnings: [] };
  const edited = await h.resolve({ ...song, localLyrics: '手动歌词', localEditedFields: ['localLyrics'] });
  assert.equal(edited.lyrics[0].text, '手动歌词');
});
// ── 三态：auto 走自动链；picked / local-only 都不联网 ──

test('auto（缺省）走自动链：内嵌标签没有歌词时才联网', async () => {
  const h = setup();
  const result = await h.resolve();
  assert.equal(result.status, 'matched'); assert.deepEqual(result.lyrics, lines);
  assert.equal(h.calls.filter(c => c[0] === 'search').length, 1);
});

test('picked：只用选中的文本，不联网也不读补全缓存', async () => {
  const h = setup(); h.behavior.native = { signature: 'file-v1', lyrics: '文件里的旧词', warnings: [] };
  const result = await h.resolve({
    ...song, lyricsMode: 'picked', lyricsFingerprint: 'file-v1', lyricsSourceLabel: 'QQ音乐',
    localLyrics: '选中的那份词', localEditedFields: ['localLyrics', 'lyricsMode'],
  });
  assert.equal(result.status, 'local');
  assert.equal(result.lyrics[0].text, '选中的那份词');
  assert.equal(h.calls.some(c => c[0] === 'search'), false);
  assert.equal(h.calls.some(c => c[0] === 'readCache'), false);
  assert.equal(h.cache.size, 0);
});

test('local-only：只用内嵌 / 旁挂歌词，不联网；都没有就是无歌词', async () => {
  const withFile = setup();
  withFile.behavior.native = { signature: 'file-v1', lyrics: '旁挂 .lrc 的歌词', warnings: [] };
  const result = await withFile.resolve({ ...song, lyricsMode: 'local-only', lyricsFingerprint: 'file-v1', localEditedFields: ['lyricsMode'] });
  assert.equal(result.status, 'local'); assert.equal(result.lyrics[0].text, '旁挂 .lrc 的歌词');
  assert.equal(withFile.calls.some(c => c[0] === 'search'), false);
  assert.equal(withFile.calls.some(c => c[0] === 'readCache'), false);

  const empty = setup();
  const none = await empty.resolve({ ...song, lyricsMode: 'local-only', lyricsFingerprint: 'file-v1', localEditedFields: ['lyricsMode'] });
  assert.equal(none.status, 'local'); assert.equal(none.message, '无歌词'); assert.deepEqual(none.lyrics, []);
  assert.equal(empty.calls.some(c => c[0] === 'search'), false);
});

test('指纹不匹配时选择静默失效回自动匹配，且不再显示已失效的旧文本', async () => {
  for (const mode of ['picked', 'local-only']) {
    const h = setup();
    // 文件内容变了（签名 file-v2），选择是给旧内容的：这一次必须当不存在，且不能把旧文本当成这首歌的歌词。
    h.behavior.native = { signature: 'file-v2', warnings: [] };
    const result = await h.resolve({
      ...song, lyricsMode: mode, lyricsFingerprint: 'file-v1', lyricsSourceLabel: 'QQ音乐',
      localLyrics: '另一个文件的词', localEditedFields: ['localLyrics', 'lyricsMode'],
    });
    assert.equal(result.status, 'matched', mode);
    assert.deepEqual(result.lyrics, lines, mode);
    assert.equal(h.calls.filter(c => c[0] === 'search').length, 1, mode);
  }
});

test('指纹缺失视为未绑定：显式选择回自动匹配', async () => {
  const h = setup();
  const result = await h.resolve({ ...song, lyricsMode: 'local-only', localEditedFields: ['lyricsMode'] });
  assert.equal(result.status, 'matched');
  assert.equal(h.calls.filter(c => c[0] === 'search').length, 1);
});

test('歌词选择三要素进缓存键：选择变化就换一份缓存', async () => {
  const { localMediaInputKey } = createLoader({})('src/services/localMediaAssetsService.ts');
  const base = localMediaInputKey(song);
  assert.notEqual(localMediaInputKey({ ...song, lyricsMode: 'local-only', lyricsFingerprint: 'file-v1' }), base);
  assert.notEqual(localMediaInputKey({ ...song, lyricsMode: 'picked', lyricsFingerprint: 'file-v1' }), base);
  assert.notEqual(localMediaInputKey({ ...song, lyricsMode: 'auto', lyricsFingerprint: 'file-v1' }), base);
  // 封面字段已不再参与补全：改封面不会让歌词缓存失效。
  assert.equal(localMediaInputKey({ ...song, picUrl: 'https://example.test/a.jpg', img: 'x' }), base);
});

for (const status of ['ambiguous', 'not-found']) {
  test(`${status} 不套用资源、不持久化假成功`, async () => {
    const h = setup(); h.behavior.search = { status, issues: [] };
    const result = await h.resolve(); assert.equal(result.status, status);
    assert.deepEqual(result.lyrics, []); assert.equal(h.cache.size, 0);
  });
}
test('切歌期间迟到搜索不发布结果，也不写旧缓存', async () => {
  const h = setup(), gate = deferred(), entered = deferred();
  h.deps.search = () => { entered.resolve(); return gate.promise; };
  const pending = h.resolve(); await entered.promise; h.behavior.valid = false;
  gate.resolve(h.behavior.search); assert.equal(await pending, null);
  assert.equal(h.cache.size, 0); assert.equal(h.updates.some(u => u.status === 'matched'), false);
});
test('网络故障在没有本地歌词时明确暴露', async () => {
  const h = setup();
  h.deps.search = async () => { throw new Error('network failed'); };
  h.behavior.native = { signature: 'file-v1', warnings: [] };
  const result = await h.resolve();
  assert.equal(result.status, 'error');
  assert.deepEqual(result.lyrics, []);
  assert.match(result.issues.join(' '), /network failed/);
});
test('本地已有歌词时不再联网，网络故障碰不到已经解析好的歌词', async () => {
  const h = setup();
  h.deps.search = async () => { throw new Error('network failed'); };
  h.behavior.native = { signature: 'file-v1', lyrics: '内嵌歌词', warnings: [] };
  const result = await h.resolve({ ...song, localLyrics: '手动歌词', localEditedFields: ['localLyrics'] });
  assert.equal(result.status, 'local');
  assert.equal(result.lyrics[0].text, '手动歌词');
  assert.equal(h.calls.some(c => c[0] === 'search'), false);
});

test('命中缓存后不再问候选，也就不存在与新候选混用资料的机会', async () => {
  const h = setup();
  await h.resolve(); h.calls.length = 0;
  h.behavior.search = { status: 'matched', lyrics: [{ time: 9, text: '另一份词' }], candidate: { source: 'wy', id: 'artist-B', name: '歌曲', singer: '歌手B' }, issues: [] };
  const result = await h.resolve();
  assert.equal(result.status, 'cached');
  assert.deepEqual(result.lyrics, lines);
  assert.equal(h.calls.some(c => c[0] === 'search'), false);
  assert.equal(h.calls.some(c => c[0] === 'writeCache'), false);
});
