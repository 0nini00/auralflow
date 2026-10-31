/**
 * 应用 UI 展示内置平台来源：网易云（wy）、QQ 音乐（tx）、本地（local）。
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

/**
 * QQ 音乐取链所需的平台元数据。
 *
 * lx 自定义音源脚本按 lx-music 协议消费 musicInfo，tx 取链依赖 strMediaMid
 * 拼文件名（M500{mid}.mp3 / F000{mid}.flac）。只传 songmid 时脚本拿不到
 * 媒体标识，解析必然失败——这是移动端与桌面端 lx 源都播不了 tx 的根因。
 * 提取函数见 ./tx-meta.ts。
 */
export interface TxTrackMeta {
  /** file.media_mid，取链拼文件名用 */
  strMediaMid?: string;
  /** 专辑 mid；lx 的 musicInfo 里 albumId 存的也是它 */
  albumMid?: string;
  /** QQ 数字 songId。MusicInfo.id 存的是字符串 songmid，两者不可混用 */
  songId?: string;
}

export interface MusicInfo {
  id: string;
  name: string;
  singer: string;
  artistId?: string;
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
  /** 桌面本地文件路径，仅用于读取本地标签，不作为网络地址。 */
  localPath?: string;
  /** 移动端应用内管理的本地歌词文本，不表示已写回音频文件 */
  localLyrics?: string;
  localLyricsTranslation?: string;
  localLyricsRomanization?: string;
  /** 网易云关联 MV 的稳定标识，不包含临时播放地址 */
  mvId?: string;
  /** 内置音乐 API 解析元数据；source 仍保持 wy/tx/local 作为 UI 来源 */
  gateway?: MusicGatewayInfo;
  /** QQ 音乐取链元数据，传给 lx 自定义音源脚本；仅 source === "tx" 时存在 */
  txMeta?: TxTrackMeta;
  /**
   * 网易云「音乐云盘」条目。
   *
   * 云盘曲复用在线曲那套数字 id 与同一个播放地址接口，但**取链行为不同**：
   * `/song/enhance/player/url/v1` 对云盘曲不做转码——无论请求哪个 `level`，
   * 返回的都是上传文件原样（实测请求 exhigh，拿到的 level 是 lossless /
   * hires / standard，全看文件本身码率）。由此两端播放链路必须做两件与
   * 普通在线曲不同的事：
   *
   * 1. **跳过网关与自定义源**：云盘文件不在任何第三方源库里，`gdstudio`
   *    网关因缺 `gateway` 元数据必然失败，自定义源脚本也只会白跑一轮。
   * 2. **跳过按标称码率做的试听判定**：`isPreviewStream` 用「请求档位的标称
   *    码率」估算时长，而云盘返回的是原文件码率；128k 的 3.4MB / 223s 上传，
   *    在 flac 档会被估算成 32s（低于 60s 阈值）而误判成试听片段。
   */
  wyCloud?: boolean;
  /** 云盘条目自身的文件信息；仅 `wyCloud === true` 时存在 */
  cloudMeta?: MusicCloudMeta;
}

/** 云盘条目的文件与匹配信息，由云盘列表接口填充，供 UI 展示与歌词策略使用。 */
export interface MusicCloudMeta {
  /** 上传文件的真实码率（kbps）。与请求档位无关，云盘不做转码。 */
  bitrate?: number;
  /** 上传时的原始文件名 */
  fileName?: string;
  /** 文件字节数 */
  size?: number;
  /**
   * 网易云是否把这次上传匹配到了在线曲目。
   *
   * `matched`：同时是线上可搜索曲目，详情/歌词/封面都能按 id 取到；
   * `unmatched`：仅自己可见，`cloudsearch` 命中不到自己，歌词接口只回空壳。
   */
  matchStatus?: "matched" | "unmatched";
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
  /** 网易云逐字歌词对应的翻译轨（ytlrc，与 yrc 时间轴对齐；lx-music-desktop 同款分工） */
  ytlyric?: string;
  romaLyric?: string;
  /** 网易云逐字歌词对应的罗马音轨（yromalrc，与 yrc 时间轴对齐） */
  yromaLyric?: string;
  /** 网易云逐字歌词（yrc 原始串） */
  yrc?: string;
  /** QQ 音乐逐字歌词（qrc 原始串） */
  qrc?: string;
  /** 酷狗逐字歌词（krc 原始串，可能是密文） */
  krc?: string;
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
 * 但它们解析出的 MusicInfo.source 必须是已知 UI 来源之一。
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
