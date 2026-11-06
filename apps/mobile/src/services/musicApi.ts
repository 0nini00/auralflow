import {
  createBuiltinMusicApiClient,
  normalizeSearchKeyword,
  getBuiltinMusicApiGateway,
  mergeRomanization,
  mergeTranslation,
  orderPlaybackCandidates,
  parseLyricSource,
  pickSameSongCandidate,
  type LyricLine,
  type MusicInfo,
  type SourceTag,
} from "@lx/core";
import {
  getCachedResult,
  setCachedResult,
} from "./searchResultCache";
import { mergeDuplicateSongs } from "./songMetadataMerge";
import { searchTxPlaylists, searchTxSongs } from "./txPlaylistService";
import { searchWySongsViaCloudSearch } from "./wySearchService";
import { mapWyTrackToMusicInfo } from "./wyMusicMapper";
import { postWyEapi } from "./wyDirectProvider";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import { parseNeteaseCommentResult, type SongCommentResult } from "./songCommentModel";

const DEFAULT_LIMIT = 30;
const SONG_PAGE_SIZE = { wy: 100, tx: 50 } as const;

export interface SearchArtistResult {
  id: string;
  name: string;
  avatarUrl?: string;
  alias?: string[];
  source: Extract<SourceTag, "wy" | "tx">;
  songCount?: number;
}

export interface SearchAlbumResult {
  id: string;
  name: string;
  artistName: string;
  coverUrl?: string;
  publishTime?: string;
  trackCount?: number;
  source: Extract<SourceTag, "wy" | "tx">;
}

export interface SearchPlaylistResult {
  id: string;
  name: string;
  creatorName?: string;
  coverUrl?: string;
  trackCount?: number;
  playCount?: number;
  source: Extract<SourceTag, "wy" | "tx">;
}

export interface SearchResults {
  songs: MusicInfo[];
  artists: SearchArtistResult[];
  albums: SearchAlbumResult[];
  playlists: SearchPlaylistResult[];
}

export type SearchSource = "all" | Extract<SourceTag, "wy" | "tx">;

export type { CommentVoice, SongComment, SongCommentResult } from "./songCommentModel";

/** 网易云歌单评论标识前缀（歌曲资源 R_SO_4_<songId>） */
const SONG_COMMENT_RESOURCE_PREFIX = "R_SO_4_";

/**
 * 拉取网易云歌曲评论（头像/昵称/点赞/内容/时间）。
 * 仅网易云（wy）曲目有真实评论 ID，tx/local 无数据则不调用。
 */
export async function fetchNeteaseComments(
  songId: string,
  offset = 0,
  limit = 20
): Promise<SongCommentResult> {
  const rid = SONG_COMMENT_RESOURCE_PREFIX + encodeURIComponent(songId);
  const url =
    `https://music.163.com/api/v1/resource/comments/${rid}` +
    `?rid=${rid}&offset=${offset}&total=${offset > 0}&limit=${limit}`;
  const response = await fetchText(url);
  return parseNeteaseCommentResult(JSON.parse(response));
}

export interface ArtistDetailResult {
  artist: SearchArtistResult & {
    briefDesc?: string;
    albumCount?: number;
  };
  songs: MusicInfo[];
  albums: SearchAlbumResult[];
}

export interface AlbumDetailResult {
  album: SearchAlbumResult & {
    description?: string;
    artistId?: string;
  };
  songs: MusicInfo[];
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "AuralFlowMobile/0.1",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`请求失败，请稍后重试`);
  }
  return text;
}

/**
 * 内置音乐 API 网关（播放/下载/歌词）。
 * 由 gdstudio 网关（music-api.gdstudio.xyz）统一解析，失败后由调用方走自定义音源兜底。
 */
const builtinClient = createBuiltinMusicApiClient(fetchText);

/**
 * 平台 → 网关目录名。网关只提供网易云与 JOOX 两套目录，没有 QQ 音乐。
 *
 * 历史上 tx 被映射到 joox 作兜底，但实测网关对 JOOX 的取链在 128/320/999 三档
 * 一致返回 `{"url":"","br":-1}`（搜索与歌词正常），即 JOOX 曲目永远拿不到音频。
 * 而这类结果带的是 JOOX 命名空间的 base64 id，却被贴成 `source: "tx"` 混进 QQ
 * 结果列表：下载文件名要清洗（见 downloadService），解析还必然失败。
 * 因此 tx 不再走网关：官方直连失败就直接失败，把「不可播放的结果」留在列表里
 * 比报错更糟。
 */
