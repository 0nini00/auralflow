import type { MusicInfo } from "./sources";
import type { BuiltinMusicApiClient } from "./mobile-api";

/**
 * ChKSz 音乐 API 客户端（https://api.chksz.com）。
 *
 * 定位：与内置音乐 API 网关（gdstudio）同接口的备选/竞速网关。
 * 相比 gdstudio：
 *   - 网易云（wy）支持播放 /api/163_music、搜索 /api/163_search、
 *     歌词 /api/163_lyric、歌单 /api/163_playlist；
 *   - QQ 音乐（tx）支持点歌 /api/qq_music（msg 搜索 / mid 直接解析）——
 *     可补上 gdstudio joox 源失效导致的 QQ 播放缺口；
 *   - 鉴权：所有接口都要求查询参数 apikey（登录 api.chksz.com 后获取）。
 *
 * 通过惰性 getter 注入 apikey：设置页保存后无需重启 App，下次请求即生效；
 * 返回空字符串时本网关跳过（不参与竞速）。
 */

export const CHKSZ_API_BASE = "https://api.chksz.com";

/** 网易云 level → ChKSz 音质等级（对齐网易云官方 level 命名）。 */
function chkszWyLevel(quality?: string): string {
  switch (quality) {
    case "128k":
      return "standard";
    case "192k":
      return "exhigh";
    case "flac":
      return "lossless";
    case "flac24bit":
      return "hires";
    case "320k":
    default:
      return "exhigh";
  }
}

/** QQ 音乐 size → ChKSz 音质（原生音质，服务端不做别名映射）。 */
function chkszTxSize(quality?: string): string {
  switch (quality) {
    case "128k":
      return "128k";
    case "320k":
      return "320k";
    case "flac":
      return "flac";
    case "flac24bit":
      return "hires";
    default:
      return "320k";
  }
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function joinArtists(value: unknown): string {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean).join("、");
  return asString(value);
}

/** 网关用的 gateway 字段：优先取 music.gateway，无则按来源回退。 */
function getGateway(music: MusicInfo): { source: string; id: string } | null {
  const gw = music.gateway;
  if (gw?.source && gw.trackId) return { source: gw.source, id: gw.trackId };
  if (music.source === "wy" && music.id) return { source: "netease", id: music.id };
  if (music.source === "tx" && music.id) return { source: "qq", id: music.id };
  return null;
}

/** 解析内置网关 source 到 ChKSz 平台维度。 */
function normalizePlatform(source: string): "netease" | "qq" | "kugou" {
  if (source === "netease" || source === "wy") return "netease";
  if (source === "joox" || source === "qq" || source === "tx") return "qq";
  return "netease";
}

/**
 * 创建 ChKSz 音乐 API 客户端。
 * @param fetchText 已带超时的文本请求函数
 * @param getApiKey 惰性读取 apikey（空串 → 本网关不可用）
 */
export function createChkszMusicApiClient(
  fetchText: (url: string) => Promise<string>,
  getApiKey: () => string,
): BuiltinMusicApiClient {
  const buildUrl = (path: string, params: Record<string, string | number | undefined>): string => {
    const url = new URL(`${CHKSZ_API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
    return url.toString();
  };

  const fetchWithKey = async (path: string, params: Record<string, string | number | undefined>): Promise<any> => {
    const apiKey = getApiKey();
    if (!apiKey.trim()) throw new Error("未配置 ChKSz API Key，跳过该网关");
    const text = await fetchText(buildUrl(path, { ...params, apikey: apiKey.trim() }));
    const json = JSON.parse(text);
    if (json?.code != null && json.code !== 200) {
      throw new Error(`ChKSz API 错误 ${json.code}: ${json.msg ?? json.message ?? ""}`);
    }
    return json;
  };

  /** 网易云搜索 → 标准 MusicInfo（带 gateway 供后续播放/歌词）。 */
  const mapNeteaseSearchItem = (item: unknown): MusicInfo | null => {
    const raw = item as Record<string, unknown> | null;
    if (!raw) return null;
    const id = asString(raw.id).trim();
    const name = asString(raw.name).trim();
    if (!id || !name) return null;
    const picUrl = asString(raw.picUrl).trim() || undefined;
    return {
      id,
      name,
      singer: joinArtists(raw.artists ?? raw.artist),
      albumName: asString(raw.album),
      source: "wy",
      quality: "320k",
      picUrl,
      img: picUrl,
      gateway: { source: "netease", trackId: id, lyricId: id, picId: id },
    };
  };

  return {
    async searchSongs(source, keyword, page, limit, displaySource) {
      const platform = source === "netease" ? "netease" : "qq";
      if (platform === "netease") {
        const offset = (page - 1) * limit;
        const json = await fetchWithKey("/api/163_search", {
          keyword,
          limit,
          offset,
        });
        const list: unknown[] = Array.isArray(json.data) ? json.data : [];
        return list
          .map(mapNeteaseSearchItem)
          .filter((item): item is MusicInfo => item != null);
      }
      // QQ 音乐点歌：msg 搜索，取前 limit 条
      const json = await fetchWithKey("/api/qq_music", {
        msg: keyword,
        num: Math.min(limit, 50),
        type: "json",
      });
      const list: unknown[] = Array.isArray(json.list) ? json.list : [];
      return list
        .map((item: unknown) => {
          const raw = item as Record<string, unknown> | null;
          if (!raw) return null;
          const mid = asString(raw.mid).trim();
          const name = asString(raw.name).trim();
          if (!mid || !name) return null;
          return {
            id: mid,
            name,
            singer: joinArtists(raw.singer),
            albumName: asString(raw.album),
            source: displaySource,
            quality: "320k",
            gateway: { source: "qq", trackId: mid, lyricId: mid, picId: mid },
          } as MusicInfo;
        })
        .filter((item: MusicInfo | null): item is MusicInfo => item != null);
    },

    async resolveUrl(music, quality) {
      const gateway = getGateway(music);
      if (!gateway) throw new Error("该歌曲没有内置音乐 API 解析信息");
      const platform = normalizePlatform(gateway.source);

      if (platform === "netease") {
        const json = await fetchWithKey("/api/163_music", {
          id: gateway.id,
          level: chkszWyLevel(quality),
          type: "json",
        });
        const data = (json?.data ?? {}) as Record<string, unknown>;
        const url = asString(data.url).trim();
        if (!url) throw new Error("ChKSz 未返回可播放 URL");
        return { url, quality: String(data.level ?? quality ?? "") };
      }

      // QQ：按 mid 直接解析
      const json = await fetchWithKey("/api/qq_music", {
        mid: gateway.id,
        size: chkszTxSize(quality),
        type: "json",
      });
      const url = asString(json?.url).trim();
      if (!url) throw new Error("ChKSz 未返回可播放 URL");
      return { url, quality: String(json?.bitrate ?? quality ?? "") };
    },

    async getLyric(music) {
      const gateway = getGateway(music);
      if (!gateway) return {};
      const platform = normalizePlatform(gateway.source);

      if (platform === "netease") {
        const json = await fetchWithKey("/api/163_lyric", { id: gateway.id });
        const data = (json?.data ?? {}) as Record<string, unknown>;
        return {
          lyric: typeof data.lrc === "string" ? data.lrc : undefined,
          tlyric: typeof data.tlyric === "string" ? data.tlyric : undefined,
        };
      }
      // QQ：mid 解析响应直接带 lrc
      const json = await fetchWithKey("/api/qq_music", { mid: gateway.id, type: "json" });
      return {
        lyric: typeof json?.lrc === "string" ? json.lrc : undefined,
        tlyric: undefined,
      };
    },
  };
}
