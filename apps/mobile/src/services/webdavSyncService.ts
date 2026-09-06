import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MusicInfo } from "@lx/core";
import { usePlaylistStore } from "../stores/playlistStore";
import { useFavoritesStore } from "../stores/favoritesStore";
import type { WyPlaylistInfo } from "./wyPlaylistService";
import type { LocalPlaylist } from "./localPlaylistModel";
import { useHistoryStore } from "../stores/historyStore";
import type { HistoryEntry } from "./historyGroupModel";
import { useCustomSourceStore, type CustomSourceItem } from "../stores/customSourceStore";
import { parseDesktopUserApiInfo } from "./customSourceRuntime";
import { atobSafe, btoaSafe } from "../utils/base64";
import { inflateBytes } from "../utils/compression";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import { getSecureItem, removeSecureItem, setSecureItem } from "@/services/secureStorageService";
import { migrateLegacySecret } from "@/services/secureStorageMigrationModel";
import { assertHttpsWebdavUrl } from "@/services/webdavUrlModel";

/**
 * 移动端 WebDAV 同步服务。
 *
 * 与桌面端 src/services/webdavSyncService.ts 对应，使用原生 fetch 实现
 * WebDAV 操作（PROPFIND / MKCOL / GET / PUT / DELETE），配置持久化到
 * AsyncStorage，同步格式兼容 LX Music（loveList / userList / defaultList /
 * playHistory）。
 */

const CONFIG_KEY = "auralflow.mobile.webdavConfig";
const SECURE_PASSWORD_KEY = "auralflow.mobile.webdav.password.v1";
const PROBE_FILE = "auralflow-probe.txt";
const USER_APIS_FILE = "user_apis.json";
const PLAYLISTS_FILE = "playlists.json";
const REMOTE_ROOT_PATH = "/AuralFlow/";
/** 旧版远程根路径（lx-music 沿袭）。仅用于下载回读迁移：新路径 404 时
 * 回退读旧路径，避免老用户升级后云端数据“消失”。上传一律写新路径。 */
const LEGACY_REMOTE_ROOT_PATH = "/LX_Music/";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface WebdavConfig {
  url: string;
  username: string;
  password: string;
  autoSyncPlaylists: boolean;
}

interface UserApiInfo {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  author?: unknown;
  homepage?: unknown;
  version?: unknown;
  allowShowUpdateAlert?: unknown;
  script?: unknown;
}

type UserApisSyncData =
  | UserApiInfo[]
  | {
      list?: UserApiInfo[];
      scripts?: Record<string, string>;
    };

interface UserApisSyncFile {
  version?: string;
  lastModified?: number;
  data?: UserApisSyncData;
}

interface RemotePlaylistItem {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  desc?: unknown;
  cover?: unknown;
  picUrl?: unknown;
  img?: unknown;
  list?: unknown;
  songs?: unknown;
  source?: unknown;
  author?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface PlaylistsSyncFile {
  version: "2" | "3";
  lastModified: number;
  data: {
    defaultList: MusicInfo[];
    loveList: MusicInfo[];
    userList: Array<Record<string, unknown> & { list: MusicInfo[] }>;
  };
  playHistory: PlayHistorySyncItem[];
}

interface PlayHistorySyncItem {
  id: string;
  musicInfo: MusicInfo;
  playedAt: number;
  playTime: number;
  maxTime: number;
  listId: string | null;
  source: "Search" | "Rec" | "Detail" | "List";
}

type WebdavRequestInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
};

// ---------------------------------------------------------------------------
// 串行锁（对齐桌面端 withSyncLock）：防止双击/并发操作竞争 PUT/GET。
// ---------------------------------------------------------------------------

let syncInFlight: Promise<unknown> | null = null;

async function withSyncLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (syncInFlight) {
    throw new Error(`WebDAV 正在同步中（${label}），请稍后再试`);
  }
  const run = (async () => fn())();
  syncInFlight = run;
  try {
    return await run;
  } finally {
    if (syncInFlight === run) syncInFlight = null;
  }
}

// ---------------------------------------------------------------------------
// 配置管理
// ---------------------------------------------------------------------------

