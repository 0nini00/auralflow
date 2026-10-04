import { describe, expect, it } from 'vitest';
import type { LocalSong } from '../src/services/localMusicService';
import { filterLocalSongs, groupLocalSongs, normalizeLibraryPath, splitLocalArtists } from '../src/services/localLibraryGrouping';

const song = (id: string, patch: Partial<LocalSong> = {}): LocalSong => ({
  id, path: `C:\\Music\\${id}.flac`, title: id, artist: 'AC/DC', album: 'Live',
  duration: 180, format: 'flac', size: 100, isLocal: true, ...patch,
});

describe('本地曲库纯派生分类', () => {
  it('仅分割明确分隔符，不破坏乐队名中的斜线、逗号或 &', () => {
    expect(splitLocalArtists(' AC/DC ; A / B；A、Earth, Wind & Fire '))
      .toEqual(['AC/DC', 'A', 'B', 'Earth, Wind & Fire']);
    expect(splitLocalArtists(' ; 、 ')).toEqual(['未知艺术家']);
  });

  it('艺术家分组去重、忽略大小写和多余空格，原曲对象及扩展字段完整保留', () => {
    const track = Object.freeze(song('one', {
      artist: 'AC/DC; ac/dc; Guest', lyricsOverride: '[00:01]手动歌词',
      coverOverride: 'asset://manual.jpg', replayGain: { gainDb: -4, peak: 0.9 },
    }));
    const tracks = Object.freeze([track, Object.freeze(song('two', { artist: ' guest ' }))]);
    const groups = groupLocalSongs(tracks, 'artist');
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.title === 'AC/DC')?.songs).toEqual([track]);
    const guest = groups.find((group) => group.title === 'Guest')!;
    expect(guest.songs.map((item) => item.id)).toEqual(['one', 'two']);
    expect(guest.songs[0]).toBe(track);
    expect(guest.songs[0].replayGain).toBe(track.replayGain);
  });

  it('同名专辑按完整艺术家署名区别，复合键无分隔符碰撞', () => {
    const tracks = [song('one'), song('two', { artist: 'Other' }),
      song('three', { artist: ' ac/dc ', album: ' LIVE ' }),
      song('four', { artist: 'A::B', album: 'C' }), song('five', { artist: 'A', album: 'B::C' })];
    const groups = groupLocalSongs(tracks, 'album');
    expect(groups).toHaveLength(4);
    expect(new Set(groups.map((group) => group.id)).size).toBe(4);
    expect(groups.find((group) => group.subtitle === 'AC/DC')?.songs.map((item) => item.id)).toEqual(['one', 'three']);
  });

  it('Windows 盘符、反斜杠、大小写及 UNC 归一，POSIX 大小写保留', () => {
    expect(normalizeLibraryPath('C:\\Music\\Rock\\')).toBe('c:/music/rock');
    expect(normalizeLibraryPath('c:/MUSIC//rock')).toBe('c:/music/rock');
    expect(normalizeLibraryPath('\\\\SERVER\\Share\\Music\\')).toBe('//server/share/music');
    expect(normalizeLibraryPath('\\\\?\\C:\\Music\\Rock')).toBe('c:/music/rock');
    expect(normalizeLibraryPath('\\\\?\\UNC\\Server\\Share\\Music')).toBe('//server/share/music');
    expect(normalizeLibraryPath('/Music/Rock')).toBe('/Music/Rock');
  });

  it('文件夹按完整父路径分组，不合并不同父目录下的同名文件夹', () => {
    const tracks = [song('a'), song('b', { path: 'c:/MUSIC/b.flac' }),
      song('c', { path: 'D:\\Music\\c.mp3' }), song('d', { path: 'C:\\d.mp3' }),
      song('e', { path: '\\\\Server\\Share\\e.mp3' })];
    const groups = groupLocalSongs(tracks, 'folder');
    expect(groups).toHaveLength(4);
    expect(groups.find((group) => group.subtitle === 'c:/music')?.songs.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups.map((group) => group.subtitle)).toContain('c:/');
    expect(groups.map((group) => group.subtitle)).toContain('//server/share');
  });

  it('缺少元数据仍有明确分类，空库返回空数组', () => {
    const tracks = [song('empty', { artist: ' ', album: '', path: 'empty.flac' })];
    expect(groupLocalSongs(tracks, 'artist')[0].title).toBe('未知艺术家');
    expect(groupLocalSongs(tracks, 'album')[0].title).toBe('未知专辑');
    expect(groupLocalSongs(tracks, 'folder')[0].title).toBe('未知文件夹');
    expect(filterLocalSongs(tracks, '未知艺术家')).toEqual(tracks);
    expect(filterLocalSongs(tracks, '未知专辑')).toEqual(tracks);
    expect(groupLocalSongs([], 'artist')).toEqual([]);
  });

  it('搜索标题、艺术家、专辑及路径，多个词取交集且保留原顺序和引用', () => {
    const tracks = [song('one', { title: 'Thunder', album: 'Back in Black' }), song('two', { artist: 'Other' })];
    expect(filterLocalSongs(tracks, ' ac/dc BLACK ')).toEqual([tracks[0]]);
    expect(filterLocalSongs(tracks, 'C:\\MUSIC\\ONE')).toEqual([tracks[0]]);
    expect(filterLocalSongs(tracks, 'thunder')[0]).toBe(tracks[0]);
    expect(filterLocalSongs(tracks, 'not-found')).toEqual([]);
    expect(filterLocalSongs(tracks, '  ')).toEqual(tracks);
  });
});
