import type { MusicInfo } from "@lx/core";

export interface LocalPlaylist {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  songs: MusicInfo[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateLocalPlaylistInput {
  name: string;
  description?: string;
  cover?: string;
  id?: string;
  now?: number;
}

export interface CreateLocalPlaylistWithSongInput extends CreateLocalPlaylistInput {
  song: MusicInfo;
}

export interface CreateLocalPlaylistWithSongsInput extends CreateLocalPlaylistInput {
  songs: MusicInfo[];
}

export interface DuplicateLocalPlaylistOptions {
  id?: string;
  now?: number;
}

export interface UpdateLocalPlaylistInfoInput {
  name: string;
  description?: string;
  cover?: string;
  now?: number;
}

export interface AddSongsToLocalPlaylistResult {
  playlists: LocalPlaylist[];
  addedCount: number;
  skippedCount: number;
}

const EMPTY_PLAYLIST_NAME_ERROR = "歌单名称不能为空";
const PLAYLIST_NOT_FOUND_ERROR = "歌单不存在";

function getNow(now?: number): number {
  return now ?? Date.now();
}

function createLocalPlaylistId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDuplicatePlaylistName(name: string): string {
  return `${name} (副本)`;
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error(EMPTY_PLAYLIST_NAME_ERROR);
  return normalized;
}

function normalizeDescription(description?: string): string | undefined {
  const normalized = description?.trim();
  return normalized || undefined;
}

function normalizeCover(cover?: string): string | undefined {
  const normalized = cover?.trim();
  return normalized || undefined;
}

function getSongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

function dedupeSongs(songs: MusicInfo[]): MusicInfo[] {
  const seen = new Set<string>();
  const result: MusicInfo[] = [];
  for (const song of songs) {
    const key = getSongKey(song);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(song);
  }
  return result;
}

function findLocalPlaylistIndex(playlists: LocalPlaylist[], playlistId: string): number {
  const index = playlists.findIndex((playlist) => playlist.id === playlistId);
  if (index < 0) throw new Error(PLAYLIST_NOT_FOUND_ERROR);
  return index;
}

function updateLocalPlaylist(
  playlists: LocalPlaylist[],
  playlistId: string,
  updater: (playlist: LocalPlaylist) => LocalPlaylist,
): LocalPlaylist[] {
  const index = findLocalPlaylistIndex(playlists, playlistId);
  return playlists.map((playlist, currentIndex) => (currentIndex === index ? updater(playlist) : playlist));
}

export function createLocalPlaylist(
  playlists: LocalPlaylist[],
  input: CreateLocalPlaylistInput,
): LocalPlaylist[] {
  const now = getNow(input.now);
  const cover = normalizeCover(input.cover);
  const playlist: LocalPlaylist = {
    id: input.id ?? createLocalPlaylistId(),
    name: normalizeName(input.name),
    description: normalizeDescription(input.description),
    songs: [],
    createdAt: now,
    updatedAt: now,
  };
  return [{ ...playlist, ...(cover ? { cover } : {}) }, ...playlists];
}


export function createLocalPlaylistWithSong(
  playlists: LocalPlaylist[],
  input: CreateLocalPlaylistWithSongInput,
): LocalPlaylist[] {
  return createLocalPlaylistWithSongs(playlists, {
    ...input,
    songs: [input.song],
  });
}

export function createLocalPlaylistWithSongs(
  playlists: LocalPlaylist[],
  input: CreateLocalPlaylistWithSongsInput,
): LocalPlaylist[] {
  const [playlist, ...rest] = createLocalPlaylist(playlists, input);
  return [
    {
      ...playlist,
      songs: dedupeSongs(input.songs),
    },
    ...rest,
  ];
}

export function renameLocalPlaylist(
  playlists: LocalPlaylist[],
  playlistId: string,
  name: string,
  now?: number,
): LocalPlaylist[] {
  const normalizedName = normalizeName(name);
  const updatedAt = getNow(now);
  return updateLocalPlaylist(playlists, playlistId, (playlist) => ({
    ...playlist,
    name: normalizedName,
    updatedAt,
  }));
}

export function updateLocalPlaylistInfo(
  playlists: LocalPlaylist[],
  playlistId: string,
  input: UpdateLocalPlaylistInfoInput,
): LocalPlaylist[] {
  const normalizedName = normalizeName(input.name);
  const updatedAt = getNow(input.now);
  const description = normalizeDescription(input.description);
  return updateLocalPlaylist(playlists, playlistId, (playlist) => ({
    ...playlist,
    name: normalizedName,
    description,
    ...("cover" in input ? { cover: normalizeCover(input.cover) } : {}),
    updatedAt,
  }));
}

export function duplicateLocalPlaylist(
  playlists: LocalPlaylist[],
  playlistId: string,
  options: DuplicateLocalPlaylistOptions = {},
): LocalPlaylist[] {
  const index = findLocalPlaylistIndex(playlists, playlistId);
  const original = playlists[index]!;
  const now = getNow(options.now);
  const duplicated: LocalPlaylist = {
    ...original,
    id: options.id ?? createLocalPlaylistId(),
    name: createDuplicatePlaylistName(original.name),
    songs: [...original.songs],
    createdAt: now,
    updatedAt: now,
  };

  return [...playlists, duplicated];
}

export function deleteLocalPlaylist(playlists: LocalPlaylist[], playlistId: string): LocalPlaylist[] {
  return playlists.filter((playlist) => playlist.id !== playlistId);
}

export function addSongsToLocalPlaylist(
  playlists: LocalPlaylist[],
  playlistId: string,
  songs: MusicInfo[],
): AddSongsToLocalPlaylistResult {
  const updatedAt = getNow();
  let addedCount = 0;
  let skippedCount = 0;
  const updatedPlaylists = updateLocalPlaylist(playlists, playlistId, (playlist) => {
    const existingKeys = new Set(playlist.songs.map(getSongKey));
    const songsToAdd: MusicInfo[] = [];

    for (const song of songs) {
      const key = getSongKey(song);
      if (existingKeys.has(key)) {
        skippedCount += 1;
        continue;
      }
      existingKeys.add(key);
      songsToAdd.push(song);
      addedCount += 1;
    }

    if (songsToAdd.length === 0) return playlist;
    return {
      ...playlist,
      songs: [...playlist.songs, ...songsToAdd],
      updatedAt,
    };
  });

  return { playlists: updatedPlaylists, addedCount, skippedCount };
}

export function addSongToLocalPlaylist(
  playlists: LocalPlaylist[],
  playlistId: string,
  song: MusicInfo,
  now?: number,
): LocalPlaylist[] {
  const updatedAt = getNow(now);
  return updateLocalPlaylist(playlists, playlistId, (playlist) => {
    const songKey = getSongKey(song);
    if (playlist.songs.some((item) => getSongKey(item) === songKey)) return playlist;
    return {
      ...playlist,
      songs: [...playlist.songs, song],
      updatedAt,
    };
  });
}

export function removeSongFromLocalPlaylist(
  playlists: LocalPlaylist[],
  playlistId: string,
  song: Pick<MusicInfo, "source" | "id">,
  now?: number,
): LocalPlaylist[] {
  const updatedAt = getNow(now);
  return updateLocalPlaylist(playlists, playlistId, (playlist) => {
    const songKey = getSongKey(song);
    const songs = playlist.songs.filter((item) => getSongKey(item) !== songKey);
    if (songs.length === playlist.songs.length) return playlist;
    return {
      ...playlist,
      songs,
      updatedAt,
    };
  });
}

export function getLocalPlaylistTrackCount(playlist: LocalPlaylist | null | undefined): number {
  return playlist?.songs.length ?? 0;
}
