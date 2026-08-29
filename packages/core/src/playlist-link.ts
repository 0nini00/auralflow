/**
 * 歌单外链解析（双端共享）。
 *
 * 支持的输入：
 * - 网易云：music.163.com/#/playlist?id=xxx、y.music.163.com/m/playlist?...id=xxx、
 *   music.163.com/playlist/<id>/<任意>、纯数字歌单 ID（按网易云处理）
 * - QQ 音乐：y.qq.com/n/ryqq/playlist/<id>、taoge.html?id=<disstid>、…disstid=xxx
 * 无法识别返回 null，由调用方提示用户。
 */

export interface ParsedPlaylistLink {
  source: "wy" | "tx";
  playlistId: string;
}

export function parsePlaylistLink(raw: string): ParsedPlaylistLink | null {
  const text = raw.trim();
  if (!text) return null;

  if (/music\.163\.com/i.test(text)) {
    const queryId = text.match(/[?&]id=(\d+)/);
    const pathId = text.match(/playlist\/(\d+)/i);
    const fallbackId = text.match(/(\d{6,})/);
    const playlistId = queryId?.[1] ?? pathId?.[1] ?? fallbackId?.[1];
    return playlistId ? { source: "wy", playlistId } : null;
  }

  if (/\.qq\.com/i.test(text)) {
    // 分享短链（taoge.html）用 query 携带 id；网页版用路径携带
    const disstid = text.match(/[?&](?:id|disstid)=(\d+)/i);
    const pathId = text.match(/playlist\/([A-Za-z0-9]+)/i);
    if (disstid?.[1]) return { source: "tx", playlistId: disstid[1] };
    if (pathId?.[1]) return { source: "tx", playlistId: pathId[1] };
    return null;
  }

  const bare = text.match(/^(\d{4,})$/);
  return bare ? { source: "wy", playlistId: bare[1] } : null;
}
