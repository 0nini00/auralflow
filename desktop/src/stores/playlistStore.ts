import { create } from 'zustand';
import type { MusicInfo } from '@lx/core';
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

  // 导入：用外部数据创建新歌单（用于导入导出）
  importPlaylist: (name: string, description: string | undefined, songs: MusicInfo[]) => Playlist;
}

export const usePlaylistStore = create<PlaylistStore>()((set, get) => ({
      playlists: [],

      createPlaylist: (name, description) => {
        const newPlaylist: Playlist = {
          id: `playlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
          id: `playlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: `${original.name} (副本)`,
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
          id: `playlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
}));

attachLibraryPersistence<PlaylistStore, { playlists: Playlist[] }>(usePlaylistStore, {
  namespace: 'playlists',
  pick: (state) => ({ playlists: state.playlists }),
  apply: (slice, set) => set({ playlists: slice.playlists ?? [] }),
  legacyLocalStorageKey: 'playlist-storage',
});
