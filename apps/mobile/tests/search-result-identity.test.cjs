const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/loadTs.cjs');

const empty = () => ({ songs: [], artists: [], albums: [], playlists: [] });
const service = createLoader({
  '@lx/core': {},
  './musicApi': { emptySearchResults: empty },
})('src/services/searchSession.ts');

test('歌手分类变化保留歌曲集合引用，真正新增歌曲才发布新集合', () => {
  assert.equal(typeof service.createSearchResultCollector, 'function');
  const collect = service.createSearchResultCollector();
  const first = { source: 'wy', id: '1' };
  const songState = { source: { category: 'songs' }, result: { ...empty(), songs: [first] } };
  const artistState = { source: { category: 'artists' }, result: empty() };
  const before = collect([songState, artistState]);
  const artistLoaded = { ...artistState, result: { ...empty(), artists: [{ source: 'wy', id: 'artist' }] } };
  const artistResult = collect([songState, artistLoaded]);
  assert.strictEqual(artistResult.songs, before.songs);
  assert.notStrictEqual(artistResult.artists, before.artists);
  assert.strictEqual(collect([{ ...songState, status: 'loading' }, artistLoaded]), artistResult);
  const songLoaded = { ...songState, result: { ...songState.result, songs: [first, { source: 'tx', id: '2' }] } };
  const after = collect([songLoaded, artistLoaded]);
  assert.notStrictEqual(after.songs, before.songs);
  assert.strictEqual(after.songs[0], first);
  assert.strictEqual(after.artists, artistResult.artists);
});

test('同一分类仍按来源和歌曲ID去重，并接纳条目更新与移除', () => {
  assert.equal(typeof service.createSearchResultCollector, 'function');
  const collect = service.createSearchResultCollector();
  const state = songs => ({ source: { category: 'songs' }, result: { ...empty(), songs } });
  const original = { source: 'wy', id: '1', name: 'old' };
  const updated = { ...original, name: 'new' };
  assert.deepEqual(collect([state([original]), state([updated])]).songs, [updated]);
  assert.deepEqual(collect([state([])]).songs, []);
});
