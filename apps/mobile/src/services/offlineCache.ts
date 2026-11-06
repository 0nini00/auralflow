import RNFS from 'react-native-fs';
import type { MusicInfo } from '@lx/core';
import type { CachedAudioEntry } from './audioCacheListModel';
import { playQueue } from './playerService';

/** 离线实体不携带在线来源/变体，文件丢失必须失败，不转成在线解析。 */
export async function playOfflineCache(entries: CachedAudioEntry[], index = 0): Promise<void> {
  const songs: MusicInfo[] = [];
  for (const entry of entries) {
    if (!await RNFS.exists(entry.path)) throw new Error(`缓存文件已不存在：${entry.name || entry.key}，请刷新列表`);
    songs.push({ id: `offline:${entry.key}`, source: 'local', name: entry.name || entry.key,
      singer: entry.singer || '元数据未记录', albumName: '', quality: entry.quality,
      isLocal: true, url: `file://${entry.path}` });
  }
  await playQueue(songs, index);
}
