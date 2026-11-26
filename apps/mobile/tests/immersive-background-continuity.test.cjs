const assert = require("node:assert/strict");
const test = require("node:test");
const { createImmersiveScreen: screen } = require("./helpers/immersiveScreen.cjs");

test('柔光只使用主题色，切歌及封面缺失、到达均不改变配色或卸载背景', async t => {
  const h = await screen(t);
  assert.equal(h.background().color, '#58a87a');
  assert.equal(h.background().accent, '#58a87a');
  await h.change({ currentSong: { id: 'b', name: 'Song B', source: 'wy' }, artwork: undefined, isPlaying: false });
  assert.equal(h.background().color, '#58a87a');
  assert.equal(h.background().playing, false);
  await h.change({ artwork: 'cover-b', isPlaying: true });
  assert.equal(h.background().color, '#58a87a');
  assert.equal(h.background().playing, true);
  await h.change({ currentSong: { id: 'c', name: 'Song C', source: 'wy' }, artwork: 'cover-c' });
  assert.equal(h.background().color, '#58a87a');
  assert.equal(h.mounts(), 1);
});

test('暂停时更换主题强调色也会更新柔光配色，并复用已有背景', async t => {
  const h = await screen(t);
  await h.change({ isPlaying: false });
  await h.changeTheme('#b976ca');
  assert.equal(h.background().color, '#b976ca');
  assert.equal(h.background().accent, '#b976ca');
  assert.equal(h.background().playing, false);
  assert.equal(h.mounts(), 1);
});
