import { describe, expect, it } from 'vitest';
import { getPlaylistCover } from '../src/utils/playlistCover';

describe('本地歌单封面的唯一选择规则', () => {
  it('显式封面优先于旧picUrl和歌曲封面', () => {
    expect(getPlaylistCover({ cover: ' custom ', picUrl: 'legacy', songs: [{ img: 'track' }] })).toBe('custom');
  });
  it('保留旧版picUrl，跳过空白显式封面', () => {
    expect(getPlaylistCover({ cover: '  ', picUrl: ' legacy ', songs: [{ img: 'track' }] })).toBe('legacy');
  });
  it('跳过无图歌曲，并兼容img为空但picUrl有图', () => {
    expect(getPlaylistCover({ songs: [{}, { img: '  ', picUrl: ' song ' }, { img: 'later' }] })).toBe('song');
  });
  it('空歌单无图时返回空，不构造伪地址', () => {
    expect(getPlaylistCover({ songs: [] })).toBe('');
    expect(getPlaylistCover({ songs: [{ img: '', picUrl: '' }] })).toBe('');
  });
  it('歌曲变更后即时派生封面，不修改输入或保存第二份状态', () => {
    const songs = Object.freeze([Object.freeze({ img: 'first' }), Object.freeze({ img: 'second' })]);
    const playlist = Object.freeze({ songs });
    expect(getPlaylistCover(playlist)).toBe('first');
    expect(getPlaylistCover({ ...playlist, songs: songs.slice(1) })).toBe('second');
    expect(playlist).not.toHaveProperty('cover');
  });
});