export async function loadWebdavConfig(): Promise<WebdavConfig> {
  const raw = await AsyncStorage.getItem(CONFIG_KEY);
  let parsed: Partial<WebdavConfig> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Partial<WebdavConfig>;
    } catch {
      parsed = {};
    }
  }

  const legacyPassword = typeof parsed.password === "string" ? parsed.password : "";
  const password = await migrateLegacySecret({
    readSecure: () => getSecureItem(SECURE_PASSWORD_KEY),
    readLegacy: async () => legacyPassword || null,
    writeSecure: (value) => setSecureItem(SECURE_PASSWORD_KEY, value),
    removeLegacy: () => AsyncStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({
        url: parsed.url ?? "",
        username: parsed.username ?? "",
        autoSyncPlaylists: parsed.autoSyncPlaylists ?? false,
      }),
    ),
  });

  return {
    url: parsed.url ?? "",
    username: parsed.username ?? "",
    password: password ?? "",
    autoSyncPlaylists: parsed.autoSyncPlaylists ?? false,
  };
}

export async function saveWebdavConfig(cfg: WebdavConfig): Promise<void> {
  if (cfg.password) {
    await setSecureItem(SECURE_PASSWORD_KEY, cfg.password);
  } else {
    await removeSecureItem(SECURE_PASSWORD_KEY);
  }
  await AsyncStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({
      url: cfg.url,
      username: cfg.username,
      autoSyncPlaylists: cfg.autoSyncPlaylists,
    }),
  );
}

async function getConfig(): Promise<WebdavConfig | null> {
  const cfg = await loadWebdavConfig();
  const url = cfg.url.trim().replace(/\/+$/, "");
  if (!url) return null;
  return {
    url,
    username: cfg.username,
    password: cfg.password,
    autoSyncPlaylists: cfg.autoSyncPlaylists,
  };
}

// ---------------------------------------------------------------------------
// Base64 编码（复用 utils/base64 的 btoaSafe，兼容 RN Hermes）
// ---------------------------------------------------------------------------

function authHeader(cfg: WebdavConfig): string {
  return `Basic ${btoaSafe(`${cfg.username}:${cfg.password}`)}`;
}

// ---------------------------------------------------------------------------
// 路径工具
// ---------------------------------------------------------------------------

function normalizeRemotePath(path: string): string {
  let targetPath = (path || "/").trim().replace(/\\/g, "/");
  if (!targetPath.startsWith("/")) targetPath = `/${targetPath}`;
  return targetPath.replace(/\/+/g, "/");
}

function joinRemotePath(...paths: string[]): string {
  return normalizeRemotePath(paths.join("/"));
}

function buildUrl(cfg: WebdavConfig, path: string): string {
  const encodedPath = normalizeRemotePath(path)
    .split("/")
    .map((part, index) => (index === 0 ? "" : encodeURIComponent(part)))
    .join("/");
  return `${cfg.url}${encodedPath}`;
}

function probePath(): string {
  return joinRemotePath(REMOTE_ROOT_PATH, PROBE_FILE);
}

function userApisPath(root: string = REMOTE_ROOT_PATH): string {
  return joinRemotePath(root, USER_APIS_FILE);
}

function playlistsPath(root: string = REMOTE_ROOT_PATH): string {
  return joinRemotePath(root, PLAYLISTS_FILE);
}

// ---------------------------------------------------------------------------
// 错误格式化
// ---------------------------------------------------------------------------

function formatWriteFailure(action: string, status: number, statusText: string): string {
  if (status === 401 || status === 403) {
    return `${action}失败：WebDAV 认证失败或目录没有写入权限。请确认用户名、应用密码正确，并且该目录已授权可写。`;
  }
  if (status === 404 || status === 409) {
    return `${action}失败：WebDAV 服务地址不可用或远端目录无法创建。请确认服务地址正确，例如坚果云 https://dav.jianguoyun.com/dav/。`;
  }
  return `${action}失败：HTTP ${status} ${statusText}`;
}

// ---------------------------------------------------------------------------
// 同步保护：本地 lastModified 标记 + 云端过旧拦截 + 下载前备份
// ---------------------------------------------------------------------------

const META_PREFIX = "auralflow.mobile.webdavMeta:";
const BACKUP_PREFIX = "auralflow.mobile.webdavBackup:";

type SyncKind = "sources" | "playlists";

interface LocalSyncMeta {
  lastModified: number;
  itemCount: number;
}

