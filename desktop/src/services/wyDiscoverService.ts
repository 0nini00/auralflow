/**
 * 网易云「公开发现」接口：排行榜清单、歌单广场分类列表、推荐歌单。
 *
 * 这三件事的共同点是**不需要登录，也不该带 Cookie**。桌面端既有的
 * `wyAccountService` 是账号层的 weapi（处处依赖 Cookie 与 csrf），把它拉来做公开
 * 列表会把「未登录就什么都没有」写进发现页——而发现页恰恰是没登录时最该有内容的
 * 一页。所以这里单独一层：同一批 `/api/*` 公开端点、同一个 tauri-plugin-http
 * 通道（浏览器 fetch 会被 CORS 挡住，也不能绕过 WebView2 的证书校验），不带任何
 * 账号信息。
 *
 * 榜单清单本身在 `@lx/core`（移动端与桌面端共用一份）。这里只负责把接口响应
 * 交给 core 的 `mapLeaderboardBoards` 归一化。
 */
import { fetch } from "@tauri-apps/plugin-http";
import {
  mapLeaderboardBoards,
  type PlaylistInfo,
  type WyLeaderboardBoard,
  type WyPlaylistOrder,
} from "@lx/core";
import { mapWyPlaylist } from "./neteasePlaylistUtils";

const WY_API_BASE = "https://music.163.com";
/** 与 wyProvider 保持一致的桌面 UA：音乐-related 端点对移动 UA 会返回不同的字段集。 */
const WY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.54";
/** 公开列表接口是发现页首屏的一部分，超时必须短：卡住比失败更糟。 */
const REQUEST_TIMEOUT_MS = 12_000;
/** 单页上限按接口实测；超过 50 以后服务端会自行截断，传大没有意义。 */
const MAX_PAGE_SIZE = 50;

export class WyDiscoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WyDiscoverError";
  }
}

function clampLimit(limit: number, fallback: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
}

function clampOffset(offset: number): number {
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

async function getJson(path: string, cookie?: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": WY_UA,
  };
  // 只有「登录态个性化推荐」需要 Cookie；公开列表一律不带（见文件头注释）。
  const trimmedCookie = cookie?.trim();
  if (trimmedCookie) headers.Cookie = trimmedCookie;
  let response: Response;
  try {
    response = await fetch(`${WY_API_BASE}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WyDiscoverError(`网易云请求失败：${message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new WyDiscoverError(`网易云请求失败（HTTP ${response.status}）`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new WyDiscoverError("网易云返回了无效 JSON");
  }
  if (data == null || typeof data !== "object") {
    throw new WyDiscoverError("网易云返回体不是对象");
  }
  const record = data as Record<string, unknown>;
  if (record.code != null && Number(record.code) !== 200) {
    throw new WyDiscoverError(`网易云接口错误 code=${String(record.code)}`);
  }
  return record;
}

export interface WyPlaylistPage {
  playlists: PlaylistInfo[];
  /**
   * 是否还有下一页。按**接口返回的原始条数**判断而不是映射后条数：
   * 映射层将来若过滤掉脏数据，用映射后的长度会让分页提前停机、漏掉整页歌单。
   */
  hasMore: boolean;
}

/**
 * 按分类拉歌单（歌单广场）。`order=hot` 稳定、`order=new` 会随时间变化。
 * 失败直接抛错：这是用户主动筛选的列表，安静返回空会让人以为「这个分类没歌单」。
 */
export async function fetchWyPlaylistsByCategory(
  cat: string,
  order: WyPlaylistOrder,
  limit = 24,
  offset = 0,
): Promise<WyPlaylistPage> {
  const size = clampLimit(limit, 24);
  const params = new URLSearchParams({
    cat,
    order,
    limit: String(size),
    offset: String(clampOffset(offset)),
  });
  const data = await getJson(`/api/playlist/list?${params.toString()}`);
  if (!Array.isArray(data.playlists)) {
    throw new WyDiscoverError("网易云歌单列表字段缺失");
  }
  const raw = data.playlists;
  const playlists = raw.map((item) => mapWyPlaylist(item)).filter((item) => item.id.length > 0);
  return { playlists, hasMore: raw.length >= size };
}

/** 推荐歌单「每日一版」的候选分类：越多分类，轮换一轮需要的天数越久。 */
export const RECOMMENDED_POOL_CATEGORIES = ["全部", "华语", "流行", "电子", "民谣", "摇滚"] as const;

/**
 * 推荐歌单候选池。
 *
 * 为什么不直接取热门前 12 条（旧实现）：那个列表几天都不变，无论怎么刷新都是同一批。
 * 这里按分类各取一页、再给「全部」多取一页，去重后得到上百条候选，轮换才有意义。
 *
 * 单个分类失败不拖垮整池（`catch` 成 null），只有全部失败才算失败——发现页首屏
 * 不该因为某个冷门分类抽风就空掉。
 */
export async function fetchWyRecommendedPlaylistPool(pageSize = 24): Promise<PlaylistInfo[]> {
  const size = clampLimit(pageSize, 24);
  const requests = RECOMMENDED_POOL_CATEGORIES.flatMap((category, index) => {
    const offsets = index === 0 ? [0, size] : [0];
    return offsets.map((offset) =>
      fetchWyPlaylistsByCategory(category, "hot", size, offset).catch(() => null),
    );
  });
  const pages = await Promise.all(requests);

  const seen = new Set<string>();
  const pool: PlaylistInfo[] = [];
  for (const page of pages) {
    for (const playlist of page?.playlists ?? []) {
      const id = String(playlist.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      pool.push(playlist);
    }
  }
  if (pool.length === 0) throw new WyDiscoverError("推荐歌单候选池为空");
  return pool;
}

/**
 * 登录态个性化推荐（`/api/v1/discovery/recommend/resource`，与移动端同一端点）。
 *
 * 它本身一天只变一次，是「每天不一样」的天花板；未登录或失败时调用方回退公开池。
 */
export async function fetchWyPersonalizedRecommendedPlaylists(
  cookie: string,
  limit = 12,
): Promise<PlaylistInfo[]> {
  const trimmed = cookie.trim();
  if (!trimmed) throw new WyDiscoverError("网易云个性化推荐需要登录");
  const data = await getJson("/api/v1/discovery/recommend/resource", trimmed);
  const raw = Array.isArray(data.recommend) ? data.recommend : [];
  const playlists = raw.map((item) => mapWyPlaylist(item)).filter((item) => item.id.length > 0);
  if (playlists.length === 0) throw new WyDiscoverError("个性化推荐返回空列表");
  return playlists.slice(0, clampLimit(limit, 12));
}

export interface WyLeaderboardResult {
  boards: WyLeaderboardBoard[];
  /**
   * true 表示 `/api/toplist` 失败，返回的是内置清单（没有封面、更新频率与 TOP3）。
   * 页面据此给一句「内容仍可打开」的说明，而不是默默地展示一堆占位色块。
   */
  degraded: boolean;
}

/**
 * 榜单清单：内置清单打底，接口只补封面 / 更新频率 / TOP3。
 *
 * 这里**不吞错**——降级路径是有意义的返回值（`degraded: true`），排行榜页要能
 * 把这个状态说出来；但页面本身照旧可用，因为每个榜单的 id 都来自内置清单。
 */
export async function fetchWyLeaderboardBoards(): Promise<WyLeaderboardResult> {
  try {
    const data = await getJson("/api/toplist");
    return { boards: mapLeaderboardBoards(data.list), degraded: false };
  } catch {
    return { boards: mapLeaderboardBoards(undefined), degraded: true };
  }
}
