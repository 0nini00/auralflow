import { fetch } from "@tauri-apps/plugin-http";
import { loadSettings } from "@lx/tauri-bridge";
import { weapi } from "@/lib/crypto/weapi";
import { createQrSvgDataUri } from "@/services/qrCode";
import {
  buildNeteasePcCookie,
  buildPlaylistSubscribeRequests,
  mapWySong,
  resolveWyPlaylistTracks,
} from "@/services/neteasePlaylistUtils";

export interface AccountInfo {
  uid: string;
  nickname: string;
  avatarUrl: string;
  vipType: number;
  isVip: boolean;
}

export interface WyPlaylistInfo {
  id: string;
  name: string;
  author: string;
  picUrl?: string;
  trackCount?: number;
  subscribed: boolean;
}

interface WyLoginSession {
  code?: unknown;
  account?: {
    id?: string | number;
    vipType?: number;
  };
  profile?: {
    userId?: string | number;
    nickname?: string;
    avatarUrl?: string;
    vipType?: number;
  };
}

interface WeapiRequestOptions {
  pcCookie?: boolean;
}

export interface WyQrLoginImage {
  key: string;
  qrUrl: string;
  qrImageUrl: string;
}

export interface WyQrLoginStatus {
  code: number;
  message: string;
  cookie?: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.54";

let cookie = "";

export function normalizeWyCookie(input: string): string {
  return input
    .replace(/^\s*cookie\s*:\s*/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^name\s+value\b/i.test(line))
    .map((line) => {
      const tabParts = line.split("\t").map((part) => part.trim());
      return tabParts.length >= 2 ? `${tabParts[0]}=${tabParts[1]}` : line;
    })
    .join("; ")
    .replace(/\bCookie\s*:\s*/gi, "")
    .replace(/;{2,}/g, ";")
    .replace(/\s*;\s*/g, "; ")
    .trim();
}

export function setWyCookie(c: string): string {
  cookie = normalizeWyCookie(c);
  return cookie;
}

export async function getWyCookie(): Promise<string> {
  if (cookie) return cookie;
  // 唯一持久化来源：Rust settings（由 SettingsView 通过 patchSettings 写入）
  try {
    const settings = await loadSettings();
    cookie = normalizeWyCookie(settings.wyCookie ?? "");
  } catch {
    // settings 文件可能尚不存在
  }
  return cookie;
}

function csrfToken(): string {
  const match = cookie.match(/(?:^|;\s*)__?csrf=([^;]+)/);
  return match?.[1] ?? "";
}

async function postWeapi(
  path: string,
  data: Record<string, unknown>,
  requestCookie: string,
  csrf = "",
): Promise<Record<string, any>> {
  const { params, encSecKey } = weapi({
    ...data,
    csrf_token: csrf,
  });

  const body = new URLSearchParams({ params, encSecKey }).toString();
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Origin": "https://music.163.com",
    "Referer": "https://music.163.com",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (requestCookie) headers.Cookie = requestCookie;

  const resp = await fetch(`https://music.163.com/weapi${path}`, {
    method: "POST",
    headers,
    body,
  });

  const text = await resp.text();
  if (!text.trim()) {
    throw new Error(`网易云返回空响应: ${path}; status=${resp.status} ${resp.statusText}`);
  }
  return JSON.parse(text) as Record<string, any>;
}

async function weapiCall(
  path: string,
  data: Record<string, unknown>,
  options: WeapiRequestOptions = {},
): Promise<Record<string, any>> {
  if (!cookie) throw new Error("未设置网易云 Cookie");
  if (!/MUSIC_U=/.test(cookie)) throw new Error("Cookie 中缺少 MUSIC_U，请复制已登录请求的 Cookie");
  const requestCookie = options.pcCookie ? buildNeteasePcCookie(cookie) : cookie;
  return postWeapi(path, data, requestCookie, csrfToken());
}

async function anonymousWeapiPost(path: string, data: Record<string, unknown>): Promise<Record<string, any>> {
  return postWeapi(path, data, "");
}

function withQrTimestamp(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ...data,
    timestamp: Date.now(),
  };
}

