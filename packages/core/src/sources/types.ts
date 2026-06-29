/**
 * 应用 UI 只展示两个来源：网易云（wy）和 QQ 音乐（tx）。
 * 自定义音源、API 网关是内部解析机制，不扩展 UI 来源数量。
 */
export type SourceTag = "wy" | "tx" | "local";

export type SearchType = "song" | "playlist" | "album" | "singer";

export interface MusicGatewayInfo {
  /** 内置音乐 API 的真实来源，不参与 UI 来源展示 */
  source: string;
  trackId: string;
  lyricId?: string;
  picId?: string;
}

export interface MusicInfo {
  id: string;
  name: string;
  singer: string;
  albumName: string;
  /** UI 展示的来源标签 */
  source: SourceTag;
  interval?: number;
  quality?: string;
  /** 封面图 URL，由 provider 填充（wy/tx 使用 img 别名兼容） */
  picUrl?: string;
  /** @deprecated 使用 picUrl，保留此字段用于向后兼容 */
  img?: string;
  /** 本地音乐文件 URL（PlayerBar/LibraryView 使用） */
  url?: string;
  /** 标记为本地音乐（PlayerBar/LibraryView 使用） */
  isLocal?: boolean;
  /** 内置音乐 API 解析元数据；source 仍保持 wy/tx/local 作为 UI 来源 */
  gateway?: MusicGatewayInfo;
}

export interface PlaylistInfo {
  id: string;
  name: string;
  author: string;
  picUrl?: string;
  desc?: string;
  playCount?: number;
  trackCount?: number;
  source: SourceTag;
}

export interface ArtistInfo {
  id: string;
  name: string;
  picUrl?: string;
  alias?: string[];
  /** 累计音乐作品数（仅搜索结果会带） */
  musicSize?: number;
  /** 累计专辑数（仅搜索结果会带） */
  albumSize?: number;
  source: SourceTag;
}

export interface AlbumInfo {
  id: string;
  name: string;
  picUrl?: string;
  artist: string;
  artistId?: string;
  publishTime?: number;
  trackCount?: number;
  source: SourceTag;
}

export interface LyricResult {
  lyric?: string;
  tlyric?: string;
  romaLyric?: string;
  /** 网易云逐字歌词（yrc 原始串） */
  yrc?: string;
}

export interface SearchResult {
  songs?: MusicInfo[];
  playlists?: PlaylistInfo[];
  artists?: ArtistInfo[];
  albums?: AlbumInfo[];
}

/**
 * 音源 Provider 接口。
 * id 不一定是 SourceTag：自定义源、网关 provider 可能有内部 id，
 * 但它们解析出的 MusicInfo.source 必须是 wy/tx 之一。
 */
export interface MusicSource {
  readonly id: string;
  readonly name: string;
  readonly supportedSearchTypes: SearchType[];

  search(keyword: string, type: SearchType, page?: number): Promise<SearchResult>;
  getMusicUrl(music: MusicInfo, quality?: string): Promise<string | null>;
  getMusicDetail(music: MusicInfo): Promise<MusicInfo>;
  getLyric(music: MusicInfo): Promise<LyricResult>;
  getPlaylistDetail(playlist: PlaylistInfo): Promise<MusicInfo[]>;
}
