import type { MusicInfo } from "./sources/types";
import { normalizeArtist, splitSingerTokens, normalizeSongName, SONG_MATCH_INTERVAL_TOLERANCE } from "./song-variant";

/**
 * 隐藏兜底音源。
 *
 * 这些平台不出现在 UI 的来源标签里，也不参与常规搜索：只有当一首歌走完内置网关、
 * 自定义音源、官方直连全部失败后，才按「歌名 + 歌手」到这些平台搜索同名曲目兜底。
 *
 * 搜索由本模块原生实现（平台搜索接口可用），取链仍交给用户已导入的 LX 自定义音源
 * 脚本——LX 用户脚本只实现 musicUrl/lyric/pic，本身不能搜索，因此搜索与取链必须分开。
 */

export type HiddenSourceId = "kg" | "kw";

/** 隐藏平台搜索命中的曲目，字段只保留跨源匹配与取链所需的最小集合。 */
export interface HiddenSourceTrack {
  source: HiddenSourceId;
  /** 平台曲目 id：酷我 MUSIC_ 后的数字、酷狗 audio_id。 */
  id: string;
  name: string;
  singer: string;
  albumName?: string;
  /** 时长（秒），用于跨源严格匹配。 */
  interval?: number;
  picUrl?: string;
  /** 传给 LX 自定义音源脚本的额外字段（如酷狗的 hash、专辑 id）。 */
  extra?: Record<string, string | number>;
}

export interface HiddenSourceSearcher {
  readonly id: HiddenSourceId;
  search(keyword: string, limit?: number): Promise<HiddenSourceTrack[]>;
}

/** 文本 GET 注入点；桌面走浏览器 fetch/Tauri HTTP，移动端走 RN fetch。 */
export type FetchHiddenSourceText = (url: string) => Promise<string>;

const DEFAULT_SEARCH_LIMIT = 20;

/** 单平台最多保留的匹配候选，避免长列表里捞出边缘同名曲目。 */
const MAX_HIDDEN_CANDIDATES = 12;

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** 时长只接受正数；平台用 -1 / 0 表示未知时归一成缺失，避免误参与 5s 时长校验。 */
function toDuration(value: unknown): number | undefined {
  const parsed = asNumber(value);
  return parsed != null && parsed > 0 ? parsed : undefined;
}

/** 超出 Unicode 范围的实体编码返回空串，避免 String.fromCodePoint 抛 RangeError 吞掉整个平台结果。 */
function safeCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}

function decodeHtmlEntities(value: string): string {
  // 单趟替换：多趟链会把 `&amp;#39;`（本应解成字面文本）二次解码成 `'`，
  // 导致跨源匹配时歌名比对失真。
  return value.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#(\d+);|&#x([0-9a-f]+);/gi, (match, dec, hex) => {
    if (dec != null) return safeCodePoint(Number(dec));
    if (hex != null) return safeCodePoint(Number.parseInt(hex, 16));
    switch (match.toLowerCase()) {
      case "&nbsp;": return " ";
      case "&lt;": return "<";
      case "&gt;": return ">";
      case "&quot;": return '"';
      case "&amp;": default: return "&";
    }
  });
}

function mapKuwoTrack(item: Record<string, unknown>): HiddenSourceTrack | null {
  const name = decodeHtmlEntities(asString(item.SONGNAME).trim());
  if (!name) return null;
  const singer = decodeHtmlEntities((asString(item.ARTIST) || asString(item.FARTIST)).trim());
  const songId = asString(item.MUSICRID).replace(/^MUSIC_/, "") || asString(item.DC_TARGETID);
  if (!songId) return null;

  const albumId = asString(item.ALBUMID);
  const albumPic = asString(item.web_albumpic_short);
  return {
    source: "kw",
    id: songId,
    name,
    singer,
    albumName: decodeHtmlEntities(asString(item.ALBUM)) || undefined,
    interval: toDuration(item.DURATION),
    picUrl: albumPic ? `https://img1.kuwo.cn/star/albumcover/${albumPic.replace("120/", "500/")}` : undefined,
    extra: albumId ? { albumId, albumMid: albumId } : undefined,
  };
}

function mapKugouTrack(item: Record<string, unknown>): HiddenSourceTrack | null {
  const name = decodeHtmlEntities(asString(item.SongName).trim());
  const audioId = asString(item.Audioid);
  const hash =
    asString(item.FileHash) || asString(item.SQFileHash) || asString(item.HQFileHash);
  if (!name || !audioId || !hash) return null;

  const singers = Array.isArray(item.Singers)
    ? item.Singers
        .map((entry) => asString((entry as Record<string, unknown> | null)?.name))
        .filter(Boolean)
    : [];
  const albumId = asString(item.AlbumID);
  const image = asString(item.Image).replace("{size}", "480");
  return {
    source: "kg",
    id: audioId,
    name,
    singer: singers.join("、"),
    albumName: decodeHtmlEntities(asString(item.AlbumName)) || undefined,
    interval: toDuration(item.Duration),
    picUrl: image || undefined,
    extra: albumId ? { hash, albumId, albumMid: albumId } : { hash },
  };
}