async function weapiPost(
  path: string,
  data: Record<string, unknown>,
  options?: WeapiRequestOptions,
): Promise<Record<string, any>> {
  const json = await weapiCall(path, data, options);
  if (json.code !== 200) {
    throw new Error(String(json.message || `API error code=${json.code}`));
  }
  return json;
}

function isAuthExpiredCode(code: unknown): boolean {
  return code === 301 || code === 401 || code === 403;
}

function getSessionUserId(session: WyLoginSession): string {
  return String(session.account?.id ?? session.profile?.userId ?? "");
}

function getQrMessage(code: number, fallback?: unknown): string {
  if (typeof fallback === "string" && fallback.trim()) return fallback;
  switch (code) {
    case 800:
      return "二维码已过期，点击刷新后重新扫码";
    case 801:
      return "请使用网易云音乐 App 扫码登录";
    case 802:
      return "已扫码，请在手机上确认登录";
    case 803:
      return "登录成功，正在同步账号";
    default:
      return `网易云扫码登录状态异常：${code}`;
  }
}

export async function createWyQrLoginKey(): Promise<string> {
  const body = await anonymousWeapiPost("/login/qrcode/unikey", withQrTimestamp({ type: 1 }));
  if (body.code !== 200) {
    throw new Error(String(body.message || `二维码 key 获取失败 code=${body.code}`));
  }

  const key = String(body.unikey ?? body.data?.unikey ?? "").trim();
  if (!key) throw new Error("网易云未返回二维码 key");
  return key;
}

export async function createWyQrLoginImage(): Promise<WyQrLoginImage> {
  const key = await createWyQrLoginKey();
  const qrUrl = `https://music.163.com/login?codekey=${encodeURIComponent(key)}`;
  return {
    key,
    qrUrl,
    qrImageUrl: createQrSvgDataUri(qrUrl),
  };
}

export async function checkWyQrLogin(key: string): Promise<WyQrLoginStatus> {
  const body = await anonymousWeapiPost("/login/qrcode/client/login", withQrTimestamp({
    key,
    type: 1,
  }));
  const code = Number(body.code ?? 0);
  const rawCookie = typeof body.cookie === "string" ? body.cookie : "";
  const normalized = rawCookie ? normalizeWyCookie(rawCookie) : "";
  return {
    code,
    message: getQrMessage(code, body.message),
    cookie: code === 803 && normalized ? normalized : undefined,
  };
}

export function assertMatchingWyLoginSession(
  loginStatus: WyLoginSession,
  accountSession: WyLoginSession,
): void {
  if (isAuthExpiredCode(loginStatus.code) || isAuthExpiredCode(accountSession.code)) {
    throw new Error("网易云登录已过期，请重新填写 Cookie");
  }

  const loginUserId = getSessionUserId(loginStatus);
  const accountUserId = getSessionUserId(accountSession);
  if (!loginUserId || !accountUserId) {
    throw new Error("Cookie 已过期或无效");
  }
  if (loginUserId !== accountUserId) {
    throw new Error("网易云登录状态与账号信息不一致，请重新登录");
  }
}

export async function checkAccount(): Promise<AccountInfo> {
  const loginStatus = await weapiPost("/w/nuser/account/get", {});
  const body = await weapiPost("/nuser/account/get", {});
  assertMatchingWyLoginSession(loginStatus, body);

  const account = body.account;
  if (!account) throw new Error("Cookie 已过期或无效");

  const profile = body.profile ?? {};
  const vipType = Number(account.vipType ?? profile.vipType ?? 0);

  return {
    uid: String(account.id ?? profile.userId ?? ""),
    nickname: String(profile.nickname ?? ""),
    avatarUrl: String(profile.avatarUrl ?? ""),
    vipType,
    isVip: vipType > 0,
  };
}

export async function getUserPlaylists(uid: string): Promise<WyPlaylistInfo[]> {
  const body = await weapiPost("/user/playlist", {
    uid,
    limit: 1000,
    offset: 0,
    includeVideo: true,
  });

  return ((body.playlist as any[]) ?? []).map((item) => ({
    id: String(item.id),
    name: String(item.name ?? ""),
    author: String(item.creator?.nickname ?? ""),
    picUrl: item.coverImgUrl,
    trackCount: item.trackCount,
    subscribed: !!item.subscribed,
  }));
}