async function readLocalMeta(kind: SyncKind): Promise<LocalSyncMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_PREFIX + kind);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSyncMeta;
    if (typeof parsed?.lastModified !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeLocalMeta(kind: SyncKind, meta: LocalSyncMeta): Promise<void> {
  try {
    await AsyncStorage.setItem(META_PREFIX + kind, JSON.stringify(meta));
  } catch (error) {
    console.warn(`保存 WebDAV ${kind} 元数据失败`, error);
  }
}

async function writeLocalBackup(kind: SyncKind, payload: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(
      BACKUP_PREFIX + kind,
      JSON.stringify({ savedAt: Date.now(), payload }),
    );
  } catch (error) {
    console.warn(`保存 WebDAV ${kind} 本地备份失败`, error);
  }
}

/** 阻止用较旧的云端数据静默覆盖较新的本地数据。 */
async function assertCloudNotStale(
  kind: SyncKind,
  remoteText: string,
  localItemCount: number,
  force?: boolean,
): Promise<void> {
  if (force) return;
  if (localItemCount <= 0) return;
  let remoteLm: number | null = null;
  try {
    const parsed = JSON.parse(remoteText) as { lastModified?: unknown };
    const n = Number(parsed?.lastModified);
    remoteLm = Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return;
  }
  const localMeta = await readLocalMeta(kind);
  if (remoteLm == null || localMeta == null) return;
  if (remoteLm + 1000 < localMeta.lastModified) {
    const remoteAt = new Date(remoteLm).toLocaleString();
    const localAt = new Date(localMeta.lastModified).toLocaleString();
    throw new Error(
      `云端数据较旧（云端 ${remoteAt}，本地标记 ${localAt}）。` +
        `继续下载将把云端较旧数据合并/覆盖到本地约 ${localItemCount} 项。若确认以云端为准，请强制下载。`,
    );
  }
}

// ---------------------------------------------------------------------------
// WebDAV 请求
// ---------------------------------------------------------------------------

async function webdavRequest(cfg: WebdavConfig, path: string, init: WebdavRequestInit): Promise<Response> {
  const url = buildUrl(cfg, path);
  // Basic 认证包含用户凭据，WebDAV 仅允许 HTTPS，并继续执行公共出站地址校验。
  assertHttpsWebdavUrl(url);
  return fetchWithTimeout(url, {
    method: init.method,
    headers: {
      Authorization: authHeader(cfg),
      ...(init.headers ?? {}),
    },
    body: init.body,
  });
}

async function readWebdavText(cfg: WebdavConfig, path: string): Promise<string | null> {
  const resp = await webdavRequest(cfg, path, { method: "GET" });
  if (resp.status === 404 || resp.status === 409) return null;
  if (!resp.ok) {
    throw new Error(`下载失败: HTTP ${resp.status} ${resp.statusText}`);
  }
  const text = await resp.text();
  return text.trim() ? text : null;
}

async function remotePathExists(cfg: WebdavConfig, path: string): Promise<boolean> {
  const resp = await webdavRequest(cfg, path, {
    method: "PROPFIND",
    headers: { Depth: "0" },
  });
  if (resp.ok) return true;
  if (resp.status === 404 || resp.status === 409) return false;
  throw new Error(formatWriteFailure("检查", resp.status, resp.statusText));
}

async function ensureRemoteDirectory(cfg: WebdavConfig, path: string): Promise<void> {
  const segments = normalizeRemotePath(path).split("/").filter(Boolean);
  let currentPath = "";

  for (const segment of segments) {
    currentPath = joinRemotePath(currentPath, segment);
    if (await remotePathExists(cfg, currentPath)) continue;

    const resp = await webdavRequest(cfg, currentPath, { method: "MKCOL" });
    if (!resp.ok && resp.status !== 405) {
      throw new Error(formatWriteFailure("创建目录", resp.status, resp.statusText));
    }
  }
}

