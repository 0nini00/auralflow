import { loadSettings } from "@lx/tauri-bridge";
import type { MusicInfo } from "@lx/core";
import { outboundRequest, type OutboundResponse } from "@/services/outboundHttp";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { usePlaylistStore, type Playlist } from "@/stores/playlistStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useCustomSourceStore, type CustomSourceItem } from "@/stores/customSourceStore";
import { parseDesktopUserApiInfo } from "@/services/customSourceRuntime";
import { inflateBytes } from "@/utils/compression";

const PROBE_FILE = "auralflow-probe.txt";
const USER_APIS_FILE = "user_apis.json";
const PLAYLISTS_FILE = "playlists.json";
const REMOTE_ROOT_PATH = "/AuralFlow/";
/** 旧版远程根路径（lx-music 沿袭）。仅用于下载回读迁移：新路径 404 时
 * 回退读旧路径，避免老用户升级后云端数据“消失”。上传一律写新路径。 */
const LEGACY_REMOTE_ROOT_PATH = "/LX_Music/";

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
  version: "2" | "3";
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

type WebdavRequestInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
};


/** Serialize all WebDAV ops so double-clicks cannot race PUT/GET. */
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

const LOCAL_META_PREFIX = "auralflow:webdav:localMeta:";

interface LocalSyncMeta {
  lastModified: number;
  itemCount: number;
}

