import { create } from 'zustand';
import { dropRemovedSourceEntries, mergeWebdavLocalPlaylists, scrubSyncedCloudPlaylistRefs, type MusicInfo } from '@lx/core';
import { attachLibraryPersistence } from './libraryPersistence';

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  songs: MusicInfo[];
  createdAt: number;
  updatedAt: number;
}

interface PlaylistStore {
  playlists: Playlist[];

  // 歌单操作
  createPlaylist: (name: string, description?: string) => Playlist;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, name: string) => void;
  updatePlaylistDescription: (id: string, description: string) => void;
  updatePlaylistCover: (id: string, cover: string) => void;

  // 歌曲操作
  addSongToPlaylist: (playlistId: string, song: MusicInfo) => void;
  removeSongFromPlaylist: (playlistId: string, songIndex: number) => void;
  moveSongInPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => void;

  // 批量操作
  clearPlaylist: (id: string) => void;
  duplicatePlaylist: (id: string) => Playlist;
  replaceAll: (playlists: Playlist[]) => void;
  /** WebDAV 同步合并：本地与远端歌单按 id 并集,同名同 id 歌曲并集,取较新者。 */
  mergeAll: (playlists: Playlist[]) => void;

  // 导入：用外部数据创建新歌单（用于导入导出）
  importPlaylist: (name: string, description: string | undefined, songs: MusicInfo[]) => Playlist;
}

