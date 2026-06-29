import type { MusicInfo, PlaylistInfo } from "@lx/core";

export const WY_PLAYLIST_SUBSCRIBE_PATH = "/playlist/subscribe";

export interface PlaylistSubscribeRequest {
  path: string;
  payload: { id: string; t: 1 | 2 };
  pcCookie: true;
}

export function buildPlaylistSubscribePayload(playlistId: string, subscribe: boolean) {
  return {
    id: String(playlistId),
    t: subscribe ? 1 : 2,
  };
}

export function buildPlaylistSubscribeRequests(playlistId: string, subscribe: boolean): PlaylistSubscribeRequest[] {
  const id = String(playlistId);
  const t: 1 | 2 = subscribe ? 1 : 2;
  return [
    {
      path: WY_PLAYLIST_SUBSCRIBE_PATH,
      payload: { id, t },
      pcCookie: true,
    },
  ];
}

export function buildNeteasePcCookie(cookie: string): string {
  const parts = cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^os=/i.test(part));

  return [...parts, "os=pc"].join("; ");
}

function asFiniteNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function formatWanPlayCount(playCount: number): string {
  const wanCount = playCount / 10000;
  const rounded = playCount >= 10000
    ? Math.round(wanCount)
    : Math.round(wanCount * 10) / 10;
  return `${rounded}万播放`;
}

export function formatPlaylistSearchMeta(playlist: {
  trackCount?: number | null;
  playCount?: number | null;
}): string {
  const parts: string[] = [];
  const trackCount = asFiniteNumber(playlist.trackCount);
  const playCount = asFiniteNumber(playlist.playCount);

  if (trackCount != null) {
    parts.push(`${Math.max(0, Math.trunc(trackCount))}首歌`);
  }
  if (playCount != null) {
    parts.push(formatWanPlayCount(Math.max(0, playCount)));
  }

  return parts.length > 0 ? parts.join(" · ") : "--";
}

export function mapWySong(item: any): MusicInfo {
  const album = item.al ?? item.album ?? {};
  const artists = item.ar ?? item.artists ?? [];
  const privilege = item.privilege ?? {};
  const maxBr = privilege.maxbr ?? item.maxbr ?? 128000;
  let quality = "128k";
  if (privilege.maxBrLevel === "hires" || privilege.maxBrLevel === "lossless" || maxBr >= 999000) {
    quality = "flac";
  } else if (maxBr >= 320000) {
    quality = "320k";
  }

  const picUrl = album.picUrl ?? "";
  return {
    id: String(item.id),
    name: item.name ?? "",
    singer: artists
      .map((artist: any) => artist?.name ?? "")
      .filter(Boolean)
      .join("、"),
    albumName: album.name ?? "",
    source: "wy",
    interval: Math.round((item.dt ?? item.duration ?? 0) / 1000),
    quality,
    picUrl,
    img: picUrl,
  };
}

export function mapWyPlaylist(item: any): PlaylistInfo {
  return {
    id: String(item.id),
    name: item.name ?? "",
    author: item.creator?.nickname ?? "",
    picUrl: item.coverImgUrl,
    desc: item.description,
    playCount: asFiniteNumber(item.playCount),
    trackCount: asFiniteNumber(item.trackCount),
    source: "wy",
  };
}

function extractTrackIds(playlist: any): number[] {
  return ((playlist?.trackIds as any[]) ?? [])
    .map((item) => Number(item?.id))
    .filter((trackId) => Number.isFinite(trackId));
}

export async function resolveWyPlaylistTracks(
  playlist: any,
  fetchSongDetails: (ids: number[]) => Promise<any[]>,
): Promise<any[]> {
  const previewTracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
  const trackIds = extractTrackIds(playlist);

  if (trackIds.length <= previewTracks.length) {
    return previewTracks;
  }

  return fetchSongDetails(trackIds);
}
