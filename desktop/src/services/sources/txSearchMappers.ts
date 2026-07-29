import type { MusicInfo, PlaylistInfo } from "@lx/core";

function joinSingers(singers: any): string {
  if (!Array.isArray(singers)) return "";
  return singers
    .map((s) => s?.name ?? "")
    .filter(Boolean)
    .join("、");
}

function toSeconds(interval: number): number {
  return Math.round(interval);
}

function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function normalizeImageUrl(value: unknown): string | undefined {
  const url = asText(value).trim();
  if (!url) return undefined;
  return url.startsWith("http://") ? `https://${url.slice("http://".length)}` : url.startsWith("//") ? `https:${url}` : url;
}

function stripHtml(value: unknown): string | undefined {
  const text = asText(value).replace(/<[^>]+>/g, "").trim();
  return text || undefined;
}

function getMaxQuality(item: any): string {
  const file = item.file ?? item.songinfo?.file ?? {};
  const size = (...keys: string[]) => keys.some((key) => Number(file[key] ?? item[key] ?? 0) > 0);
  if (size("size_hires", "sizeHires", "size_hiresape")) return "flac24bit";
  if (size("size_flac", "sizeflac", "sizeape")) return "flac";
  if (size("size_320mp3", "size320", "size_320")) return "320k";
  if (size("size_128mp3", "size128", "size_128")) return "128k";
  return "128k";
}

export function mapTxPlaylist(item: any): PlaylistInfo | null {
  const id = asText(item?.dissid ?? item?.tid ?? item?.id ?? item?.dirid).trim();
  const name = asText(item?.dissname ?? item?.name ?? item?.title).trim();
  if (!id || !name) return null;

  return {
    id,
    name,
    author: asText(item?.creator?.name ?? item?.creator?.nick ?? item?.nickname ?? item?.author),
    picUrl: normalizeImageUrl(item?.imgurl ?? item?.logo ?? item?.picurl ?? item?.cover),
    desc: stripHtml(item?.introduction ?? item?.dissdesc ?? item?.desc),
    playCount: asNumber(item?.listennum ?? item?.visitnum ?? item?.listen_num ?? item?.playCount),
    trackCount: asNumber(item?.song_count ?? item?.songnum ?? item?.song_num ?? item?.total_song_num ?? item?.songCount),
    source: "tx",
  };
}

export function mapTxSong(item: any): MusicInfo | null {
  const file = item?.file ?? item?.songinfo?.file ?? item ?? {};
  const album = item?.album ?? {};
  const mediaMid = file.media_mid ?? item?.strMediaMid ?? item?.media_mid;
  const id = asText(item?.mid ?? item?.songmid ?? mediaMid ?? item?.id ?? item?.songid ?? item?.songId).trim();
  const name = asText(item?.title ?? item?.name ?? item?.songname ?? item?.songName).trim();
  if (!id || !name) return null;

  const albumMid = asText(album.mid ?? album.pmid ?? item?.albummid ?? item?.albumMid);
  const singerMid = asText(item?.singer?.[0]?.mid ?? item?.singerlist?.[0]?.mid);
  const image = normalizeImageUrl(
    item?.img ??
      item?.picUrl ??
      (albumMid && albumMid !== "空"
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
        : singerMid
          ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg`
          : ""),
  );

  return {
    id,
    name,
    singer: joinSingers(item?.singer ?? item?.singerlist ?? item?.singers),
    albumName: asText(album.name ?? item?.albumname ?? item?.albumName),
    source: "tx",
    interval: toSeconds(asNumber(item?.interval) ?? 0),
    quality: getMaxQuality(item),
    picUrl: image,
    img: image,
  };
}
