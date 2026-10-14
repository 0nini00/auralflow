import { assertPublicOutboundUrl, parseLyricSource, type LyricLine, type MusicInfo } from "@lx/core";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";

/**
 * LRCLIB（https://lrclib.net）歌词直查：按「歌名 + 主歌手（+ 时长）」问纯歌词库。
 *
 * 为什么值得放在 wy/tx 搜索链之前：两平台都必须先搜歌再判身份，而本地曲经常只有
 * 歌名/歌手标签可用；LRCLIB 是只按标题 + 歌手 + 时长匹配的歌词库，命中即比「先搜后判」
 * 更准（桌面端同样先试它）。它不是必需品：请求失败/未命中一律静默降级到搜索链。
 */
const LRCLIB_ENDPOINT = "https://lrclib.net/api/get";
/** 第三方公共服务的等待上限；弱网时不能让歌词补全长期挂起。 */
const LRCLIB_TIMEOUT_MS = 8_000;
/** 桌面端同款 UA：LRCLIB 要求可识别的客户端标识，匿名默认 UA 容易被限流。 */
const LRCLIB_USER_AGENT = "AuralFlowMobile/0.1 (https://github.com/0nini00/auralflow)";
/** 歌词来源标注里代表 LRCLIB 的固定值（UI 需要显示「歌词来自 LRCLIB」）。 */
export const LRCLIB_ORIGIN_SOURCE = "lrclib";

export type LrclibLyricsResult =
  /** LRCLIB 的明确结论：这首歌本来就没有词（对齐桌面端：命中即不再搜索歌词）。 */
  | { kind: "instrumental" }
  /** 命中歌词：已按 LRC/enhanced-LRC 解析好时间轴。 */
  | { kind: "lyrics"; lines: LyricLine[] }
  /** 未命中或请求不可用：调用方继续走 wy/tx 搜索链。 */
  | null;

/**
 * 主歌手：本地标签常是「吴亦凡/Kris」这类别名串，而 LRCLIB 的 `artist_name` 只认单一署名
 * （实测整串 404、主歌手命中），所以按常见分隔符取第一段。NFKC 先把全角逗号等折叠成半角。
 */
export function primaryArtistName(singer: string): string {
  const parts = singer.normalize("NFKC")
    .split(/\s*(?:\/|、|,|;|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i)
    .map(part => part.trim())
    .filter(Boolean);
  return parts[0] ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseHit(body: unknown): LrclibLyricsResult {
  if (!isRecord(body)) return null;
  if (body.instrumental === true) return { kind: "instrumental" };
  // 同步歌词优先；只有纯文本时解析器给不出歌词行（没有时间轴），等价于未命中——与桌面端同序同语义。
  const raw = typeof body.syncedLyrics === "string" && body.syncedLyrics.trim()
    ? body.syncedLyrics
    : typeof body.plainLyrics === "string" && body.plainLyrics.trim() ? body.plainLyrics : "";
  if (!raw) return null;
  const lines = parseLyricSource({ type: "auto", content: raw });
  return lines.length ? { kind: "lyrics", lines } : null;
}

async function queryLrclib(params: URLSearchParams): Promise<LrclibLyricsResult> {
  const url = `${LRCLIB_ENDPOINT}?${params.toString()}`;
  // 所有出站地址统一校验：LRCLIB 是公网 https，但换个接口不能成为绕过内网拦截的后门。
  assertPublicOutboundUrl(url, "LRCLIB 歌词查询");
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/json", "User-Agent": LRCLIB_USER_AGENT },
  }, LRCLIB_TIMEOUT_MS);
  // 404 表示「没有这个标题 + 歌手 + 时长 的条目」，与请求失败一样按未命中处理。
  if (!response.ok) return null;
  return parseHit(await response.json());
}

export async function readLrclibLyrics(song: MusicInfo): Promise<LrclibLyricsResult> {
  const title = typeof song.name === "string" ? song.name.trim() : "";
  const singer = typeof song.singer === "string" ? song.singer : "";
  const artist = primaryArtistName(singer);
  // 歌名或歌手缺失时直查没有意义（空歌手必然 404），直接交给搜索链。
  if (!title || !artist) return null;
  try {
    // 第一次不带 duration：LRCLIB 的 duration 必须与条目精确到秒，本地标签的时长常有几秒偏差，
    // 带上不准的时长会直接 404（实测「吴亦凡 + Bad Girl + 错时长」404、不带时长命中）。
    const first = await queryLrclib(new URLSearchParams({ artist_name: artist, track_name: title }));
    if (first) return first;
    // miss 后再用完整署名 + 时长重试一次：平台条目可能署名带别名（「Kris」这种副名），
    // 时长一致还能顺带消掉同名不同曲的歧义。
    const params = new URLSearchParams({ artist_name: singer.trim() || artist, track_name: title });
    const interval = song.interval;
    if (typeof interval === "number" && Number.isFinite(interval) && interval > 0) {
      params.set("duration", String(Math.round(interval)));
    }
    return await queryLrclib(params);
  } catch {
    // 超时、限流、JSON 结构不符：全部静默降级到搜索链，歌词补全不能因此中断。
    return null;
  }
}
