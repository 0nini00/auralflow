import type { MusicInfo } from "@lx/core";

type WyTrackRecord = Record<string, unknown>;

function asRecord(value: unknown): WyTrackRecord | undefined {
  return value != null && typeof value === "object" ? value as WyTrackRecord : undefined;
}

export function normalizeWyMvId(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? String(value) : undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized === "0") return undefined;
  return normalized;
}

export function mapWyTrackToMusicInfo(track: unknown): MusicInfo {
  const trackRecord = asRecord(track);
  const song = asRecord(trackRecord?.song) ?? trackRecord;
  const artists = Array.isArray(song?.ar)
    ? song.ar
    : Array.isArray(song?.artists)
      ? song.artists
      : song?.artist
        ? [song.artist]
        : [];
  const artistRecords = artists.map(asRecord).filter((artist): artist is WyTrackRecord => artist != null);
  const album = asRecord(song?.al) ?? asRecord(song?.album);
  const artworkValue = album?.picUrl ?? song?.picUrl;
  const artwork = typeof artworkValue === "string" ? artworkValue : undefined;
  const id = String(song?.id ?? "");

  return {
    id,
    name: typeof song?.name === "string" && song.name ? song.name : "未知歌曲",
    singer: artistRecords
      .map((artist) => artist.name)
      .filter((name): name is string => typeof name === "string" && Boolean(name))
      .join(" / ") ||
      (typeof song?.singer === "string" && song.singer.trim() ? song.singer : "未知歌手"),
    artistId: artistRecords[0]?.id != null ? String(artistRecords[0].id) : undefined,
    albumName: typeof album?.name === "string" ? album.name : "",
    source: "wy",
    interval: Number(song?.dt ?? song?.duration ?? 0) / 1000,
    quality: "320k",
    picUrl: artwork,
    img: artwork,
    mvId: normalizeWyMvId(song?.mv),
    gateway: {
      source: "netease",
      trackId: id,
      lyricId: id,
      picId: id,
    },
  };
}
