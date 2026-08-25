import type { TxTrackMeta } from "./types";

/**
 * 从 QQ 音乐接口返回的原始条目提取取链元数据（搜索与歌单响应结构一致）。
 *
 * lx 自定义音源脚本按 lx-music 协议消费 musicInfo，tx 取链依赖 strMediaMid
 * 拼文件名（M500{mid}.mp3 / F000{mid}.flac）。只传 songmid 时脚本拿不到媒体
 * 标识，解析必然失败——这是双端 lx 源都播不了 tx 的根因。
 */
export function extractTxTrackMeta(item: unknown): TxTrackMeta | undefined {
  const raw = item as Record<string, any> | null;
  if (!raw) return undefined;

  const file = raw.file ?? raw.songinfo?.file ?? raw ?? {};
  const album = raw.album ?? {};

  const strMediaMid = asText(file.media_mid ?? raw.strMediaMid ?? raw.media_mid);
  const albumMid = asText(album.mid ?? album.pmid ?? raw.albummid ?? raw.albumMid);
  const songId = asText(raw.id ?? raw.songid ?? raw.songId);

  if (!strMediaMid && !albumMid && !songId) return undefined;
  return {
    ...(strMediaMid ? { strMediaMid } : {}),
    ...(albumMid ? { albumMid } : {}),
    ...(songId ? { songId } : {}),
  };
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
