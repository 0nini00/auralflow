import type { MusicInfo } from "@lx/core";
import type { WyPlaylistInfo } from "./wyPlaylistService";
import type { LocalPlaylist } from "./localPlaylistModel";

export interface PlaylistTransferEnvelope {
  app: "auralflow";
  version: 1;
  exportedAt: number;
  playlists: Array<{
    name: string;
    description?: string;
    cover?: string;
    songs: MusicInfo[];
  }>;
}

export interface BuildPlaylistExportEnvelopeInput {
  likedSongs: MusicInfo[];
  localPlaylists?: LocalPlaylist[];
  currentPlaylist: WyPlaylistInfo | null;
  currentPlaylistSongs: MusicInfo[];
  exportedAt?: number;
}

export interface MergeImportedSongsResult {
  songs: MusicInfo[];
  addedCount: number;
}

export interface BuildImportedLocalPlaylistsOptions {
  now?: number;
  idPrefix?: string;
}

export interface BuildImportedLocalPlaylistsResult {
  localPlaylists: LocalPlaylist[];
  addedSongCount: number;
}

function songKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

export function buildPlaylistExportEnvelope({
  likedSongs,
  localPlaylists = [],
  currentPlaylist,
  currentPlaylistSongs,
  exportedAt = Date.now(),
}: BuildPlaylistExportEnvelopeInput): PlaylistTransferEnvelope {
  const playlists: PlaylistTransferEnvelope["playlists"] = [];

  if (likedSongs.length > 0) {
    playlists.push({
      name: "我喜欢的音乐",
      description: "移动端导出的我喜欢歌单",
      songs: likedSongs,
    });
  }

  for (const playlist of localPlaylists) {
    if (playlist.songs.length === 0) continue;
    playlists.push({
      name: playlist.name,
      description: playlist.description,
      cover: playlist.cover,
      songs: playlist.songs,
    });
  }

  if (currentPlaylist && currentPlaylistSongs.length > 0) {
    playlists.push({
      name: currentPlaylist.name,
      description: currentPlaylist.desc,
      songs: currentPlaylistSongs,
    });
  }

  return {
    app: "auralflow",
    version: 1,
    exportedAt,
    playlists,
  };
}

export function collectSongsFromTransferEnvelope(data: Partial<PlaylistTransferEnvelope>): MusicInfo[] {
  if (!data || !Array.isArray(data.playlists)) {
    throw new Error("无效的歌单数据格式");
  }

  const songs: MusicInfo[] = [];
  for (const playlist of data.playlists) {
    if (playlist && Array.isArray(playlist.songs)) {
      songs.push(...playlist.songs);
    }
  }
  return songs;
}

export function mergeImportedSongs(existing: MusicInfo[], imported: MusicInfo[]): MergeImportedSongsResult {
  const merged = [...existing];
  const mergedIds = new Set(existing.map(songKey));

  for (const song of imported) {
    const key = songKey(song);
    if (!mergedIds.has(key)) {
      merged.push(song);
      mergedIds.add(key);
    }
  }

  return {
    songs: merged,
    addedCount: merged.length - existing.length,
  };
}


export function buildImportedLocalPlaylists(
  existing: LocalPlaylist[],
  data: Partial<PlaylistTransferEnvelope>,
  options: BuildImportedLocalPlaylistsOptions = {},
): BuildImportedLocalPlaylistsResult {
  if (!data || !Array.isArray(data.playlists)) {
    throw new Error("无效的歌单数据格式");
  }

  const now = options.now ?? Date.now();
  const idPrefix = options.idPrefix ?? "import";
  const localPlaylists = existing.map((playlist) => ({
    ...playlist,
    songs: [...playlist.songs],
  }));
  let addedSongCount = 0;

  data.playlists.forEach((playlist, index) => {
    if (!playlist || !Array.isArray(playlist.songs) || playlist.songs.length === 0) return;
    const name = (playlist.name || `导入歌单 ${index + 1}`).trim() || `导入歌单 ${index + 1}`;
    const existingPlaylist = localPlaylists.find((item) => item.name === name);

    if (existingPlaylist) {
      const before = existingPlaylist.songs.length;
      const merged = mergeImportedSongs(existingPlaylist.songs, playlist.songs);
      existingPlaylist.songs = merged.songs;
      if (merged.addedCount > 0) existingPlaylist.updatedAt = now;
      addedSongCount += existingPlaylist.songs.length - before;
      return;
    }

    const uniqueSongs = mergeImportedSongs([], playlist.songs).songs;
    localPlaylists.push({
      id: `${idPrefix}-${now}-${index}`,
      name,
      description: playlist.description?.trim() || undefined,
      cover: playlist.cover?.trim() || undefined,
      songs: uniqueSongs,
      createdAt: now,
      updatedAt: now,
    });
    addedSongCount += uniqueSongs.length;
  });

  return { localPlaylists, addedSongCount };
}

export function isValidPlaylistTransferJson(json: string): boolean {
  try {
    const data = JSON.parse(json) as Partial<PlaylistTransferEnvelope>;
    return !!data && Array.isArray(data.playlists);
  } catch {
    return false;
  }
}
