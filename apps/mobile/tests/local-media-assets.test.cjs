const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, deferred } = require('./helpers/loadTs.cjs');
const song = { id: '42', source: 'local', isLocal: true, url: 'file:///music/a.flac', name: '歌曲', singer: '歌手', albumName: '专辑', interval: 210 };
const lines = [{ time: 1, text: '歌词', tr: 'translation' }];
function setup() {
  const calls = [], updates = [], cache = new Map();
  const behavior = {
    native: { signature: 'file-v1', warnings: [] },
    search: { status: 'matched', lyrics: lines, coverUrl: 'https://example.test/cover', candidate: { source: 'wy', id: 'remote-id', name: '歌曲', singer: '歌手' }, issues: [] },
    valid: true,
  };
  const deps = {
    readLocal: async () => { calls.push('native'); return behavior.native; },
    readCache: async key => { calls.push(['readCache', key]); return cache.get(key) || null; },
    writeCache: async (key, value) => { calls.push(['writeCache', key]); cache.set(key, value); },
    cover: async uri => { calls.push(['cover', uri]); return uri === 'file:///missing.jpg' ? undefined : uri.startsWith('https:') ? 'file:///cache/cover.jpg' : uri; },
    parse: async raw => raw ? [{ time: 1, text: raw }] : [],
    search: async (target, needs) => { calls.push(['search', target, needs]); return behavior.search; },
    now: () => 1000,
  };
  const resolver = createLoader({})('src/services/localMediaAssetsService.ts').createLocalMediaResolver(deps);
  return { resolver, behavior, deps, calls, updates, cache, resolve: target => resolver.resolve(target || song, update => updates.push(update), () => behavior.valid) };
}

test('先读内嵌/旁挂资料，齐全时不联网，不修改传入歌曲', async () => {
  const h = setup(); const before = structuredClone(song);
  h.behavior.native = { signature: 'file-v1', lyrics: '内嵌歌词', coverUri: 'file:///embedded.jpg', warnings: [] };
  const result = await h.resolve();
  assert.equal(result.status, 'local'); assert.equal(result.lyrics[0].text, '内嵌歌词');
  assert.equal(result.coverUri, 'file:///embedded.jpg');
  assert.equal(h.calls.some(c => c[0] === 'search'), false);
  assert.deepEqual(song, before);
});
test('仅补缺失部分，不用网络歌词覆盖本地歌词', async () => {
  const h = setup(); h.behavior.native.lyrics = '原始歌词';
  const result = await h.resolve();
  assert.equal(result.lyrics[0].text, '原始歌词');
  assert.equal(result.coverUri, 'file:///cache/cover.jpg');
  assert.deepEqual(h.calls.find(c => c[0] === 'search')[2], { lyrics: false, cover: true });
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
  const input = { ...song, localEditedFields: ['localLyrics', 'picUrl', 'img'] };
  const result = await h.resolve(input);
  assert.deepEqual(result.lyrics, lines); assert.equal(result.coverUri, 'file:///cache/cover.jpg');
  assert.equal(input.localLyrics, undefined); assert.equal(input.picUrl, undefined);
});
test('用户保存的非空歌词优先于文件旧标签', async () => {
  const h = setup(); h.behavior.native = { signature: 'v1', lyrics: '文件旧歌词', coverUri: 'file:///embedded.jpg', warnings: [] };
  const edited = await h.resolve({ ...song, localLyrics: '手动歌词', localEditedFields: ['localLyrics'] });
  assert.equal(edited.lyrics[0].text, '手动歌词');
});
for (const status of ['ambiguous', 'not-found']) {
  test(`${status} 不套用资源、不持久化假成功`, async () => {
    const h = setup(); h.behavior.search = { status, issues: [] };
    const result = await h.resolve(); assert.equal(result.status, status);
    assert.deepEqual(result.lyrics, []); assert.equal(result.coverUri, undefined);
    assert.equal(h.cache.size, 0);
  });
}
test('缓存封面文件已清理时只重取封面，已有歌词仍保留', async () => {
  const h = setup(); await h.resolve();
  for (const [key, value] of h.cache) h.cache.set(key, { ...value, coverUri: 'file:///missing.jpg' });
  h.calls.length = 0; const result = await h.resolve();
  assert.deepEqual(h.calls.find(c => c[0] === 'search')[2], { lyrics: false, cover: true });
  assert.deepEqual(result.lyrics, lines);
});
test('切歌期间迟到搜索不发布结果，也不写旧缓存', async () => {
  const h = setup(), gate = deferred(), entered = deferred();
  h.deps.search = () => { entered.resolve(); return gate.promise; };
  const pending = h.resolve(); await entered.promise; h.behavior.valid = false;
  gate.resolve(h.behavior.search); assert.equal(await pending, null);
  assert.equal(h.cache.size, 0); assert.equal(h.updates.some(u => u.status === 'matched'), false);
});
test('网络或缓存故障明确暴露，不清除已解析本地歌词', async () => {
  const h = setup(); h.behavior.native.lyrics = '本地歌词';
  h.deps.search = async () => { throw new Error('network failed'); };
  const result = await h.resolve(); assert.equal(result.status, 'error');
  assert.equal(result.lyrics[0].text, '本地歌词'); assert.match(result.issues.join(' '), /network failed/);
});

test('部分缓存与新候选身份不一致时，不拼接歌词和封面', async () => {
  const h = setup();
  h.behavior.search = { status: 'matched', lyrics: lines, candidate: { source: 'wy', id: 'artist-A', name: '歌曲', singer: '歌手A' }, issues: [] };
  await h.resolve(); h.calls.length = 0;
  h.behavior.search = { status: 'matched', coverUrl: 'https://example.test/B.jpg', candidate: { source: 'wy', id: 'artist-B', name: '歌曲', singer: '歌手B' }, issues: [] };
  const result = await h.resolve();
  assert.equal(result.status, 'ambiguous'); assert.equal(result.coverUri, undefined);
  assert.deepEqual(result.lyrics, lines);
  assert.equal(h.calls.some(c => c[0] === 'writeCache'), false);
});

test('已有有效封面包括用户输入的URL优先，不被内嵌旧图覆盖', async () => {
  const h = setup(); h.behavior.native = { signature: 'v1', lyrics: '本地歌词', coverUri: 'file:///embedded-old.jpg', warnings: [] };
  const result = await h.resolve({ ...song, picUrl: 'https://example.test/user-cover' });
  assert.equal(result.coverUri, 'file:///cache/cover.jpg');
  assert.equal(result.status, 'local'); assert.equal(h.calls.some(c => c[0] === 'search'), false);
});

test('下载记录的远端封面未被手动修改时，已有内嵌资料不再联网', async () => {
  const h = setup(); h.behavior.native = { signature: 'v1', lyrics: '本地歌词', coverUri: 'file:///embedded.jpg', warnings: [] };
  const result = await h.resolve({ ...song, localOrigin: 'download', picUrl: 'https://example.test/old-download-cover' });
  assert.equal(result.coverUri, 'file:///embedded.jpg');
  assert.equal(h.calls.some(c => c[0] === 'cover' && c[1].startsWith('https:')), false);
});