// ---------------------------------------------------------------------------
// 数据转换工具
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function getId(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function getNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function buildStablePlaylistId(
  prefix: "local" | "cloud",
  source: string,
  name: string,
  songs: MusicInfo[],
): string {
  const songKeys = songs.map((song) => `${song.source}:${song.id}`).join("|");
  return `webdav-${prefix}-${stableHash(`${source}\n${name}\n${songKeys}`)}`;
}

function getTimestamp(value: unknown, fallback: number): number {
  const timestamp = getNumber(value, fallback);
  return timestamp >= 0 ? timestamp : fallback;
}

function normalizeMusicSource(value: unknown): MusicInfo["source"] | null {
  switch (getString(value).trim().toLowerCase()) {
    case "wy":
    case "netease":
    case "163":
      return "wy";
    case "tx":
    case "qq":
      return "tx";
    case "bili":
    case "bilibili":
      return "bili";
    case "local":
      return "local";
    case "kg":
    case "kugou":
    case "kw":
    case "kuwo":
    default:
      return null;
  }
}

function toMusicInfo(value: unknown): MusicInfo | null {
  if (!isObject(value)) return null;
  const id = getId(value.id ?? value.songmid ?? value.songId, "");
  const name = getString(value.name);
  if (!id || !name) return null;

  const source = normalizeMusicSource(value.source);
  if (!source) {
    return null;
  }
  const picUrl = getString(value.picUrl ?? value.img ?? value.pic);
  const music: MusicInfo = {
    id,
    name,
    singer: getString(value.singer ?? value.artist),
    albumName: getString(value.albumName ?? value.album),
    source,
  };

  const artistId = getString(value.artistId);
  if (artistId) music.artistId = artistId;
  const interval = getNumber(value.interval, Number.NaN);
  if (!Number.isNaN(interval)) music.interval = interval;
  const quality = getString(value.quality);
  if (quality) music.quality = quality;
  const mvId = getString(value.mvId).trim();
  if (source === "wy" && mvId && mvId !== "0") music.mvId = mvId;
  if (picUrl) {
    music.picUrl = picUrl;
    music.img = picUrl;
  }
  const url = getString(value.url);
  if (url) music.url = url;
  if (typeof value.isLocal === "boolean") music.isLocal = value.isLocal;
  if (isObject(value.gateway)) {
    music.gateway = {
      source: getString(value.gateway.source),
      trackId: getString(value.gateway.trackId),
      lyricId: getString(value.gateway.lyricId) || undefined,
      picId: getString(value.gateway.picId) || undefined,
    };
  }
  return music;
}

function toMusicList(value: unknown): MusicInfo[] {
  if (!Array.isArray(value)) return [];
  return value.map(toMusicInfo).filter((music): music is MusicInfo => music != null);
}

// ---------------------------------------------------------------------------
// 歌单同步文件构建与解析
// ---------------------------------------------------------------------------

function buildPlayHistorySync(entries: HistoryEntry[]): PlayHistorySyncItem[] {
  // 使用分时间记录的条目（含真实 playedAt）：跨天多次播放会各保留一条，对齐 lx。
  return entries
    .filter((entry) => entry.song?.id)
    .map((entry) => ({
      id: `${entry.key}_${entry.playedAt}`,
      musicInfo: entry.song,
      playedAt: entry.playedAt,
      playTime: 0,
      maxTime: entry.song.interval ?? 0,
      listId: null,
      source: "List" as const,
    }));
}

async function buildPlaylistsSyncFile(): Promise<PlaylistsSyncFile> {
  await loadCloudSongsCache();
  const { playlists, localPlaylists } = usePlaylistStore.getState();
  // loveList = 本地收藏（对齐桌面端 favoritesStore），双端同一数据槽互通
  const favorites = useFavoritesStore.getState().favorites;

  return {
    version: "3",
    lastModified: Date.now(),
    data: {
      defaultList: [],
      loveList: favorites,
      userList: [
        ...localPlaylists.map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          description: playlist.description ?? "",
          cover: "",
          source: "local",
          author: "",
          list: playlist.songs,
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
        })),
        ...playlists.map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          description: playlist.desc ?? "",
          cover: playlist.picUrl ?? playlist.coverImgUrl ?? "",
          source: playlist.source,
          author: playlist.author ?? "",
          // 移动端云端歌单只同步引用、歌曲按需拉取；但若从远端下载过真实歌曲列表
          // （如桌面端写入的），上传时重新挂载，避免用空列表覆盖云端数据。
          list: cachedCloudSongs(playlist.source, playlist.id),
          createdAt: Date.now(),
          updatedAt: playlist.updatedAt ?? Date.now(),
        })),
      ],
    },
    playHistory: buildPlayHistorySync(useHistoryStore.getState().entries),
  };
}

function parsePlayHistory(value: unknown): {
  history: MusicInfo[];
  timestamps: Record<string, number>;
} {
  const history: MusicInfo[] = [];
  const timestamps: Record<string, number> = {};
  if (!Array.isArray(value)) return { history, timestamps };
  for (const item of value) {
    if (isObject(item) && "musicInfo" in item) {
      const music = toMusicInfo(item.musicInfo);
      if (!music) continue;
      history.push(music);
      const playedAt = getNumber(item.playedAt, 0);
      if (playedAt > 0) timestamps[`${music.source}:${music.id}`] = playedAt;
    } else {
      const music = toMusicInfo(item);
      if (music) history.push(music);
    }
  }
  return { history, timestamps };
}