export const usePlaylistStore = create<PlaylistStore>()((set, get) => ({
      playlists: [],

      createPlaylist: (name, description) => {
        const newPlaylist: Playlist = {
          id: `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          name,
          description,
          songs: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        set((state) => ({
          playlists: [...state.playlists, newPlaylist],
        }));

        return newPlaylist;
      },

      deletePlaylist: (id) => {
        set((state) => ({
          playlists: state.playlists.filter((p) => p.id !== id),
        }));
      },

      renamePlaylist: (id, name) => {
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === id ? { ...p, name, updatedAt: Date.now() } : p
          ),
        }));
      },

      updatePlaylistDescription: (id, description) => {
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === id ? { ...p, description, updatedAt: Date.now() } : p
          ),
        }));
      },

      updatePlaylistCover: (id, cover) => {
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === id ? { ...p, cover, updatedAt: Date.now() } : p
          ),
        }));
      },

      addSongToPlaylist: (playlistId, song) => {
        set((state) => ({
          playlists: state.playlists.map((p) => {
            if (p.id !== playlistId) return p;

            // 检查是否已存在
            const exists = p.songs.some(
              (s) => s.id === song.id && s.source === song.source
            );

            if (exists) return p;

            return {
              ...p,
              songs: [...p.songs, song],
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      removeSongFromPlaylist: (playlistId, songIndex) => {
        set((state) => ({
          playlists: state.playlists.map((p) => {
            if (p.id !== playlistId) return p;

            return {
              ...p,
              songs: p.songs.filter((_, i) => i !== songIndex),
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      moveSongInPlaylist: (playlistId, fromIndex, toIndex) => {
        set((state) => ({
          playlists: state.playlists.map((p) => {
            if (p.id !== playlistId) return p;

            const newSongs = [...p.songs];
            const [movedSong] = newSongs.splice(fromIndex, 1);
            newSongs.splice(toIndex, 0, movedSong);

            return {
              ...p,
              songs: newSongs,
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      clearPlaylist: (id) => {
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === id ? { ...p, songs: [], updatedAt: Date.now() } : p
          ),
        }));
      },

      duplicatePlaylist: (id) => {
        const original = get().playlists.find((p) => p.id === id);
        if (!original) {
          throw new Error('Playlist not found');
        }

        const duplicated: Playlist = {
          ...original,
          id: `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          name: `${original.name} (副本)`,
          songs: original.songs.map((s) => ({ ...s })),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        set((state) => ({
          playlists: [...state.playlists, duplicated],
        }));

        return duplicated;
      },

      importPlaylist: (name, description, songs) => {
        const newPlaylist: Playlist = {
          id: `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          name,
          description,
          songs: songs ?? [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({ playlists: [...state.playlists, newPlaylist] }));
        return newPlaylist;
      },

      replaceAll: (playlists) => {
        set({ playlists: playlists ?? [] });
      },

      mergeAll: (remotePlaylists) => {
        set((state) => ({
          playlists: stripRemovedSourcesFromPlaylists(
            scrubSyncedCloudPlaylists(
              mergeWebdavLocalPlaylists(state.playlists, remotePlaylists ?? []),
            ),
          ),
        }));
      },
}));

const CLOUD_REF_SCRUB_BACKUP_KEY = 'auralflow:library:playlists:scrub-backup';

function backupDroppedPlaylists(dropped: Playlist[]): void {
  try {
    const raw = localStorage.getItem(CLOUD_REF_SCRUB_BACKUP_KEY);
    const previous = raw ? ((JSON.parse(raw) as { dropped?: Playlist[] }).dropped ?? []) : [];
    localStorage.setItem(
      CLOUD_REF_SCRUB_BACKUP_KEY,
      JSON.stringify({ savedAt: Date.now(), dropped: [...previous, ...dropped] }),
    );
  } catch (err) {
    void err;
  }
}

/**
 * 丢掉歌单里来源已被移除的歌曲（本版整体下线了 B 站）。歌单本身保留，只清掉点不动的行。
 * 与 `scrubSyncedCloudPlaylists` 一样要在**读盘后**与**同步合并后**各跑一次，
 * 否则最后一次同步会把云端那份旧数据再合并回来。
 */
function stripRemovedSourcesFromPlaylists(playlists: Playlist[]): Playlist[] {
  let removed = 0;
  const next = (playlists ?? []).map((playlist) => {
    const { kept, dropped } = dropRemovedSourceEntries(playlist.songs ?? []);
    if (dropped.length === 0) return playlist;
    removed += dropped.length;
    return { ...playlist, songs: kept };
  });
  if (removed > 0) {
    console.warn(`[歌单] 已清理 ${removed} 首来源已下线的歌曲`);
  }
  return next;
}

/**
 * 剔除被 WebDAV 同步误导入的云端歌单（网易云 / QQ 歌单引用曾被物化成本地歌单，本地必然 0 首歌曲）。
 *
 * 判定规则本身在 `@lx/core` 的 `scrubSyncedCloudPlaylistRefs`（两端共用同一套规则、有单测）；
 * 这里只做平台侧的事：把被剔除的原始数据先备份到 localStorage，再告警。
 */
export function scrubSyncedCloudPlaylists(playlists: Playlist[]): Playlist[] {
  if (!Array.isArray(playlists) || playlists.length === 0) return playlists ?? [];

  const { kept, dropped, suspicious } = scrubSyncedCloudPlaylistRefs(playlists);

  if (dropped.length === 0) {
    if (suspicious.length > 0) {
      console.warn(
        '[歌单] 检测到疑似同步污染的歌单（纯数字 id 但含歌曲），已保留未删除：',
        suspicious.map((p) => p.name),
      );
    }
    return playlists;
  }

  backupDroppedPlaylists(dropped);
  console.warn(
    `[歌单] 已剔除 ${dropped.length} 个被 WebDAV 同步误导入的云端歌单（本地为 0 首）：` +
      `${dropped.map((p) => p.name).join('、')}。` +
      `原始数据已备份到 localStorage:${CLOUD_REF_SCRUB_BACKUP_KEY}`,
  );
  return kept;
}

export const playlistPersistence = attachLibraryPersistence<PlaylistStore, { playlists: Playlist[] }>(usePlaylistStore, {
  namespace: 'playlists',
  pick: (state) => ({ playlists: state.playlists }),
  apply: (slice, set) => set({ playlists: stripRemovedSourcesFromPlaylists(scrubSyncedCloudPlaylists(slice.playlists ?? [])) }),
  legacyLocalStorageKey: 'playlist-storage',
});
