import {
  createBuiltinMusicApiClient,
  getBuiltinMusicApiGateway,
  mergeTranslation,
  parseLyricSource,
  type LyricLine,
  type MusicInfo,
  type SourceTag,
} from "@lx/core";
import { resolveBiliSongUrl, searchBiliVideos } from "./biliService";
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

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 30;

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

export type SearchSource = "all" | Extract<SourceTag, "wy" | "tx" | "bili">;

export interface SongComment {
  id: string;
  content: string;
  userId: string;
  nickname: string;
  avatarUrl?: string;
  likedCount: number;
  createdAt: number;
  beReplied?: Array<{ nickname: string; content: string }>;
}

export interface SongCommentResult {
  total: number;
  comments: SongComment[];
}

/** 网易云歌单评论标识前缀（歌曲资源 R_SO_4_<songId>） */
const SONG_COMMENT_RESOURCE_PREFIX = "R_SO_4_";

/**
 * 拉取网易云歌曲评论（对齐 lx「评论」：头像/昵称/点赞/内容/时间）。
 * 仅网易云（wy）曲目有真实评论 ID，tx/bili/local 无数据则不调用。
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
  let response: string;
  let data: Record<string, any>;
  try {
    response = await fetchText(url);
    data = JSON.parse(response) as Record<string, any>;
  } catch (error) {
    // 评论接口失败（风控/非 JSON）不应阻断，返回空列表（与搜索各分类的 allSettled 语义一致）
    return { total: 0, comments: [] };
  }
  const comments = Array.isArray(data.comments) ? data.comments : [];
  return {
    total: Number(data.total ?? comments.length),
    comments: comments.map((item: any) => ({
      id: String(item.commentId ?? item.id),
      content: item.content ?? "",
      userId: String(item.user?.userId ?? ""),
      nickname: item.user?.nickname ?? "未知用户",
      avatarUrl: item.user?.avatarUrl ?? "",
      likedCount: Number(item.likedCount ?? 0),
      createdAt: Number(item.time ?? 0),
      beReplied: Array.isArray(item.beReplied)
        ? item.beReplied
            .filter((reply: any) => reply?.user)
            .map((reply: any) => ({
              nickname: reply.user.nickname ?? "",
              content: reply.content ?? "",
            }))
        : undefined,
    })),
  };
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

export function toApiSource(source: Extract<SourceTag, "wy" | "tx">): string {
  return source === "wy" ? "netease" : "joox";
}

function formatDate(value?: number | string): string | undefined {
  if (!value) return undefined;
  const date = new Date(typeof value === "string" ? Number(value) : value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

async function searchNeteaseArtists(keyword: string): Promise<SearchArtistResult[]> {
  const response = await fetchText(
    `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=100&offset=0&total=true&limit=${DEFAULT_LIMIT}`
  );
  const data = JSON.parse(response) as Record<string, any>;
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

async function searchNeteaseAlbums(keyword: string): Promise<SearchAlbumResult[]> {
  const response = await fetchText(
    `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=10&offset=0&total=true&limit=${DEFAULT_LIMIT}`
  );
  const data = JSON.parse(response) as Record<string, any>;
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

async function searchNeteasePlaylists(keyword: string): Promise<SearchPlaylistResult[]> {
  const response = await fetchText(
    `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=1000&offset=0&total=true&limit=${DEFAULT_LIMIT}`
  );
  const data = JSON.parse(response) as Record<string, any>;
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
): Promise<MusicInfo[]> {
  // 直连路径是网关挂掉时的完整兑底 + 元数据补全源，拉取量与桌面端对齐（wy 100 / tx 50）
  if (source === "wy") {
    return searchWySongsViaCloudSearch(keyword, 100);
  }
  return searchTxSongs(keyword, 50);
}

/**
 * 歌曲搜索（对齐 lx：官方接口直连优先，快）：
 * 1. 官方直连搜索（wy eapi cloudsearch / tx musicu），元数据（封面/歌手/专辑）由官方接口直接提供；
 * 2. 直连失败 → 回退内置音乐 API 网关搜索（仅作兜底）；
 * 3. 两者都失败 → 抛错（含两条链路的失败原因）。
 *
 * 注：此前网关优先 + 串行直连补全导致搜索明显慢于 lx（第三方网关延迟 + 两个请求串行），
 * 已改为直连优先；内置音乐 API 的职责收敛为播放 + 下载。
 */