export function toApiSource(source: Extract<SourceTag, "wy" | "tx">): string | null {
  return source === "wy" ? "netease" : null;
}

/** 显式网关召回，不读取或覆盖官方搜索缓存。 */

function formatDate(value?: number | string): string | undefined {
  if (!value) return undefined;
  const date = new Date(typeof value === "string" ? Number(value) : value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function parseSearchResponse(response: string): Record<string, any> {
  const data = JSON.parse(response) as Record<string, any>;
  if (data.code !== 200 || !data.result || typeof data.result !== 'object') {
    throw new Error(`搜索接口拒绝请求（${String(data.code ?? '无状态码')}）`);
  }
  return data;
}

async function searchNeteaseArtists(keyword: string, page = 1): Promise<SearchArtistResult[]> {
  const response = await fetchText(
    `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=100&offset=${(page - 1) * DEFAULT_LIMIT}&total=true&limit=${DEFAULT_LIMIT}`
  );
  const data = parseSearchResponse(response);
  const artists = Array.isArray(data.result?.artists) ? data.result.artists : [];
  return artists.map((artist: any) => ({
    id: String(artist.id),
    name: artist.name,
    avatarUrl: artist.picUrl,
    alias: Array.isArray(artist.alias) ? artist.alias : [],
    source: "wy",
    songCount: artist.musicSize,
  }));
}

async function searchNeteaseAlbums(keyword: string, page = 1): Promise<SearchAlbumResult[]> {
  const response = await fetchText(
    `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=10&offset=${(page - 1) * DEFAULT_LIMIT}&total=true&limit=${DEFAULT_LIMIT}`
  );
  const data = parseSearchResponse(response);
  const albums = Array.isArray(data.result?.albums) ? data.result.albums : [];
  return albums.map((album: any) => ({
    id: String(album.id),
    name: album.name,
    artistName: album.artist?.name || album.artists?.map((item: any) => item.name).join(" / ") || "未知歌手",
    coverUrl: album.picUrl,
    publishTime: formatDate(album.publishTime),
    trackCount: album.size,
    source: "wy",
  }));
}

async function searchNeteasePlaylists(keyword: string, page = 1): Promise<SearchPlaylistResult[]> {
  const response = await fetchText(
    `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=1000&offset=${(page - 1) * DEFAULT_LIMIT}&total=true&limit=${DEFAULT_LIMIT}`
  );
  const data = parseSearchResponse(response);
  const playlists = Array.isArray(data.result?.playlists) ? data.result.playlists : [];
  return playlists.map((playlist: any) => ({
    id: String(playlist.id),
    name: playlist.name,
    creatorName: playlist.creator?.nickname,
    coverUrl: playlist.coverImgUrl,
    trackCount: playlist.trackCount,
    playCount: playlist.playCount,
    source: "wy",
  }));
}

/** searchSongs 缓存命名空间 */
const SONGS_CACHE_NAMESPACE = "songs";

/**
 * 官方接口直连搜索（对齐桌面端 searchWyViaCloudSearch / searchQqSongs）：
 * wy → 网易云 eapi cloudsearch；tx → 腾讯 musicu DoSearchForQQMusicLite。
 */
async function searchDirectSongs(
  source: Extract<SourceTag, "wy" | "tx">,
  keyword: string,
  page = 1,
): Promise<MusicInfo[]> {
  // 直连路径是网关挂掉时的完整兑底 + 元数据补全源，拉取量与桌面端对齐（wy 100 / tx 50）
  if (source === "wy") {
    return searchWySongsViaCloudSearch(keyword, SONG_PAGE_SIZE.wy, page);
  }
  return searchTxSongs(keyword, SONG_PAGE_SIZE.tx, {}, page);
}

/**
 * 歌曲搜索（官方接口直连优先，快）：
 * 1. 官方直连搜索（wy eapi cloudsearch / tx musicu），元数据（封面/歌手/专辑）由官方接口直接提供；
 * 2. 直连失败 → 回退内置音乐 API 网关搜索（仅作兜底）；
 * 3. 两者都失败 → 抛错（含两条链路的失败原因）。
 *
 * 注：此前网关优先 + 串行直连补全导致搜索明显偏慢（第三方网关延迟 + 两个请求串行），
 * 已改为直连优先；内置音乐 API 的职责收敛为播放 + 下载。
 */
export async function searchSongs(
  source: Extract<SourceTag, "wy" | "tx">,
  keyword: string,
  page = 1,
): Promise<MusicInfo[]> {
  keyword = normalizeSearchKeyword(keyword);
  const namespace = `${SONGS_CACHE_NAMESPACE}:page:${page}`;
  // 优先查缓存，命中则直接返回
  const cached = getCachedResult<MusicInfo[]>(source, keyword, namespace);
  if (cached) return cached;

  const cacheAndReturn = (songs: MusicInfo[]): MusicInfo[] => {
    setCachedResult(source, keyword, songs, namespace);
    return songs;
  };

  let apiError: unknown;
  try {
    const directSongs = await searchDirectSongs(source, keyword, page);
    // 首页空结果可能是被风控软拒（200 + 无 songs），不能当成“真的没有”缓存 5 分钟：
    // 继续走网关兜底；只有非首页的空页才按真实末页缓存。
    if (directSongs.length > 0 || page > 1) return cacheAndReturn(directSongs);
  } catch (error) {
    apiError = error;
  }

  // 网关没有 QQ 曲库（见 toApiSource）：直连失败/无结果时不再拿 JOOX 结果冒充 tx。
  const apiSource = toApiSource(source);
  if (!apiSource) {
    if (apiError) throw apiError;
    throw new Error("搜索无结果");
  }

  try {
    const apiSongs = await builtinClient.searchSongs(
      apiSource,
      keyword,
      page,
      SONG_PAGE_SIZE[source],
      source,
    );
    return cacheAndReturn(apiSongs);
  } catch (fallbackError) {
    if (!apiError) throw fallbackError;
    const apiMessage = apiError instanceof Error ? apiError.message : String(apiError);
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(`官方直连搜索失败：${apiMessage}\n内置音乐 API 搜索失败：${fallbackMessage}`);
  }

}

export type SearchCategory = keyof SearchResults;
export function emptySearchResults(): SearchResults {
  return { songs: [], artists: [], albums: [], playlists: [] };
}

/** 一个来源的一页结果；空页是正常结束，接口异常由分页会话独立展示。 */
export async function searchCategoryPage(
  source: Extract<SourceTag, "wy" | "tx">,
  category: SearchCategory,
  keyword: string,
  page = 1,
): Promise<{ result: SearchResults; hasMore: boolean }> {
  if (!Number.isInteger(page) || page < 1) throw new Error("搜索页码无效");
  keyword = normalizeSearchKeyword(keyword);
  const namespace = `category:${category}:page:${page}`;
  const cached = getCachedResult<SearchResults>(source, keyword, namespace);
  if (cached) return { result: cached, hasMore: cached[category].length > 0 };
  const result = emptySearchResults();
  if (category === "songs") result.songs = await searchSongs(source, keyword, page);
  else if (category === "playlists") result.playlists = source === "wy"
    ? await searchNeteasePlaylists(keyword, page) : await searchTxPlaylists(keyword, {}, page);
  else if (source === "wy" && category === "artists") result.artists = await searchNeteaseArtists(keyword, page);
  else if (source === "wy" && category === "albums") result.albums = await searchNeteaseAlbums(keyword, page);
  setCachedResult(source, keyword, result, namespace);
  return { result, hasMore: result[category].length > 0 };
}

/** 兼容需要整页结果的调用者，各分类同时发起；页面交互使用渐进会话。 */
export async function searchAll(source: SearchSource, keyword: string): Promise<SearchResults> {
  const sources: Array<Extract<SourceTag, "wy" | "tx">> = source === "all" ? ["wy", "tx"] : [source];
  const requests = sources.flatMap(item => (["songs", "artists", "albums", "playlists"] as const)
    .filter(category => item === "wy" || category === "songs" || category === "playlists")
    .map(category => searchCategoryPage(item, category, keyword)));
  const settled = await Promise.allSettled(requests);
  if (settled.every(result => result.status === "rejected")) throw new Error("搜索请求全部失败，请重试");
  const merged = emptySearchResults();
  for (const entry of settled) {
    if (entry.status !== "fulfilled") continue;
    const { result } = entry.value;
    merged.songs.push(...result.songs); merged.artists.push(...result.artists);
    merged.albums.push(...result.albums); merged.playlists.push(...result.playlists);
  }
  return { ...merged, songs: mergeDuplicateSongs(merged.songs) };
}

export async function fetchNeteaseArtistDetail(artistId: string): Promise<ArtistDetailResult> {
  const [detailResponse, songsResponse, albumsResponse] = await Promise.all([
    fetchText("https://music.163.com/api/artist/head/info/get?id=" + encodeURIComponent(artistId)),
    fetchText("https://music.163.com/api/v1/artist/songs?id=" + encodeURIComponent(artistId) + "&private_cloud=true&work_type=1&order=hot&offset=0&limit=50"),
    fetchText("https://music.163.com/api/artist/albums/" + encodeURIComponent(artistId) + "?limit=12&offset=0&total=true"),
  ]);

  const detailData = JSON.parse(detailResponse) as Record<string, any>;
  const songsData = JSON.parse(songsResponse) as Record<string, any>;
  const albumsData = JSON.parse(albumsResponse) as Record<string, any>;

  const artist = detailData.data?.artist ?? {};
  const songs = Array.isArray(songsData.songs) ? songsData.songs : [];
  const albums = Array.isArray(albumsData.hotAlbums) ? albumsData.hotAlbums : [];

  return {
    artist: {
      id: String(artist.id ?? artistId),
      name: artist.name || "未知歌手",
      avatarUrl: artist.cover || artist.picUrl || artist.avatar,
      alias: Array.isArray(artist.alias) ? artist.alias : [],
      source: "wy",
      songCount: Number(artist.musicSize ?? songsData.total ?? songs.length),
      briefDesc: artist.briefDesc || "",
      albumCount: Number(artist.albumSize ?? albums.length),
    },
    songs: songs.map(mapWyTrackToMusicInfo),
    albums: albums.map((album: any) => ({
      id: String(album.id),
      name: album.name,
      artistName: album.artist?.name || artist.name || "未知歌手",
      coverUrl: album.picUrl || album.blurPicUrl,
      publishTime: formatDate(album.publishTime),
      trackCount: album.size,
      source: "wy",
    })),
  };
}

export async function fetchNeteaseAlbumDetail(albumId: string): Promise<AlbumDetailResult> {
  const response = await fetchText("https://music.163.com/api/v1/album/" + encodeURIComponent(albumId));
  const data = JSON.parse(response) as Record<string, any>;
  const album = data.album ?? {};
  const songs = Array.isArray(data.songs) ? data.songs : [];

  return {
    album: {
      id: String(album.id ?? albumId),
      name: album.name || "未知专辑",
      artistName: album.artist?.name || album.artists?.map((item: any) => item.name).join(" / ") || "未知歌手",
      artistId: album.artist?.id ? String(album.artist.id) : album.artists?.[0]?.id ? String(album.artists[0].id) : undefined,
      coverUrl: album.picUrl || album.blurPicUrl,
      publishTime: formatDate(album.publishTime),
      trackCount: Number(album.size ?? songs.length),
      description: album.description || "",
      source: "wy",
    },
    songs: songs.map(mapWyTrackToMusicInfo),
  };
}

/**
 * 网关解析：只用歌曲自身的网关元数据，不做跨源替代。
 *
 * 曾经在这里做过「同名搜索转译」——tx 曲目缺 gateway 时用「歌名 + 首位歌手」
 * 去网易云搜同名曲顶上。已移除：gdstudio 搜索结果不带 interval，isSameSong 的
 * 时长校验因此永远被跳过，只剩「歌名相同 + 歌手重合」，会匹配到 Live / 翻唱 /
 * 重录 / 同名不同曲；且即便匹配准确，用户点的是 QQ 音乐的曲目却播网易云版本，
 * 元数据与音质都对不上。tx 缺 gateway 时交给自定义音源用真实 songmid 解析。
 */
export async function resolveSongUrl(song: MusicInfo, quality = "320k"): Promise<{ url: string; quality: string }> {
  if (!getBuiltinMusicApiGateway(song)) {
    throw new Error("内置音乐 API 无该歌曲的解析元数据");
  }
  return builtinClient.resolveUrl(song, quality);
}

/** 在线音频流统一浏览器 UA（CDN 防盗链要求，与桌面端一致）。 */
export const STREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * wy/tx 音源 CDN 防盗链请求头：网易云 CDN 需 Referer: https://music.163.com，
 * 腾讯 CDN 需 Referer: https://y.qq.com，缺失时 CDN 返回 403。
 */
export function buildStreamHeaders(
  source: string | undefined,
): Record<string, string> | undefined {
  const referer =
    source === "wy" ? "https://music.163.com" : source === "tx" ? "https://y.qq.com" : undefined;
  if (!referer) return undefined;
  return {
    Referer: referer,
    "User-Agent": STREAM_USER_AGENT,
  };
}

/** 官方歌词直连结果（原文 + 可选翻译 / 罗马音） */
interface OfficialLyricResult {
  lyric: string;
  tlyric?: string;
  romaLyric?: string;
}

/** 歌词响应体（只声明用到的字段）。 */
interface WyLyricBody {
  yrc?: { lyric?: string };
  ytlrc?: { lyric?: string };
  yromalrc?: { lyric?: string };
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  romalrc?: { lyric?: string };
  /** 网易云判定「暂无歌词」时的标记，此时 lrc 里只有占位文本 */
  uncollected?: boolean;
  nolyric?: boolean;
}

/** 取网易云歌词原始响应体（保留占位标记，交给调用方判断）。 */
async function requestWyLyricBody(id: string): Promise<WyLyricBody> {
  return (await postWyEapi("/api/song/lyric/v1", {
    id: Number(id),
    cp: false,
    tv: -1,
    lv: -1,
    rv: -1,
    kv: -1,
    yv: -1,
    ytv: -1,
    yrv: -1,
  })) as WyLyricBody;
}

/** 响应体 → 直连结果；占位词或空内容返回 null（由调用方回退网关）。 */
function buildOfficialLyricResult(body: WyLyricBody): OfficialLyricResult | null {
  // 占位歌词一律当「没有歌词」。
  //
  // 实测：云盘里未被匹配到在线曲目的条目歌词接口返回
  // `{ lrc: { lyric: "[00:00.00]暂无歌词" }, uncollected: true }`。原样返回会解析出
  // 一行「暂无歌词」冒充真歌词，既显示不出内容也不再走 builtinClient 兜底。
  if (body?.uncollected === true || body?.nolyric === true) return null;
  const yrc = body?.yrc?.lyric || "";
  const lyric = yrc || body?.lrc?.lyric || "";
  if (!lyric.trim()) return null;
  // yrc 为主轨时优先取与逐字轨对齐的 ytlrc / yromalrc，
  // 无对齐轨再退 lrc 对齐的 tlyric / romalrc；lrc 主轨则只用 tlyric / romalrc。
  const tlyric = (yrc
    ? body?.ytlrc?.lyric || body?.tlyric?.lyric
    : body?.tlyric?.lyric) || "";
  const romaLyric = (yrc
    ? body?.yromalrc?.lyric || body?.romalrc?.lyric
    : body?.romalrc?.lyric) || "";
  return {
    lyric,
    tlyric: tlyric.trim() ? tlyric : undefined,
    romaLyric: romaLyric.trim() ? romaLyric : undefined,
  };
}

/**
 * 云盘曲按元数据在线上找到**同一份录音**（与桌面 `wyProvider.getLyric` 同一条路径）。
 *
 * 云盘条目的数字 id 是「云盘条目 id」，服务端对它只回占位歌词；真正的歌词挂在线上
 * 曲目那条记录上。候选选择交给 `@lx/core` 的 `pickSameSongCandidate`——搜索会把翻唱
 * 排在官方曲前面（实测「雨下一整晚 周杰伦」前几条全是翻唱），宁可不给词也不能贴错词。
 */
async function findMatchedOnlineSong(song: MusicInfo): Promise<MusicInfo | null> {
  let candidates: MusicInfo[] = [];
  try {
    candidates = await searchWySongsViaCloudSearch(`${song.name} ${song.singer}`, 100);
  } catch {
    return null;
  }
  return pickSameSongCandidate(song, candidates);
}

/**
 * 网易云官方歌词直连（eapi /api/song/lyric/v1）。
 * 空歌词/无权限返回 null，由调用方回退网关。
 */
async function fetchWyOfficialLyric(song: MusicInfo): Promise<OfficialLyricResult | null> {
  const direct = buildOfficialLyricResult(await requestWyLyricBody(song.id));
  if (direct) return direct;
  // 只有云盘曲需要这一层：普通在线曲拿不到词就是真的没有。
  if (song.wyCloud !== true) return null;
  const matched = await findMatchedOnlineSong(song);
  if (!matched) return null;
  return buildOfficialLyricResult(await requestWyLyricBody(matched.id));
}

/**
 * QQ 音乐官方歌词直连（fcg_query_lyric_new，nobase64 明文返回）。
 * 空歌词/风控返回 null，由调用方回退网关。
 */
async function fetchTxOfficialLyric(song: MusicInfo): Promise<OfficialLyricResult | null> {
  const url =
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg` +
    `?songmid=${encodeURIComponent(song.id)}&format=json&nobase64=1`;
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Origin: "https://y.qq.com",
      Referer: "https://y.qq.com/",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`QQ 歌词直连 HTTP ${response.status}: ${text.slice(0, 160)}`);
  }
  const data = JSON.parse(text) as { lyric?: string; trans?: string };
  const lyric = data?.lyric || "";
  const tlyric = data?.trans || "";
  if (!lyric.trim()) return null;
  return { lyric, tlyric: tlyric.trim() ? tlyric : undefined };
}

export async function fetchSongLyrics(song: MusicInfo): Promise<LyricLine[]> {
  // 官方直连优先（wy eapi / tx fcg），失败或无歌词再走内置音乐 API 网关；
  // 其他源（tx 等）无官方歌词接口，直接走网关。local 由上层 getLyrics 处理。
  let lyricResult: { lyric?: string; tlyric?: string; romaLyric?: string } | null = null;
  try {
    lyricResult =
      song.source === "wy"
        ? await fetchWyOfficialLyric(song)
        : song.source === "tx"
          ? await fetchTxOfficialLyric(song)
          : null;
  } catch {
    lyricResult = null;
  }
  if (!lyricResult) {
    lyricResult = await builtinClient.getLyric(song);
  }
  const rawLyric = lyricResult.lyric ?? "";
  if (!rawLyric.trim()) return [];
  const lines = parseLyricSource({ type: "auto", content: rawLyric });
  return mergeRomanization(mergeTranslation(lines, lyricResult.tlyric), lyricResult.romaLyric);
}

/**
 * 解析播放 URL（简化版，供 playerService 使用）
 */
function getPlaybackCandidates(song: MusicInfo): MusicInfo[] {
  // 候选链唯一实现在 core（与播放链同一份去重/展开逻辑）。此处不传 pinnedKey：
  // parseUrl 是「按档位取一个可用 URL」的兜底枚举，不存在「把用户钉选的变体
  // 提前」的用户意图；带 pin 反而要为测试加载整条 store 依赖链。
  return orderPlaybackCandidates(song);
}

async function parseSingleUrl(song: MusicInfo, quality: string): Promise<{ url: string; quality: string }> {
  // wy / tx 等在线源：统一由内置音乐 API 网关解析播放地址（
  // 官方直连只负责搜索与歌单/封面/歌词元数据，播放与下载走内置音乐 API）。
  return await resolveSongUrl(song, quality);
}

/**
 * 返回网关实际给出的音质而非请求档位：竞速择优要按真实音质排序，
 * 请求 flac 但网关降级返回 320k 时不能记成 flac。
 */
export async function parseUrl(song: MusicInfo, quality = "320k"): Promise<{ url: string; quality: string }> {
  const errors: string[] = [];

  for (const candidate of getPlaybackCandidates(song)) {
    try {
      return await parseSingleUrl(candidate, quality);
    } catch (error) {
      errors.push(`${candidate.source}:${candidate.id} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join("\n") || "无法获取播放地址");
}

/**
 * 获取歌词（简化版，供 playerService 使用）
 */
export interface AppLyricLine {
  time: number;
  text: string;
  tr?: string;
  /** 按时间对齐的罗马音行（日文歌）；桌面端一直有，移动端此前在映射时被丢掉 */
  roma?: string;
}

export async function getLyrics(song: MusicInfo): Promise<AppLyricLine[]> {
  const localLyrics = song.localLyrics?.trim();
  if (song.source === "local" || song.isLocal) {
    // 本地 ID 没有在线语义；缺失资料由独立的只读匹配链处理。
    if (!localLyrics) return [];
    // 旁挂/手写的译文与罗马音跟主文本一样来自文件自身，解析后按时间对齐合并
    // （与桌面端 parseLocalLyricsText 同一套语义）。
    const parsed = parseLyricSource({ type: "auto", content: localLyrics });
    const merged = mergeRomanization(
      mergeTranslation(parsed, song.localLyricsTranslation),
      song.localLyricsRomanization,
    );
    const lines: LyricLine[] = merged.length > 0
      ? merged
      : localLyrics
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((text, index) => ({ time: index, text }));
    return lines.map((line) => ({ time: line.time, text: line.text, tr: line.tr, roma: line.roma }));
  }

  const lines = await fetchSongLyrics(song);
  return lines.map((line) => ({ time: line.time, text: line.text, tr: line.tr, roma: line.roma }));
}
