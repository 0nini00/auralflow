export interface PlaybackPrefetchSong {
  source: string;
  id: string | number;
}

export function buildPlaybackPrefetchKey(
  song: PlaybackPrefetchSong,
  quality: string,
): string {
  return `${song.source}:${song.id}:${quality}`;
}

export function isPlaybackPrefetchKeyForSong(
  key: string,
  song: PlaybackPrefetchSong,
): boolean {
  return key.startsWith(`${song.source}:${song.id}:`);
}
