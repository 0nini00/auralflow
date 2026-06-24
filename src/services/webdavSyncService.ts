import { fetch } from "@tauri-apps/plugin-http";
import { loadSettings } from "@lx/tauri-bridge";
import type { MusicInfo } from "@lx/core";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { usePlaylistStore, type Playlist } from "@/stores/playlistStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useCustomSourceStore, type CustomSourceItem } from "@/stores/customSourceStore";
import { parseDesktopUserApiInfo } from "@/services/customSourceRuntime";
import { logAsyncError } from "@/utils/logAsyncError";
import { inflateBytes } from "@/utils/compression";

const PROBE_FILE = "auralflow-probe.txt";
const USER_APIS_FILE = "user_apis.json";
const PLAYLISTS_FILE = "playlists.json";
const REMOTE_ROOT_PATH = "/LX_Music/";

interface WebdavConfig {
  url: string;
  username: string;
  password: string;
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

type UserApisSyncData = UserApiInfo[] | {
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
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface PlaylistsSyncFile {
  version: "2";
  lastModified: number;
  data: {
    defaultList: MusicInfo[];
    loveList: MusicInfo[];
    userList: Array<Omit<Playlist, "songs"> & { list: MusicInfo[] }>;
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

type WebdavRequestInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

async function getConfig(): Promise<WebdavConfig | null> {
  const s = await loadSettings();
  const url = (s.webdavUrl ?? "").trim().replace(/\/+$/, "");
  if (!url) return null;
  return {
    url,
    username: s.webdavUsername ?? "",
    password: s.webdavPassword ?? "",
  };
}

function authHeader(cfg: WebdavConfig): string {
  const token = btoa(`${cfg.username}:${cfg.password}`);
  return `Basic ${token}`;
}

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

function userApisPath(): string {
  return joinRemotePath(REMOTE_ROOT_PATH, USER_APIS_FILE);
}

function playlistsPath(): string {
  return joinRemotePath(REMOTE_ROOT_PATH, PLAYLISTS_FILE);
}

function formatWriteFailure(action: string, status: number, statusText: string): string {
  if (status === 401 || status === 403) {
    return `${action}失败：WebDAV 认证失败或目录没有写入权限。请确认用户名、应用密码正确，并且该目录已授权可写。`;
  }
  if (status === 404 || status === 409) {
    return `${action}失败：WebDAV 服务地址不可用或远端目录无法创建。请确认服务地址正确，例如坚果云 https://dav.jianguoyun.com/dav/。`;
  }
  return `${action}失败: HTTP ${status} ${statusText}`;
}

async function webdavRequest(cfg: WebdavConfig, path: string, init: WebdavRequestInit): Promise<Response> {
  return fetch(buildUrl(cfg, path), {
    ...init,
    headers: {
      Authorization: authHeader(cfg),
      ...(init.headers ?? {}),
    },
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

function toMusicInfo(value: unknown): MusicInfo | null {
  if (!isObject(value)) return null;
  const id = getId(value.id ?? value.songmid ?? value.songId, "");
  const name = getString(value.name);
  if (!id || !name) return null;

  const source = getString(value.source, "wy") as MusicInfo["source"];
  const picUrl = getString(value.picUrl ?? value.img ?? value.pic);
  const music: MusicInfo = {
    id,
    name,
    singer: getString(value.singer ?? value.artist),
    albumName: getString(value.albumName ?? value.album),
    source,
  };

  const interval = getNumber(value.interval, Number.NaN);
  if (!Number.isNaN(interval)) music.interval = interval;
  const quality = getString(value.quality);
  if (quality) music.quality = quality;
  if (picUrl) {
    music.picUrl = picUrl;
    music.img = picUrl;
  }
  const url = getString(value.url);
  if (url) music.url = url;
  if (typeof value.isLocal === "boolean") music.isLocal = value.isLocal;
  return music;
}

function toMusicList(value: unknown): MusicInfo[] {
  if (!Array.isArray(value)) return [];
  return value.map(toMusicInfo).filter((music): music is MusicInfo => music != null);
}

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

  const bytes = Uint8Array.from(atob(trimmed.slice(3)), (char) => char.charCodeAt(0));
  const inflated = await inflateBytes(bytes, "deflate");
  return new TextDecoder().decode(inflated);
}

async function convertUserApiToCustomSource(
  api: UserApiInfo,
  scriptMap: Record<string, string>,
  index: number,
): Promise<CustomSourceItem | null> {
  const id = getId(api.id, `user_api_${index}_${Date.now()}`);
  const rawScript = getString(api.script) || scriptMap[id];
  if (!rawScript?.trim()) return null;

  const script = await inflateDesktopScript(rawScript);
  const info = parseDesktopUserApiInfo(script);
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
  const payload = JSON.parse(text) as UserApisSyncFile;
  const data = payload.data;
  const apis = Array.isArray(data) ? data : data?.list ?? [];
  const scripts = Array.isArray(data) ? {} : data?.scripts ?? {};
  const sources = await Promise.all(apis.map((api, index) => convertUserApiToCustomSource(api, scripts, index)));
  return sources.filter((source): source is CustomSourceItem => source != null);
}

function buildPlayHistorySync(history: MusicInfo[]): PlayHistorySyncItem[] {
  const now = Date.now();
  return history
    .filter((music) => music?.id)
    .map((music, index) => ({
      id: `${music.source}_${music.id}_${now - index}`,
      musicInfo: music,
      playedAt: now - index,
      playTime: 0,
      maxTime: music.interval ?? 0,
      listId: null,
      source: "List",
    }));
}

function buildPlaylistsSyncFile(): PlaylistsSyncFile {
  return {
    version: "2",
    lastModified: Date.now(),
    data: {
      defaultList: [],
      loveList: useFavoritesStore.getState().favorites,
      userList: usePlaylistStore.getState().playlists.map((playlist) => {
        const { songs, ...info } = playlist;
        return {
          ...info,
          list: songs,
        };
      }),
    },
    playHistory: buildPlayHistorySync(useHistoryStore.getState().history),
  };
}

function parsePlayHistory(value: unknown): MusicInfo[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (isObject(item) && "musicInfo" in item) return toMusicInfo(item.musicInfo);
      return toMusicInfo(item);
    })
    .filter((music): music is MusicInfo => music != null);
}

function parsePlaylistsSyncFile(text: string): { favorites: MusicInfo[]; playlists: Playlist[]; history: MusicInfo[] } {
  const payload = JSON.parse(text) as Record<string, unknown>;
  const data = isObject(payload.data) ? payload.data : payload;
  const favorites = toMusicList(data.loveList ?? data.favorites);
  const playlists: Playlist[] = [];
  const now = Date.now();

  const defaultList = toMusicList(data.defaultList);
  if (defaultList.length) {
    playlists.push({
      id: "desktop_default_list",
      name: "默认列表",
      songs: defaultList,
      createdAt: now,
      updatedAt: now,
    });
  }

  const userList = Array.isArray(data.userList) ? data.userList : data.playlists;
  if (Array.isArray(userList)) {
    for (const [index, item] of userList.entries()) {
      if (!isObject(item)) continue;
      const remote = item as RemotePlaylistItem;
      const songs = toMusicList(remote.list ?? remote.songs);
      const name = getString(remote.name, `歌单 ${index + 1}`);
      playlists.push({
        id: getId(remote.id, `playlist_${now}_${index}`),
        name,
        description: getString(remote.description ?? remote.desc) || undefined,
        cover: getString(remote.cover ?? remote.picUrl ?? remote.img) || undefined,
        songs,
        createdAt: getNumber(remote.createdAt, now),
        updatedAt: getNumber(remote.updatedAt, now),
      });
    }
  }

  const history = parsePlayHistory(payload.playHistory ?? data.playHistory ?? payload.history ?? data.history);
  return { favorites, playlists, history };
}

/** 上传自定义音源到 WebDAV（覆盖远端 user_apis.json）。 */
export async function uploadSourcesSync(): Promise<void> {
  const cfg = await getConfig();
  if (!cfg) throw new Error("请先在设置中填写 WebDAV 地址");
  await ensureRemoteDirectory(cfg, REMOTE_ROOT_PATH);

  const resp = await webdavRequest(cfg, userApisPath(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildUserApisSyncFile(useCustomSourceStore.getState().sources), null, 2),
  });
  if (!resp.ok) {
    throw new Error(formatWriteFailure("上传音源", resp.status, resp.statusText));
  }
}

/** 从 WebDAV 下载自定义音源（覆盖本地）。 */
export async function downloadSourcesSync(): Promise<void> {
  const cfg = await getConfig();
  if (!cfg) throw new Error("请先在设置中填写 WebDAV 地址");

  const text = await readWebdavText(cfg, userApisPath());
  if (!text) throw new Error("云端没有音源文件");
  const customSources = await parseUserApisSyncFile(text);
  if (!customSources.length) throw new Error("云端音源缺少有效脚本内容，无法初始化");
  useCustomSourceStore.getState().replaceAll(customSources);
}

/** 上传收藏、歌单和播放历史到 WebDAV（覆盖远端 playlists.json）。 */
export async function uploadPlaylistsSync(): Promise<void> {
  const cfg = await getConfig();
  if (!cfg) throw new Error("请先在设置中填写 WebDAV 地址");
  await ensureRemoteDirectory(cfg, REMOTE_ROOT_PATH);

  const resp = await webdavRequest(cfg, playlistsPath(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPlaylistsSyncFile(), null, 2),
  });
  if (!resp.ok) {
    throw new Error(formatWriteFailure("上传歌单", resp.status, resp.statusText));
  }
}

/** 从 WebDAV 下载收藏、歌单和播放历史（覆盖本地）。 */
export async function downloadPlaylistsSync(): Promise<void> {
  const cfg = await getConfig();
  if (!cfg) throw new Error("请先在设置中填写 WebDAV 地址");

  const text = await readWebdavText(cfg, playlistsPath());
  if (!text) throw new Error("云端没有歌单文件");
  const { favorites, playlists, history } = parsePlaylistsSyncFile(text);
  useFavoritesStore.getState().replaceAll(favorites);
  usePlaylistStore.getState().replaceAll(playlists);
  useHistoryStore.getState().replaceAll(history);
}

/** 探测 WebDAV：检查远端目录并尝试 PUT 一个探测文件再删除。 */
export async function testSync(): Promise<string> {
  const cfg = await getConfig();
  if (!cfg) return "未配置 WebDAV 地址";
  try {
    await ensureRemoteDirectory(cfg, REMOTE_ROOT_PATH);
    const putResp = await webdavRequest(cfg, probePath(), {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "probe",
    });
    if (!putResp.ok) {
      return formatWriteFailure("写入", putResp.status, putResp.statusText);
    }
    await webdavRequest(cfg, probePath(), { method: "DELETE" }).catch(logAsyncError("webdav:test-cleanup-probe"));
    return "连接正常";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
