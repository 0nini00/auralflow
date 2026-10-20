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

async function getJson(path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${WY_API_BASE}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": WY_UA,
      },
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

/** 发现页「推荐歌单」：公开热门歌单，与移动端首页同一口径（不读 Cookie）。 */
export async function fetchWyRecommendedPlaylists(limit = 12): Promise<PlaylistInfo[]> {
  const page = await fetchWyPlaylistsByCategory("全部", "hot", limit, 0);
  return page.playlists;
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