// ---------------------------------------------------------------------------
// 云端歌单歌曲缓存
//
// 移动端云端歌单只保存引用（歌曲按需拉取），但若直接把 `list: []` 上传覆盖，
// 会把桌面端/其它设备写入的真实歌曲列表从云端抹掉。因此下载时把云端携带的
// 歌曲缓存下来，上传时重新挂载，避免上传方向的数据丢失。
// ---------------------------------------------------------------------------

const CLOUD_SONGS_CACHE_KEY = "auralflow.mobile.webdavCloudPlaylistSongs";
const cloudSongsCache = new Map<string, MusicInfo[]>();

function cloudPlaylistKey(source: string, id: string): string {
  return `${source}:${id}`;
}

async function loadCloudSongsCache(): Promise<void> {
  if (cloudSongsCache.size > 0) return;
  try {
    const raw = await AsyncStorage.getItem(CLOUD_SONGS_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const songs = toMusicList(value);
      if (songs.length) cloudSongsCache.set(key, songs);
    }
  } catch {
    // 缓存损坏时忽略，退化为不挂载歌曲
  }
}

async function rememberCloudSongs(songsByKey: Map<string, MusicInfo[]>): Promise<void> {
  for (const [key, songs] of songsByKey) {
    if (songs.length) cloudSongsCache.set(key, songs);
  }
  if (songsByKey.size === 0) return;
  try {
    const payload: Record<string, MusicInfo[]> = {};
    for (const [key, songs] of cloudSongsCache) {
      payload[key] = songs;
    }
    await AsyncStorage.setItem(CLOUD_SONGS_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("保存 WebDAV 云端歌曲缓存失败", error);
  }
}

function cachedCloudSongs(source: string, id: string): MusicInfo[] {
  return cloudSongsCache.get(cloudPlaylistKey(source, id)) ?? [];
}

function remoteItemToWyPlaylist(remote: RemotePlaylistItem, index: number): WyPlaylistInfo {
  const songs = toMusicList(remote.list ?? remote.songs);
  const cover = getString(remote.cover ?? remote.picUrl ?? remote.img);
  const name = getString(remote.name, `歌单 ${index + 1}`);
  const source = getString(remote.source, "wy") || "wy";
  return {
    id: getId(remote.id, buildStablePlaylistId("cloud", source, name, songs)),
    name,
    author: getString(remote.author),
    picUrl: cover || undefined,
    desc: getString(remote.description ?? remote.desc) || undefined,
    playCount: 0,
    trackCount: songs.length,
    source: source as WyPlaylistInfo["source"],
    coverImgUrl: cover || undefined,
    updatedAt: getTimestamp(remote.updatedAt, 0),
  };
}

function remoteItemToLocalPlaylist(
  remote: RemotePlaylistItem,
  index: number,
  fallbackTimestamp: number,
): LocalPlaylist {
  const songs = toMusicList(remote.list ?? remote.songs);
  const name = getString(remote.name, `歌单 ${index + 1}`);
  const createdAt = getTimestamp(remote.createdAt, fallbackTimestamp);
  return {
    id: getId(remote.id, buildStablePlaylistId("local", "local", name, songs)),
    name,
    description: getString(remote.description ?? remote.desc) || undefined,
    cover: getString(remote.cover ?? remote.picUrl ?? remote.img) || undefined,
    songs,
    createdAt,
    updatedAt: getTimestamp(remote.updatedAt, createdAt),
  };
}

function parsePlaylistsSyncFile(text: string): {
  favorites: MusicInfo[];
  playlists: WyPlaylistInfo[];
  localPlaylists: LocalPlaylist[];
  history: MusicInfo[];
  historyTimestamps: Record<string, number>;
  cloudSongs: Map<string, MusicInfo[]>;
} {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("云端歌单文件已损坏或不是有效的 JSON");
  }
  const data = isObject(payload.data) ? payload.data : payload;
  const favorites = toMusicList(data.loveList ?? data.favorites);
  const playlists: WyPlaylistInfo[] = [];
  const localPlaylists: LocalPlaylist[] = [];
  const cloudSongs = new Map<string, MusicInfo[]>();
  const fallbackTimestamp = getTimestamp(payload.lastModified, 0);

  const defaultList = toMusicList(data.defaultList);
  if (defaultList.length) {
    const name = "默认列表";
    localPlaylists.push({
      id: buildStablePlaylistId("local", "local", name, defaultList),
      name,
      description: "从桌面端同步的默认列表",
      songs: defaultList,
      createdAt: fallbackTimestamp,
      updatedAt: fallbackTimestamp,
    });
  }

  const userList = Array.isArray(data.userList) ? data.userList : data.playlists;
  if (Array.isArray(userList)) {
    for (const [index, item] of userList.entries()) {
      if (!isObject(item)) continue;
      const remote = item as RemotePlaylistItem;
      const rawSource = getString(remote.source);
      // 桌面端/旧版数据可能不带 source 字段：网易云歌单 id 为纯数字，其余按本地歌单兜底，
      // 避免桌面端本地歌单（playlist_xxx id）在移动端被误识别为网易云云端歌单。
      const isLocal =
        rawSource === "local" || (!rawSource && !/^\d+$/.test(getString(remote.id)));
      if (isLocal) {
        localPlaylists.push(remoteItemToLocalPlaylist(remote, index, fallbackTimestamp));
      } else {
        const playlist = remoteItemToWyPlaylist(remote, index);
        const songs = toMusicList(remote.list ?? remote.songs);
        if (songs.length) {
          cloudSongs.set(cloudPlaylistKey(playlist.source, playlist.id), songs);
        }
        playlists.push(playlist);
      }
    }
  }

  const { history, timestamps } = parsePlayHistory(
    payload.playHistory ?? data.playHistory ?? payload.history ?? data.history,
  );
  return { favorites, playlists, localPlaylists, history, historyTimestamps: timestamps, cloudSongs };
}