export async function searchSongs(
  source: Extract<SourceTag, "wy" | "tx">,
  keyword: string,
): Promise<MusicInfo[]> {
  // 优先查缓存，命中则直接返回
  const cached = getCachedResult<MusicInfo[]>(source, keyword, SONGS_CACHE_NAMESPACE);
  if (cached) return cached;

  const cacheAndReturn = (songs: MusicInfo[]): MusicInfo[] => {
    setCachedResult(source, keyword, songs, SONGS_CACHE_NAMESPACE);
    return songs;
  };

  let apiError: unknown;
  try {
    const directSongs = await searchDirectSongs(source, keyword);
    if (directSongs.length > 0) return cacheAndReturn(directSongs);
  } catch (error) {
    apiError = error;
  }

  try {
    const apiSongs = await builtinClient.searchSongs(
      toApiSource(source),
      keyword,
      DEFAULT_PAGE,
      DEFAULT_LIMIT,
      source,
    );
    if (apiSongs.length > 0) return cacheAndReturn(apiSongs);
  } catch (fallbackError) {
    if (!apiError) throw fallbackError;
    const apiMessage = apiError instanceof Error ? apiError.message : String(apiError);
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(`官方直连搜索失败：${apiMessage}\n内置音乐 API 搜索失败：${fallbackMessage}`);
  }

  throw new Error("搜索无结果");
}

/** searchAll 缓存命名空间 */
const ALL_CACHE_NAMESPACE = "all";

