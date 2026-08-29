import { parsePlaylistLink, type MusicInfo, type PlaylistInfo } from '@lx/core';

import { registry } from './sources/sourceService';

/**
 * 粘贴链接导入歌单（桌面端）：解析网易云/QQ 歌单链接 →
 * 走对应音源 Provider 的 getPlaylistDetail 拉取歌曲。
 * 与移动端 playlistLinkImportService 语义一致，解析逻辑共用 @lx/core。
 */

export interface PlaylistLinkImportResult {
  source: 'wy' | 'tx';
  playlistId: string;
  songCount: number;
}

export async function fetchPlaylistSongsFromLink(link: string): Promise<{
  source: 'wy' | 'tx';
  playlistId: string;
  songs: MusicInfo[];
}> {
  const parsed = parsePlaylistLink(link);
  if (!parsed) {
    throw new Error('无法识别歌单链接，支持网易云 / QQ 音乐歌单链接或纯数字歌单 ID');
  }

  const provider = registry.list().find((s) => s.id === parsed.source);
  if (!provider?.getPlaylistDetail) {
    throw new Error('当前音源不可用，无法拉取歌单');
  }

  const playlistInfo: PlaylistInfo = {
    id: parsed.playlistId,
    name: '导入的歌单',
    author: '',
    source: parsed.source,
  };

  const songs = await provider.getPlaylistDetail(playlistInfo);
  if (!songs || songs.length === 0) {
    throw new Error('歌单为空或拉取失败，请确认链接后重试');
  }

  return { source: parsed.source, playlistId: parsed.playlistId, songs };
}