// ---------------------------------------------------------------------------
// 自定义音源同步文件构建与解析
// ---------------------------------------------------------------------------

function buildUserApisSyncFile(sources: CustomSourceItem[]): UserApisSyncFile {
  return {
    version: "2",
    lastModified: Date.now(),
    data: sources
      .filter((source) => typeof source.script === "string" && source.script.trim())
      .map((source) => ({
        id: source.id,
        name: source.name,
        description: source.description,
        author: source.author ?? "",
        homepage: source.homepage ?? "",
        version: source.version ?? "",
        allowShowUpdateAlert: source.allowShowUpdateAlert,
        script: source.script,
      })),
  };
}

async function inflateDesktopScript(script: string): Promise<string> {
  const trimmed = script.trim();
  if (!trimmed.startsWith("gz_")) return script;

  const binary = atobSafe(trimmed.slice(3));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const inflated = await inflateBytes(bytes, "deflate");
  return new TextDecoder().decode(inflated);
}

async function convertUserApiToCustomSource(
  api: UserApiInfo,
  scriptMap: Record<string, string>,
  index: number,
): Promise<CustomSourceItem | null> {
  const explicitId = getId(api.id, "");
  const rawScript = getString(api.script) || (explicitId ? scriptMap[explicitId] : "");
  if (!rawScript.trim()) return null;

  const script = await inflateDesktopScript(rawScript);
  const info = parseDesktopUserApiInfo(script);
  const id = explicitId || `user_api_${stableHash(`${getString(api.name, info.name)}\n${script}\n${index}`)}`;
  const now = Date.now();
  return {
    id,
    name: getString(api.name, info.name),
    description: getString(api.description, info.description),
    script,
    enabled: true,
    allowShowUpdateAlert: typeof api.allowShowUpdateAlert === "boolean" ? api.allowShowUpdateAlert : true,
    author: getString(api.author, info.author) || undefined,
    homepage: getString(api.homepage, info.homepage) || undefined,
    version: getString(api.version, info.version) || undefined,
    testStatus: "idle",
    updateStatus: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

async function parseUserApisSyncFile(text: string): Promise<CustomSourceItem[]> {
  let payload: UserApisSyncFile;
  try {
    payload = JSON.parse(text) as UserApisSyncFile;
  } catch {
    throw new Error("云端音源文件已损坏或不是有效的 JSON");
  }
  const data = payload.data;
  const apis = Array.isArray(data) ? data : data?.list ?? [];
  const scripts = Array.isArray(data) ? {} : data?.scripts ?? {};
  const sources = await Promise.all(apis.map((api, index) => convertUserApiToCustomSource(api, scripts, index)));
  return sources.filter((source): source is CustomSourceItem => source != null);
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/** 上传自定义音源到 WebDAV（覆盖远端 user_apis.json）。 */
export async function uploadSourcesSync(): Promise<void> {
  return withSyncLock("上传音源", async () => {
    const cfg = await getConfig();
    if (!cfg) throw new Error("请先填写 WebDAV 地址");
    await ensureRemoteDirectory(cfg, REMOTE_ROOT_PATH);

    const sources = useCustomSourceStore.getState().sources;
    const body = JSON.stringify(buildUserApisSyncFile(sources), null, 2);
    const resp = await webdavRequest(cfg, userApisPath(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!resp.ok) {
      throw new Error(formatWriteFailure("上传音源", resp.status, resp.statusText));
    }
    await writeLocalMeta("sources", {
      lastModified: Date.now(),
      itemCount: sources.length,
    });
  });
}

/** 从 WebDAV 下载自定义音源（自动备份本地，阻止云端旧数据覆盖）。 */
/** 读同步文件：优先新路径 /AuralFlow/，404/409 时回退旧 /LX_Music/（迁移）。 */
async function readSyncFileWithLegacyFallback(
  cfg: WebdavConfig,
  fileName: (root?: string) => string,
): Promise<string | null> {
  const primary = await readWebdavText(cfg, fileName());
  if (primary != null) return primary;
  try {
    return await readWebdavText(cfg, fileName(LEGACY_REMOTE_ROOT_PATH));
  } catch {
    return null;
  }
}

export async function downloadSourcesSync(options?: { force?: boolean }): Promise<void> {
  return withSyncLock("下载音源", async () => {
    const cfg = await getConfig();
    if (!cfg) throw new Error("请先填写 WebDAV 地址");

    const text = await readSyncFileWithLegacyFallback(cfg, userApisPath);
    if (!text) throw new Error("云端没有音源文件");
    const localSources = useCustomSourceStore.getState().sources;
    await assertCloudNotStale("sources", text, localSources.length, options?.force);
    await writeLocalBackup("sources", localSources);

    const customSources = await parseUserApisSyncFile(text);
    if (!customSources.length) throw new Error("云端音源缺少有效脚本内容，无法初始化");
    useCustomSourceStore.getState().replaceAll(customSources);
    await writeLocalMeta("sources", {
      lastModified: Date.now(),
      itemCount: customSources.length,
    });
  });
}

/**
 * 上传前补拉云端歌单歌曲：移动端云端歌单只持有引用，cloudSongsCache 只在
 * 「本设备下载过远端文件」时才有内容。新设备登录后直接手动上传，会让每个
 * 云端歌单以 list: [] 覆盖远端真实歌曲列表（autoSync 先下载后上传，没有这个
 * 问题）。只要有云端歌单还没挂上缓存歌曲，就先拉一次远端文件补齐；远端存在
 * 但拉取失败时抛错中止上传——数据安全优先于上传便利。
 */
async function primeCloudSongsCacheForUpload(cfg: WebdavConfig): Promise<void> {
  const { playlists } = usePlaylistStore.getState();
  const needsPrime = playlists.some(
    (p) => p.source !== "local" && !cloudSongsCache.has(cloudPlaylistKey(p.source, p.id)),
  );
  if (!needsPrime) return;
  const text = await readSyncFileWithLegacyFallback(cfg, playlistsPath);
  // 云端没有歌单文件：没有任何可被覆盖的数据，直接放行
  if (!text) return;
  const { cloudSongs } = parsePlaylistsSyncFile(text);
  await rememberCloudSongs(cloudSongs);
}

/** 上传收藏、歌单和播放历史到 WebDAV（覆盖远端 playlists.json）。 */
export async function uploadPlaylistsSync(): Promise<void> {
  return withSyncLock("上传歌单", async () => {
    const cfg = await getConfig();
    if (!cfg) throw new Error("请先填写 WebDAV 地址");
    await ensureRemoteDirectory(cfg, REMOTE_ROOT_PATH);
    await primeCloudSongsCacheForUpload(cfg);

    const body = await buildPlaylistsSyncFile();

    const resp = await webdavRequest(cfg, playlistsPath(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body, null, 2),
    });
    if (!resp.ok) {
      throw new Error(formatWriteFailure("上传歌单", resp.status, resp.statusText));
    }
    // 本地标记必须在 PUT 成功后再写：若上传失败而 meta 已推进，
    // 下次下载会被 assertCloudNotStale 误判为“云端较旧”而拦截（对齐 uploadSourcesSync）。
    await writeLocalMeta("playlists", {
      lastModified: body.lastModified,
      itemCount:
        (body.data.loveList?.length ?? 0) +
        (body.data.userList?.length ?? 0) +
        (body.playHistory?.length ?? 0),
    });
  });
}

/**
 * 从 WebDAV 下载收藏、歌单和播放历史。
 *
 * 与桌面端语义对齐：默认合并（本地与云端并集，不丢本地独有项）；
 * merge=false 时用云端整体替换本地；force=true 跳过“云端较旧”拦截。
 */
export async function downloadPlaylistsSync(options?: {
  allowMissing?: boolean;
  force?: boolean;
  merge?: boolean;
}): Promise<void> {
  return withSyncLock("下载歌单", async () => {
    const cfg = await getConfig();
    if (!cfg) throw new Error("请先填写 WebDAV 地址");

    const text = await readSyncFileWithLegacyFallback(cfg, playlistsPath);
    if (!text) {
      if (options?.allowMissing) return;
      throw new Error("云端没有歌单文件");
    }

    // 对齐桌面端：下载前用本地 lastModified 标记拦截“云端旧于本地”的覆盖
    const localStore = usePlaylistStore.getState();
    const historyStore = useHistoryStore.getState();
    const totalLocal =
      useFavoritesStore.getState().favorites.length +
      localStore.playlists.length +
      localStore.localPlaylists.length +
      historyStore.entries.length;
    await assertCloudNotStale("playlists", text, totalLocal, options?.force);

    const {
      favorites,
      playlists,
      localPlaylists,
      history,
      historyTimestamps,
      cloudSongs,
    } = parsePlaylistsSyncFile(text);
    await rememberCloudSongs(cloudSongs);

    const playlistStore = usePlaylistStore.getState();
    const favoritesStore = useFavoritesStore.getState();
    const shouldMerge = options?.merge ?? true;
    if (shouldMerge) {
      await favoritesStore.mergeAll(favorites);
      await playlistStore.mergeFromSync({
        cloudPlaylists: playlists,
        localPlaylists,
      });
      // 注：下载侧按 key 折叠为单条（保留较新播放时间），跨天多次播放的完整记录
      // 仅在本地上传时保留——与桌面端 200 条去重格式互通，属预期权衡。
      await useHistoryStore.getState().mergeHistory(history, historyTimestamps);
      return;
    }

    favoritesStore.replaceAll(favorites);
    playlistStore.replaceAllFromSync(playlists);
    await playlistStore.replaceLocalPlaylists(localPlaylists);
    await useHistoryStore.getState().replaceAllHistory(history, historyTimestamps);
  });
}

let autoPlaylistsSyncPromise: Promise<void> | null = null;

/** 启动时安全同步歌单：先合并下载，再上传合并后的本地数据。 */
export function autoSyncPlaylistsOnce(): Promise<void> {
  if (autoPlaylistsSyncPromise) return autoPlaylistsSyncPromise;
  autoPlaylistsSyncPromise = (async () => {
    try {
      try {
        await downloadPlaylistsSync({ allowMissing: true, merge: true });
      } catch (error) {
        // 云端较旧（本地更新）时跳过下载，继续上传本地结果收敛；其余错误照常抛出
        const msg = error instanceof Error ? error.message : String(error);
        if (!msg.includes("较旧") && !msg.includes("强制下载")) throw error;
      }
      await uploadPlaylistsSync();
    } finally {
      // 单飞防并发重入，但完成后必须重置——否则首次失败（如启动时离线）
      // 整个会话都不再自动同步，网络恢复后也无法重试
      autoPlaylistsSyncPromise = null;
    }
  })();
  return autoPlaylistsSyncPromise;
}

/** 探测 WebDAV：检查远端目录并尝试 PUT 一个探测文件再删除。 */
export async function testSync(): Promise<string> {
  const cfg = await getConfig();
  if (!cfg) return "未配置 WebDAV 地址";
  try {
    return await withSyncLock("测试连接", async () => {
      await ensureRemoteDirectory(cfg, REMOTE_ROOT_PATH);
      const putResp = await webdavRequest(cfg, probePath(), {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: "probe",
      });
      if (!putResp.ok) {
        return formatWriteFailure("写入", putResp.status, putResp.statusText);
      }
      await webdavRequest(cfg, probePath(), { method: "DELETE" }).catch((error) => {
        console.warn("清理 WebDAV 探测文件失败", error);
      });
      return "连接正常";
    });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
