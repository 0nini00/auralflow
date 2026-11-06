import type { MusicInfo } from '@lx/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { libraryLoad, librarySave, listCachedAudio, lookupCachedMedia, removeCachedMedia, type CachedAudioFile } from '@lx/tauri-bridge';

interface AudioMetadata { name: string; singer: string; albumName: string; quality: string }
export interface OfflineAudioEntry extends CachedAudioFile, AudioMetadata {}

export function createOfflineCacheLibrary() {
  let writes: Promise<unknown> = Promise.resolve();
  async function readIndex(): Promise<Record<string, AudioMetadata>> {
    const raw = await libraryLoad<unknown>('audioIndex');
    if (raw == null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('离线缓存索引格式错误');
    for (const item of Object.values(raw)) {
      if (!item || typeof item !== 'object' || ['name', 'singer', 'albumName', 'quality'].some(key => typeof item[key] !== 'string')) {
        throw new Error('离线缓存索引格式错误');
      }
    }
    return raw as Record<string, AudioMetadata>;
  }
  function changeIndex(update: (index: Record<string, AudioMetadata>) => Record<string, AudioMetadata>) {
    const result = writes.catch(() => undefined).then(async () => {
      const current = await readIndex();
      const next = update(current);
      if (next !== current) await librarySave('audioIndex', next);
    });
    writes = result;
    return result;
  }
  return {
    record(key: string, song: MusicInfo, quality: string): Promise<void> {
      const normalized = key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      return changeIndex(index => {
        const next = { name: song.name, singer: song.singer, albumName: song.albumName ?? '', quality };
        const current = index[normalized];
        if (current && current.name === next.name && current.singer === next.singer && current.albumName === next.albumName && current.quality === quality) return index;
        return { ...index, [normalized]: next };
      });
    },
    async list(): Promise<OfflineAudioEntry[]> {
      // 写入错误已交回原调用者；刷新独立重读当前磁盘状态，可以从暂时失败恢复。
      await writes.catch(() => undefined);
      const [files, index] = await Promise.all([listCachedAudio(), readIndex()]);
      return files.map(file => ({ ...file,
        name: index[file.key]?.name || file.key,
        singer: index[file.key]?.singer || '元数据未记录',
        albumName: index[file.key]?.albumName || '',
        quality: index[file.key]?.quality || '',
      }));
    },
    async play(entries: OfflineAudioEntry[], index: number): Promise<void> {
      const target = entries[index];
      if (!target) throw new Error('离线缓存条目不存在');
      // 只校验要播的那一条：整页逐条 lookup 既慢（几百次 IPC），
      // 也会因为别的歌被淘汰而让用户点的那一首播不了。
      const file = await lookupCachedMedia('audio', target.key);
      if (!file) throw new Error(`缓存文件已不存在：${target.name}，请刷新列表`);
      const songs: MusicInfo[] = entries.map(entry => ({
        id: `offline:${entry.key}`, source: 'local', name: entry.name, singer: entry.singer,
        albumName: entry.albumName, isLocal: true, localPath: entry.path,
        url: convertFileSrc(entry.path), quality: entry.quality,
      }));
      songs[index] = { ...songs[index], localPath: file.path, url: convertFileSrc(file.path) };
      const { usePlayerStore } = await import('@/stores/playerStore');
      await usePlayerStore.getState().playQueue(songs, index);
    },
    async remove(entries: OfflineAudioEntry[]): Promise<void> {
      for (const entry of entries) {
        await removeCachedMedia('audio', entry.key);
        await changeIndex(index => { const next = { ...index }; delete next[entry.key]; return next; });
      }
    },
  };
}
export const offlineCache = createOfflineCacheLibrary();
