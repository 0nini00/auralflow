import { expect, it } from 'vitest';
import { normalizeWyCookie, normalizeCloudDriveSongs, normalizeCloudDriveSnapshot, buildMusicShareLink, buildMusicShareText, shuffleItems } from './index';
import type { MusicInfo } from './index';

const song = { id: 'a /1', source: 'wy', name: 'Song', singer: 'Singer' } as MusicInfo;
it('共享Cookie支持请求头、多行和DevTools表格，保留原始值', () => {
  expect(normalizeWyCookie('Cookie: MUSIC_U=abc;;\n __csrf=def')).toBe('MUSIC_U=abc; __csrf=def');
  expect(normalizeWyCookie('name\tvalue\tdomain\nMUSIC_U\tabc==\t.163.com')).toBe('MUSIC_U=abc==');
});
it('云盘只保留合法唯一歌曲，快照缺省字段沿用两端旧口径', () => {
  expect(normalizeCloudDriveSongs([song, song, null, { ...song, id: '' }])).toEqual([song]);
  expect(normalizeCloudDriveSnapshot({ songs: [song], cachedAt: 1, count: NaN, hasMore: 1 })).toEqual({ songs: [song], cachedAt: 1, count: 1, nextOffset: 1, hasMore: false, usedBytes: undefined, maxBytes: undefined });
  expect(normalizeCloudDriveSnapshot({ songs: [], cachedAt: 1 })).toBeNull();
  expect(normalizeCloudDriveSnapshot({ songs: [song], cachedAt: Infinity })).toBeNull();
});
it('分享链接编码ID，无法分享的来源保留文字', () => {
  expect(buildMusicShareLink(song)).toBe('https://music.163.com/#/song?id=a%20%2F1');
  expect(buildMusicShareLink({ ...song, source: 'tx' })).toBe('https://y.qq.com/n/ryqq/songDetail/a%20%2F1');
  expect(buildMusicShareText({ ...song, source: 'local' })).toBe('Song - Singer');
});
it('共享洗牌使用注入随机数，保留原列表及项目引用', () => {
  const original = [1, 2, 3];
  expect(shuffleItems(original, () => 0)).toEqual([2, 3, 1]);
  expect(original).toEqual([1, 2, 3]);
  expect(shuffleItems([], () => 0)).toEqual([]);
});
