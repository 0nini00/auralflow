export function buildImportedPlaylistMarker(playlist: { source: string; id: string }): string {
  return `[af-imported-playlist:${playlist.source}:${playlist.id}]`;
}