function readLocalMeta(kind: "sources" | "playlists"): LocalSyncMeta | null {
  try {
    const raw = localStorage.getItem(LOCAL_META_PREFIX + kind);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSyncMeta;
    if (typeof parsed?.lastModified !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalMeta(kind: "sources" | "playlists", meta: LocalSyncMeta): void {
  try {
    localStorage.setItem(LOCAL_META_PREFIX + kind, JSON.stringify(meta));
  } catch {
    // ignore quota errors
  }
}

function writeLocalBackup(kind: "sources" | "playlists", payload: unknown): void {
  try {
    localStorage.setItem(
      `auralflow:webdav:backup:${kind}`,
      JSON.stringify({ savedAt: Date.now(), payload }),
    );
  } catch (err) {
  }
}

function extractRemoteLastModified(text: string): number | null {
  try {
    const parsed = JSON.parse(text) as { lastModified?: unknown };
    const n = Number(parsed?.lastModified);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Guard against silently overwriting newer local data with older cloud data. */
function assertCloudNotStale(
  kind: "sources" | "playlists",
  remoteText: string,
  localItemCount: number,
  force?: boolean,
): void {
  if (force) return;
  if (localItemCount <= 0) return;
  const remoteLm = extractRemoteLastModified(remoteText);
  const localMeta = readLocalMeta(kind);
  if (remoteLm == null || localMeta == null) return;
  if (remoteLm + 1000 < localMeta.lastModified) {
    const remoteAt = new Date(remoteLm).toLocaleString();
    const localAt = new Date(localMeta.lastModified).toLocaleString();
    throw new Error(
      `云端数据较旧（云端 ${remoteAt}，本地标记 ${localAt}）。` +
        `下载将覆盖本地约 ${localItemCount} 项。若确认要用云端覆盖，请强制下载。`,
    );
  }
}


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

function userApisPath(root: string = REMOTE_ROOT_PATH): string {
  return joinRemotePath(root, USER_APIS_FILE);
}

function playlistsPath(root: string = REMOTE_ROOT_PATH): string {
  return joinRemotePath(root, PLAYLISTS_FILE);
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

async function webdavRequest(cfg: WebdavConfig, path: string, init: WebdavRequestInit): Promise<OutboundResponse> {
  return outboundRequest(buildUrl(cfg, path), {
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
    version: "3",
    lastModified: Date.now(),
    data: {
      defaultList: [],
      loveList: useFavoritesStore.getState().favorites,
      userList: usePlaylistStore.getState().playlists.map((playlist) => {
        const { songs, ...info } = playlist;
        return {
          ...info,
          // 桌面端歌单均为本地歌单，显式标记 source 供移动端正确归类（避免被识别为云端歌单）
          source: "local",
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
  return withSyncLock("上传音源", async () => {
    const cfg = await getConfig();
    if (!cfg) throw new Error("请先在设置中填写 WebDAV 地址");

    await ensureRemoteDirectory(cfg, REMOTE_ROOT_PATH);

    const sources = useCustomSourceStore.getState().sources;
    const body = buildUserApisSyncFile(sources);
    const sourcesLm = body.lastModified ?? Date.now();

    const resp = await webdavRequest(cfg, userApisPath(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body, null, 2),
    });
    if (!resp.ok) {
      throw new Error(formatWriteFailure("上传音源", resp.status, resp.statusText));
    }
    // 本地标记必须在 PUT 成功后再写（与歌单上传一致），避免失败误拦后续下载。
    writeLocalMeta("sources", {
      lastModified: sourcesLm,
      itemCount: sources.length,
    });
  });
}

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
    if (!cfg) throw new Error("请先在设置中填写 WebDAV 地址");

    const text = await readSyncFileWithLegacyFallback(cfg, userApisPath);
    if (!text) throw new Error("云端没有音源文件");

    const localSources = useCustomSourceStore.getState().sources;
    assertCloudNotStale("sources", text, localSources.length, options?.force);
    writeLocalBackup("sources", localSources);

    const customSources = await parseUserApisSyncFile(text);
    useCustomSourceStore.getState().replaceAll(customSources);

    const remoteLm = extractRemoteLastModified(text) ?? Date.now();
    writeLocalMeta("sources", {
      lastModified: remoteLm,
      itemCount: customSources.length,
    });
  });
}

export async function uploadPlaylistsSync(): Promise<void> {
  return withSyncLock("上传歌单", async () => {
    const cfg = await getConfig();
    if (!cfg) throw new Error("请先在设置中填写 WebDAV 地址");

    await ensureRemoteDirectory(cfg, REMOTE_ROOT_PATH);

    const body = buildPlaylistsSyncFile();

    const resp = await webdavRequest(cfg, playlistsPath(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body, null, 2),
    });
    if (!resp.ok) {
      throw new Error(formatWriteFailure("上传歌单", resp.status, resp.statusText));
    }
    // 本地标记必须在 PUT 成功后再写：若上传失败而 meta 已推进，
    // 下次下载会被 assertCloudNotStale 误判为“云端较旧”而拦截（与移动端修复一致）。
    writeLocalMeta("playlists", {
      lastModified: body.lastModified,
      itemCount:
        (body.data?.loveList?.length ?? 0) +
        (body.data?.userList?.length ?? 0) +
        (body.playHistory?.length ?? 0),
    });
  });
}

export async function downloadPlaylistsSync(options?: { force?: boolean }): Promise<void> {
  return withSyncLock("下载歌单", async () => {
    const cfg = await getConfig();
    if (!cfg) throw new Error("请先在设置中填写 WebDAV 地址");

    const text = await readSyncFileWithLegacyFallback(cfg, playlistsPath);
    if (!text) throw new Error("云端没有歌单文件");

    const favorites = useFavoritesStore.getState().favorites;
    const playlists = usePlaylistStore.getState().playlists;
    const history = useHistoryStore.getState().history;
    const totalLocal = favorites.length + playlists.length + history.length;

    assertCloudNotStale("playlists", text, totalLocal, options?.force);

    writeLocalBackup("playlists", { favorites, playlists, history });

    const parsed = parsePlaylistsSyncFile(text);
    // 合并而非覆盖：本地与远端收藏/歌单/历史并集,保留双端数据不丢失。
    useFavoritesStore.getState().mergeAll(parsed.favorites);
    usePlaylistStore.getState().mergeAll(parsed.playlists);
    useHistoryStore.getState().mergeAll(parsed.history);

    const remoteLm = extractRemoteLastModified(text) ?? Date.now();
    writeLocalMeta("playlists", {
      lastModified: remoteLm,
      itemCount: parsed.favorites.length + parsed.playlists.length + parsed.history.length,
    });
  });
}

export async function testSync(): Promise<string> {
  try {
    return await withSyncLock("测试连接", async () => {
      const cfg = await getConfig();
      if (!cfg) return "未配置 WebDAV 地址";
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