export async function getPlaylistDetail(id: string) {
  const body = await weapiPost("/v3/playlist/detail", {
    id: Number(id),
    n: 100000,
    s: 8,
  });

  const playlist = body.playlist ?? {};
  const tracks = await resolveWyPlaylistTracks(playlist, getSongDetails);
  return tracks.map(mapWySong);
}

async function getSongDetails(ids: number[]) {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 500) {
    chunks.push(ids.slice(i, i + 500));
  }

  const songs = await Promise.all(chunks.map(async (chunk) => {
    const body = await weapiPost("/v3/song/detail", {
      c: JSON.stringify(chunk.map((id) => ({ id }))),
      ids: JSON.stringify(chunk),
    });
    const rawSongs = (body.songs as any[]) ?? [];
    const privileges = new Map(
      ((body.privileges as any[]) ?? []).map((item) => [Number(item.id), item])
    );

    return rawSongs.map((song) => ({
      ...song,
      privilege: privileges.get(Number(song.id)) ?? song.privilege,
    }));
  }));

  return songs.flat();
}

// ─── 歌单写操作 ────────────────────────────────────────────────

async function manipulatePlaylistTracks(
  op: "add" | "del",
  playlistId: string,
  trackIds: string[],
): Promise<void> {
  const ids = trackIds.map((id) => String(id)).filter(Boolean);
  if (!ids.length) throw new Error("缺少网易云歌曲 ID");

  const buildData = (targetIds: string[]) => ({
    op,
    pid: String(playlistId),
    trackIds: JSON.stringify(targetIds),
    imme: "true",
  });

  let res = await weapiCall("/playlist/manipulate/tracks", buildData(ids));
  // 网易云对重复添加返回 code=512，重试时把 trackIds 翻倍 — 与 desktop 行为一致
  if (op === "add" && res.code === 512) {
    res = await weapiCall("/playlist/manipulate/tracks", buildData([...ids, ...ids]));
  }
  if (res.code !== 200 && res.code !== 201) {
    throw new Error(String(res.message || "网易云歌单歌曲操作失败"));
  }
}

export async function addPlaylistTracks(playlistId: string, trackIds: string[]): Promise<void> {
  await manipulatePlaylistTracks("add", playlistId, trackIds);
}

export async function removePlaylistTracks(playlistId: string, trackIds: string[]): Promise<void> {
  await manipulatePlaylistTracks("del", playlistId, trackIds);
}