/** 酷我搜索：接口直接返回 JSON，条目带 DURATION（秒）。 */
export function createKuwoHiddenSearcher(fetchText: FetchHiddenSourceText): HiddenSourceSearcher {
  return {
    id: "kw",
    async search(keyword, limit = DEFAULT_SEARCH_LIMIT) {
      const url =
        `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}` +
        `&pn=0&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1` +
        `&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012` +
        `&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
      const json = JSON.parse(await fetchText(url)) as { abslist?: unknown };
      if (!Array.isArray(json.abslist)) return [];
      return json.abslist
        .map((item) => mapKuwoTrack(item as Record<string, unknown>))
        .filter((track): track is HiddenSourceTrack => track != null);
    },
  };
}

/** 酷狗搜索：条目带 Duration（秒）与 FileHash，hash 是后续取链的必需字段。 */
export function createKugouHiddenSearcher(fetchText: FetchHiddenSourceText): HiddenSourceSearcher {
  return {
    id: "kg",
    async search(keyword, limit = DEFAULT_SEARCH_LIMIT) {
      const url =
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}` +
        `&page=1&pagesize=${limit}&userid=0&clientver=&platform=WebFilter` +
        `&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;
      const json = JSON.parse(await fetchText(url)) as { data?: { lists?: unknown } };
      const lists = Array.isArray(json.data?.lists) ? json.data.lists : [];

      const items: Record<string, unknown>[] = [];
      for (const raw of lists) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        items.push(item);
        if (Array.isArray(item.Grp)) {
          for (const child of item.Grp) {
            if (child && typeof child === "object") items.push(child as Record<string, unknown>);
          }
        }
      }

      return items
        .map(mapKugouTrack)
        .filter((track): track is HiddenSourceTrack => track != null);
    },
  };
}

/**
 * 伴奏 / 无人声版本的名称标记。
 *
 * 必须用平台原始歌名判断：`normalizeSongName` 会把括号整段剥掉，于是
 * 「江南 (自制版伴奏)」规整后与「江南」完全相等，能通过严格匹配。这类版本不是用户
 * 点的那首歌，只配当最后手段——排序时整体沉到人声版本之后，但不剔除：平台只收录
 * 伴奏时，能出声好过整首失败。
 */
const INSTRUMENTAL_NAME_PATTERN =
  /(伴奏|纯音乐|无人声|消音|卡拉\s*ok|伴唱版|instrumental|karaoke|off[\s_-]*vocal|backing\s*track|no\s*vocal|\binst\b)/i;

/** 歌名是否带伴奏/无人声标记（用于隐藏兜底的版本降权）。 */
export function isInstrumentalVersion(name: string): boolean {
  return INSTRUMENTAL_NAME_PATTERN.test(name.normalize("NFKC"));
}

/**
 * 从隐藏平台搜索结果中筛出可兜底的候选。
 *
 * 与 `isSameSong` 同语义：规整歌名相等 + 至少一位歌手重合 + 双方都有时长时差 ≤ 5s。
 * 隐藏平台是最后兜底，宁可少匹配也不能播错歌：时长缺失时只靠歌名+歌手，仍保留候选，
 * 由取链失败自然跳过。
 *
 * 排序按「版本 → 时长差 → 歌手精确度 → 平台顺序」：歌名会被规整掉括号，伴奏/无人声
 * 版本与正版同名，只能靠版本标记降权，避免时长恰好一致的伴奏抢到首位。用户点的歌
 * 本身就是伴奏时不降权，否则会把正确版本自己排到后面。
 *
 * 平台常对同一首歌返回多条（不同码率/版本条目），匹配通过后按 `source:id` 去重，
 * 避免对同一曲重复调用 LX 脚本。
 */
export function matchHiddenCandidates(
  song: Pick<MusicInfo, "name" | "singer" | "interval">,
  tracks: HiddenSourceTrack[],
  maxCandidates = MAX_HIDDEN_CANDIDATES,
): HiddenSourceTrack[] {
  const targetName = normalizeSongName(song.name);
  const targetTokens = splitSingerTokens(song.singer);
  if (!targetName || targetTokens.length === 0) return [];

  const targetSinger = normalizeArtist(song.singer);
  const targetIsInstrumental = isInstrumentalVersion(song.name);
  const seen = new Set<string>();
  return tracks
    .filter((track) => {
      if (normalizeSongName(track.name) !== targetName) return false;
      const tokens = splitSingerTokens(track.singer);
      if (!tokens.some((token) => targetTokens.includes(token))) return false;
      if (song.interval != null && song.interval > 0 && track.interval != null && track.interval > 0) {
        if (Math.abs(song.interval - track.interval) > SONG_MATCH_INTERVAL_TOLERANCE) return false;
      }
      // 去重放在所有匹配条件之后：同 id 的第一条可能是错误版本（歌手/时长不符），
      // 若先登记 id，后面真正匹配的那条会被误丢。
      const key = `${track.source}:${track.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((track, index) => ({
      track,
      index,
      // 0 = 可用版本，1 = 伴奏；只有「用户要的不是伴奏」时才对伴奏记惩罚
      instrumentalPenalty: !targetIsInstrumental && isInstrumentalVersion(track.name) ? 1 : 0,
      durationDelta:
        song.interval != null && song.interval > 0 && track.interval != null && track.interval > 0
          ? Math.abs(song.interval - track.interval)
          : Number.MAX_SAFE_INTEGER,
      exactSinger: normalizeArtist(track.singer) === targetSinger,
    }))
    .sort((a, b) => {
      if (a.instrumentalPenalty !== b.instrumentalPenalty) {
        return a.instrumentalPenalty - b.instrumentalPenalty;
      }
      if (a.durationDelta !== b.durationDelta) return a.durationDelta - b.durationDelta;
      if (a.exactSinger !== b.exactSinger) return a.exactSinger ? -1 : 1;
      return a.index - b.index;
    })
    .slice(0, maxCandidates)
    .map((entry) => entry.track);
}
