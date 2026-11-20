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

// ─── 歌曲详情查询：为缺少 txMeta 的历史曲目补齐 strMediaMid ─────────────

/** QQ 音乐 musicu 接口（歌曲详情与取链共用）。 */
export const TX_SONG_DETAIL_API = "https://u.y.qq.com/cgi-bin/musicu.fcg";

export interface TxJsonRequestInit {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** 注入式 JSON 请求：桌面走 Tauri plugin-http，移动端走 RN fetch。 */
export type TxJsonFetcher = (url: string, init: TxJsonRequestInit) => Promise<unknown>;

/** 与现有 QQ 请求保持一致的客户端头；详情查询不需要登录 Cookie。 */
const TX_DETAIL_HEADERS: Record<string, string> = {
  "User-Agent": "okhttp/3.14.9",
  "Content-Type": "application/json",
  Cookie: "tmeLoginType=-1;",
};

export function buildTxSongDetailRequest(songmid: string): TxJsonRequestInit {
  return {
    method: "POST",
    headers: TX_DETAIL_HEADERS,
    body: JSON.stringify({
      comm: {
        ct: 11,
        cv: "1003006",
        v: "1003006",
        os_ver: "15",
        tmeAppID: "qqmusiclight",
        nettype: "NETWORK_WIFI",
        udid: "0",
        uid: "0",
      },
      request: {
        method: "get_song_detail_yqq",
        module: "music.pf_song_detail_svr",
        param: { song_type: 0, song_mid: songmid },
      },
    }),
  };
}

/**
 * 按 songmid 查询 QQ 歌曲详情并提取取链元数据。
 *
 * 歌单详情/搜索响应在旧数据里可能没有 `file.media_mid`（或整条 txMeta 缺失），
 * 历史歌单里的曲目因此只能拿 songmid 顶替媒体 ID；两者不同的歌（例如晴天
 * songmid 0039MnYb0qxYhV / media_mid 003Qui1q2u1Zho）会被脚本拼出 403 的
 * 文件名。这里只补元数据，不取播放地址，不依赖账号权限。
 */
export async function fetchTxTrackMeta(
  songmid: string,
  fetchJson: TxJsonFetcher,
): Promise<TxTrackMeta | undefined> {
  const id = songmid.trim();
  if (!id) return undefined;
  const data = (await fetchJson(TX_SONG_DETAIL_API, buildTxSongDetailRequest(id))) as {
    code?: number;
    request?: { code?: number; data?: { track_info?: unknown } };
    songinfo?: { data?: { track_info?: unknown } };
    track_info?: unknown;
  } | null;
  if (!data) return undefined;
  if (data.code != null && data.code !== 0) {
    throw new Error(`QQ 音乐歌曲详情失败: code=${data.code}`);
  }
  if (data.request?.code != null && data.request.code !== 0) {
    throw new Error(`QQ 音乐歌曲详情失败: code=${data.request.code}`);
  }
  const track = data.request?.data?.track_info ?? data.songinfo?.data?.track_info ?? data.track_info;
  return extractTxTrackMeta(track);
}