export async function searchAll(source: SearchSource, keyword: string): Promise<SearchResults> {
  // 优先查缓存，命中则直接返回（searchSongs 内部也会命中各自缓存）
  const cached = getCachedResult<SearchResults>(source, keyword, ALL_CACHE_NAMESPACE);
  if (cached) return cached;

  // B站搜索：单独走 B站视频搜索接口
  if (source === "bili") {
    const biliSongs = await searchBiliVideos(keyword);
    const finalResults: SearchResults = {
      songs: biliSongs,
      artists: [],
      albums: [],
      playlists: [],
    };
    setCachedResult(source, keyword, finalResults, ALL_CACHE_NAMESPACE);
    return finalResults;
  }

  // 综合搜索合并网易云与 QQ 音乐；单来源搜索只查询当前来源，避免来源切换后混入其他平台歌曲。
  const sources: Array<Extract<SourceTag, "wy" | "tx">> = source === "all" ? ["wy", "tx"] : [source];
  const songResults = await Promise.allSettled(
    sources.map((src) => searchSongs(src, keyword))
  );
  const songs: MusicInfo[] = [];
  for (let i = 0; i < songResults.length; i += 1) {
    const result = songResults[i];
    if (result.status !== "fulfilled") continue;
    songs.push(...result.value);
  }
  const mergedSongs = mergeDuplicateSongs(songs);

  let finalResults: SearchResults;
  if (source === "all") {
    const [artistsResult, albumsResult, wyPlaylistsResult, txPlaylistsResult] = await Promise.allSettled([
      searchNeteaseArtists(keyword),
      searchNeteaseAlbums(keyword),
      searchNeteasePlaylists(keyword),
      searchTxPlaylists(keyword),
    ]);

    finalResults = {
      songs: mergedSongs,
      artists: artistsResult.status === "fulfilled" ? artistsResult.value : [],
      albums: albumsResult.status === "fulfilled" ? albumsResult.value : [],
      playlists: [
        ...(wyPlaylistsResult.status === "fulfilled" ? wyPlaylistsResult.value : []),
        ...(txPlaylistsResult.status === "fulfilled" ? txPlaylistsResult.value : []),
      ],
    };
  } else
  if (source === "wy") {
    // 与 all 分支一致用 allSettled：某个分类接口返回风控页/非 JSON 时，
    // 不应让整个 wy 综合搜索 reject（歌曲结果此时已拿到）。
    const [artistsResult, albumsResult, playlistsResult] = await Promise.allSettled([
      searchNeteaseArtists(keyword),
      searchNeteaseAlbums(keyword),
      searchNeteasePlaylists(keyword),
    ]);

    finalResults = {
      songs: mergedSongs,
      artists: artistsResult.status === "fulfilled" ? artistsResult.value : [],
      albums: albumsResult.status === "fulfilled" ? albumsResult.value : [],
      playlists: playlistsResult.status === "fulfilled" ? playlistsResult.value : [],
    };
  } else {
    // 与 wy 分支一致用 allSettled：歌单接口返回风控页/非 JSON 时，
    // 不应让整个 tx 综合搜索 reject（歌曲结果此时已拿到）。
    const playlistsResult = await Promise.allSettled([searchTxPlaylists(keyword)]);
    finalResults = {
      songs: mergedSongs,
      artists: [],
      albums: [],
      playlists: playlistsResult[0]?.status === "fulfilled" ? playlistsResult[0].value : [],
    };
  }

  // 写入缓存
  setCachedResult(source, keyword, finalResults, ALL_CACHE_NAMESPACE);
  return finalResults;
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

/** 在线音频流统一浏览器 UA（CDN 防盗链要求，对齐桌面端 lx-music）。 */
export const STREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * wy/tx 音源 CDN 防盗链请求头：网易云 CDN 需 Referer: https://music.163.com，
 * 腾讯 CDN 需 Referer: https://y.qq.com，缺失时 CDN 返回 403。
 * B站音源由 biliService 返回专用 referer，不走此函数。
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

/** 官方歌词直连结果（原文 + 可选翻译） */
interface OfficialLyricResult {
  lyric: string;
  tlyric?: string;
}

/**
 * 网易云官方歌词直连（eapi /api/song/lyric/v1）。
 * 空歌词/无权限返回 null，由调用方回退网关。
 */
async function fetchWyOfficialLyric(song: MusicInfo): Promise<OfficialLyricResult | null> {
  const body = (await postWyEapi("/api/song/lyric/v1", {
    id: Number(song.id),
    cp: false,
    tv: -1,
    lv: -1,
    rv: -1,
    kv: -1,
    yv: -1,
    ytv: -1,
    yrv: -1,
  })) as { yrc?: { lyric?: string }; lrc?: { lyric?: string }; tlyric?: { lyric?: string } };
  const lyric = body?.yrc?.lyric || body?.lrc?.lyric || "";
  const tlyric = body?.tlyric?.lyric || "";
  if (!lyric.trim()) return null;
  return { lyric, tlyric: tlyric.trim() ? tlyric : undefined };
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
  // 其他源（bili 等）无官方歌词接口，直接走网关。local 由上层 getLyrics 处理。
  let lyricResult: { lyric?: string; tlyric?: string } | null = null;
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
  return mergeTranslation(lines, lyricResult.tlyric);
}

/**
 * 解析播放 URL（简化版，供 playerService 使用）
 */
function getPlaybackCandidates(song: MusicInfo): MusicInfo[] {
  const candidates = [song];
  const variants = (song as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return candidates;

  const seen = new Set<string>([`${song.source}:${song.id}`]);
  for (const variant of variants) {
    const item = variant as MusicInfo;
    if (!item?.source || !item.id) continue;
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(item);
  }
  return candidates;
}

async function parseSingleUrl(song: MusicInfo, quality: string): Promise<{ url: string; quality: string }> {
  // B站歌曲走专用解析流程
  if (song.source === "bili") {
    const result = await resolveBiliSongUrl(song);
    // bili 无音质分层，按请求档位回填，避免竞速择优时被当成未知音质
    return { url: result.url, quality };
  }
  // wy / tx 等在线源：统一由内置音乐 API 网关解析播放地址（对齐 lx 分工：
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
export async function getLyrics(song: MusicInfo): Promise<Array<{ time: number; text: string; tr?: string }>> {
  const localLyrics = song.localLyrics?.trim();
  if (song.source === "local" && localLyrics) {
    const parsed = parseLyricSource({ type: "auto", content: localLyrics });
    const lines: LyricLine[] = parsed.length > 0
      ? parsed
      : localLyrics
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((text, index) => ({ time: index, text }));
    return lines.map((line) => ({
      time: line.time,
      text: line.text,
      tr: line.tr,
    }));
  }

  const lines = await fetchSongLyrics(song);
  return lines.map((line) => ({
    time: line.time,
    text: line.text,
    tr: line.tr,
  }));
}