export async function subscribePlaylist(playlistId: string, isSub: boolean): Promise<void> {
  const errors: string[] = [];
  for (const request of buildPlaylistSubscribeRequests(playlistId, isSub)) {
    try {
      await weapiPost(request.path, request.payload, { pcCookie: request.pcCookie });
      return;
    } catch (error) {
      errors.push(`${request.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join("\n") || "网易云歌单收藏失败");
}

/** 仅取网易云歌曲的 songId；非 wy 来源返回 null */
export function getWyTrackId(song: { source: string; id: string }): string | null {
  if (song.source !== "wy") return null;
  return song.id ? String(song.id) : null;
}

// ─── 每日推荐 / 私人 FM ────────────────────────────────────────

/** 每日歌曲推荐（需登录 Cookie） */
export async function getDailyRecommend() {
  const body = await weapiPost("/v3/discovery/recommend/songs", {});
  const tracks = (body.data?.dailySongs as any[]) ?? [];
  return tracks.map(mapWySong);
}

/** 私人 FM 拉取下一批（默认每次返回 3-5 首） */
export async function getPersonalFm() {
  const body = await weapiPost("/v1/radio/get", {});
  const tracks = (body.data as any[]) ?? [];
  return tracks.map(mapWySong);
}

// ─── 歌手 / 专辑 ────────────────────────────────────────────────

/** 歌手详情：头像、简介、别名等 */
export async function getArtistDetail(id: string) {
  const body = await weapiPost("/artist/head/info/get", { id });
  const data = body.data ?? {};
  const artist = data.artist ?? {};
  return {
    id: String(artist.id ?? id),
    name: String(artist.name ?? ""),
    picUrl: String(artist.cover ?? artist.picUrl ?? artist.avatar ?? ""),
    alias: (artist.alias ?? []) as string[],
    briefDesc: String(artist.briefDesc ?? ""),
    musicSize: Number(artist.musicSize ?? 0),
    albumSize: Number(artist.albumSize ?? 0),
  };
}

/** 歌手热门歌曲（默认 hot 顺序，最多 100 首） */
export async function getArtistSongs(
  id: string,
  options: { order?: "hot" | "time"; limit?: number; offset?: number } = {},
) {
  const body = await weapiPost("/v1/artist/songs", {
    id,
    private_cloud: "true",
    work_type: 1,
    order: options.order ?? "hot",
    offset: options.offset ?? 0,
    limit: options.limit ?? 100,
  });
  const songs = (body.songs as any[]) ?? [];
  return {
    songs: songs.map(mapWySong),
    total: Number(body.total ?? songs.length),
    hasMore: Boolean(body.more),
  };
}

/** 歌手专辑列表 */
export async function getArtistAlbums(
  id: string,
  options: { limit?: number; offset?: number } = {},
) {
  // 这个接口路径里带 id（mobile 实现一致）
  const body = await weapiPost(`/artist/albums/${id}`, {
    limit: options.limit ?? 100,
    offset: options.offset ?? 0,
    total: true,
  });
  const hot = (body.hotAlbums as any[]) ?? [];
  return {
    albums: hot.map((album) => ({
      id: String(album.id),
      name: String(album.name ?? ""),
      picUrl: String(album.picUrl ?? album.blurPicUrl ?? ""),
      artist: String(album.artist?.name ?? ""),
      artistId: String(album.artist?.id ?? id),
      publishTime: Number(album.publishTime ?? 0),
      trackCount: Number(album.size ?? 0),
      source: "wy" as const,
    })),
    hasMore: Boolean(body.more),
  };
}

/** 专辑详情 + 曲目列表 */
export async function getAlbumDetail(albumId: string) {
  const body = await weapiPost(`/v1/album/${albumId}`, {});
  const album = body.album ?? {};
  const songs = (body.songs as any[]) ?? [];
  return {
    info: {
      id: String(album.id ?? albumId),
      name: String(album.name ?? ""),
      picUrl: String(album.picUrl ?? album.blurPicUrl ?? ""),
      artist: String(album.artist?.name ?? album.artists?.[0]?.name ?? ""),
      artistId: String(album.artist?.id ?? album.artists?.[0]?.id ?? ""),
      publishTime: Number(album.publishTime ?? 0),
      trackCount: Number(album.size ?? songs.length),
      description: String(album.description ?? ""),
      source: "wy" as const,
    },
    songs: songs.map(mapWySong),
  };
}

/** 私人 FM 反馈：喜欢 / 不感兴趣 / 已听完 */
export async function fmTrash(trackId: string): Promise<void> {
  await weapiPost("/radio/trash/add", {
    songId: String(trackId),
    alg: "RT",
    time: 25,
  });
}

// ─── 听歌打卡（Scrobble） ───────────────────────────────────────

/**
 * 网易云听歌打卡：上报一次播放记录，用于"听歌排行"统计。
 * 触发条件由调用方决定（通常为累计播放 ≥120s 或 ≥时长一半）。
 *
 * @param songId   网易云歌曲 id
 * @param sourceId 来源歌单/专辑 id；没有上下文时传空串
 * @param playedTime 已播放秒数
 */
export async function scrobble(
  songId: string,
  sourceId: string,
  playedTime: number,
): Promise<void> {
  const logs = JSON.stringify([
    {
      action: "play",
      json: {
        id: String(songId),
        download: 0,
        type: "song",
        sourceId: String(sourceId ?? ""),
        time: Math.floor(playedTime),
        end: "playend",
        wifi: 0,
      },
    },
  ]);
  await weapiPost("/feedback/weblog", { logs });
}
