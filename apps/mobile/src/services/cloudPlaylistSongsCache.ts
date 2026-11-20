import type { MusicInfo } from '@lx/core';
import { createSerialTaskQueue } from '@/utils/serialTaskQueue';

const LEGACY_KEY = 'auralflow.mobile.webdavCloudPlaylistSongs';
const ENTRY_PREFIX = `${LEGACY_KEY}.playlist.v1:`;

interface CacheStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<unknown>;
  removeItem: (key: string) => Promise<unknown>;
}

interface RemoteMergeOptions {
  sinceRevision?: number;
  onlyMissing?: boolean;
  overwriteLocal?: boolean;
}

interface CachedSongs {
  songs: MusicInfo[];
  origin: 'local' | 'remote';
}

function parseSongs(value: unknown): MusicInfo[] {
  if (!Array.isArray(value) || value.some(song => !song || typeof song !== 'object'
    || typeof song.id !== 'string' || !song.id || typeof song.source !== 'string'
    || typeof song.name !== 'string' || typeof song.singer !== 'string')) {
    throw new Error('WebDAV 歌单歌曲缓存格式错误');
  }
  return value as MusicInfo[];
}

function parseEntry(value: unknown): CachedSongs {
  // 旧记录未区分编辑与下载来源；保留其中的歌曲，只有显式下载可以覆盖。
  if (Array.isArray(value)) return { songs: parseSongs(value), origin: 'local' };
  if (!value || typeof value !== 'object' || !('origin' in value) || !('songs' in value)
    || (value.origin !== 'local' && value.origin !== 'remote')) {
    throw new Error('WebDAV 歌单歌曲缓存格式错误');
  }
  return { songs: parseSongs(value.songs), origin: value.origin };
}

/** 来源和歌曲在同一事务落盘；自动合并保留本地编辑，重启后仍能区分远端快照。 */
export function createCloudPlaylistSongsCache(storage: CacheStorage) {
  const enqueue = createSerialTaskQueue();
  const values = new Map<string, CachedSongs | undefined>();
  const localRevisions = new Map<string, number>();
  const failures = new Map<string, unknown>();
  let migrated = false;
  let revision = 0;
  const storageKey = (key: string) => ENTRY_PREFIX + encodeURIComponent(key);

  async function migrate(): Promise<void> {
    if (migrated) return;
    const raw = await storage.getItem(LEGACY_KEY);
    if (raw !== null) {
      const legacy: unknown = JSON.parse(raw);
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
        throw new Error('WebDAV 旧歌单歌曲缓存格式错误');
      }
      const entries = Object.entries(legacy).map(([key, songs]) => [key, parseSongs(songs)] as const);
      for (const [key, songs] of entries) {
        // 上次迁移可能只完成了一部分；已有独立记录包含更新或清空，不能被旧文件覆盖。
        if (await storage.getItem(storageKey(key)) === null) {
          await storage.setItem(storageKey(key), JSON.stringify({ songs, origin: 'local' }));
        }
      }
      await storage.removeItem(LEGACY_KEY);
    }
    migrated = true;
  }

  async function read(key: string): Promise<CachedSongs | undefined> {
    if (failures.has(key)) throw failures.get(key);
    if (values.has(key)) return values.get(key);
    const raw = await storage.getItem(storageKey(key));
    const entry = raw === null ? undefined : parseEntry(JSON.parse(raw));
    values.set(key, entry);
    return entry;
  }

  async function write(key: string, entry: CachedSongs): Promise<void> {
    try {
      await storage.setItem(storageKey(key), JSON.stringify(entry));
      values.set(key, entry);
      failures.delete(key);
    } catch (error) {
      failures.set(key, error);
      throw error;
    }
  }

  return {
    revision: () => revision,
    get: (key: string) => enqueue(async () => { await migrate(); return (await read(key))?.songs; }),
    setLocal: (key: string, songs: MusicInfo[]) => {
      // 在入队时标记，网络响应不能越过尚未落盘的编辑。
      localRevisions.set(key, ++revision);
      return enqueue(async () => {
        try { await migrate(); await write(key, { songs, origin: 'local' }); }
        catch (error) { failures.set(key, error); throw error; }
      });
    },
    mergeRemote: (entries: ReadonlyMap<string, MusicInfo[]>, options: RemoteMergeOptions = {}) => {
      const sinceRevision = options.sinceRevision ?? revision;
      return enqueue(async () => {
        await migrate();
        for (const [key, songs] of entries) {
          const previous = await read(key);
          if ((localRevisions.get(key) ?? 0) > sinceRevision) continue;
          if (previous?.origin === 'local' && !options.overwriteLocal) continue;
          if (options.onlyMissing && previous !== undefined) continue;
          await write(key, { songs, origin: 'remote' });
        }
      });
    },
  };
}
