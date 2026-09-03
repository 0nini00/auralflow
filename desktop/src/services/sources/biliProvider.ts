import type { MusicInfo, MusicSource, PlaylistInfo, SearchResult, SearchType } from "@lx/core";
import { getBiliAudioUrl, pickBiliDashAudioByQuality, type BiliDashAudioLike } from "@lx/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { biliCacheAudio, biliGetJson } from "@lx/tauri-bridge";
import CryptoJS from "crypto-js";
import { getBiliCookie, getBiliCollectionSongs, type BiliCollectionInfo } from "@/services/biliAccountService";

interface BiliWbiKeys {
  imgKey: string;
  subKey: string;
  updatedAt: number;
}

interface BiliVideoPage {
  cid?: number;
  page?: number;
}

interface BiliMusicExtra extends MusicInfo {
  aid?: string;
  bvid?: string;
  cid?: string;
}

interface BiliDashAudio {
  id?: number | string;
  baseUrl?: string;
  base_url?: string;
  bandwidth?: number;
}

interface BiliPlayUrlData {
  dash?: {
    audio?: BiliDashAudio[];
    flac?: { audio?: BiliDashAudio };
  };
}

const WBI_KEY_TTL_MS = 12 * 60 * 60 * 1000;
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

let cachedWbiKeys: BiliWbiKeys | null = null;

function getMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((index) => raw[index] ?? "").join("").slice(0, 32);
}

function encodeWbiValue(value: unknown): string {
  return encodeURIComponent(String(value).replace(/[!'()*]/g, ""));
}

export function encWbi(params: Record<string, string | number | boolean>, imgKey: string, subKey: string): string {
  const signedParams: Record<string, string | number | boolean> = {
    ...params,
    wts: Math.round(Date.now() / 1000),
  };
  const query = Object.keys(signedParams)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeWbiValue(signedParams[key])}`)
    .join("&");
  const wRid = CryptoJS.MD5(query + getMixinKey(imgKey, subKey)).toString();
  return `${query}&w_rid=${wRid}`;
}

function getBvid(music: MusicInfo): string {
  const extra = music as BiliMusicExtra;
  return extra.bvid || music.id;
}

function getAid(music: MusicInfo): string {
  const extra = music as BiliMusicExtra;
  return extra.aid || "";
}

function getVideoReferer(bvid: string, aid: string): string {
  return bvid ? `https://www.bilibili.com/video/${bvid}` : `https://www.bilibili.com/video/av${aid}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function biliFetchJson<T>(url: string, referer = "https://www.bilibili.com/"): Promise<T> {
  const cookie = await getBiliCookie();
  const body = await biliGetJson<{ code: number; message?: string; data?: T }>({
    url,
    cookie: cookie || null,
    referer,
  });
  if (body.code !== 0) throw new Error(body.message || `B站接口返回 code=${body.code}`);
  return body.data as T;
}

async function getWbiKeys(force = false): Promise<BiliWbiKeys> {
  const now = Date.now();
  if (!force && cachedWbiKeys && now - cachedWbiKeys.updatedAt < WBI_KEY_TTL_MS) {
    return cachedWbiKeys;
  }

  const data = await biliFetchJson<{ wbi_img?: { img_url?: string; sub_url?: string } }>("https://api.bilibili.com/x/web-interface/nav");
  const imgUrl = data?.wbi_img?.img_url ?? "";
  const subUrl = data?.wbi_img?.sub_url ?? "";
  const imgKey = imgUrl.split("/").pop()?.split(".")[0] ?? "";
  const subKey = subUrl.split("/").pop()?.split(".")[0] ?? "";
  if (!imgKey || !subKey) throw new Error("B站未返回 WBI 签名参数");

  cachedWbiKeys = { imgKey, subKey, updatedAt: now };
  return cachedWbiKeys;
}

async function getVideoCid(music: MusicInfo): Promise<string> {
  const extra = music as BiliMusicExtra;
  if (extra.cid) return String(extra.cid);

  const bvid = getBvid(music);
  const aid = getAid(music);
  const params = new URLSearchParams();
  if (bvid) params.set("bvid", bvid);
  if (!bvid && aid) params.set("aid", aid);
  if (!params.toString()) throw new Error("B站歌曲缺少 bvid/aid");

  const data = await biliFetchJson<{ pages?: BiliVideoPage[] }>(`https://api.bilibili.com/x/web-interface/view?${params.toString()}`, getVideoReferer(bvid, aid));
  const cid = data?.pages?.[0]?.cid;
  if (!cid) throw new Error("B站未返回视频 cid");
  extra.cid = String(cid);
  return String(cid);
}

/**
 * 按目标音质从 DASH 流里选最优音频。
 * 映射规则在 @lx/core bili-quality(30232=128k/30280=192k/30250=320k/30251=Hi-Res)。
 */
function selectDashAudioByQuality(data: BiliPlayUrlData, quality?: string): BiliDashAudio | null {
  const audioList = data?.dash?.audio ?? [];
  if (!audioList.length) return null;
  const list = audioList as BiliDashAudioLike[];
  const picked = pickBiliDashAudioByQuality(list, (quality ?? "320k") as never);
  if (picked) return picked as BiliDashAudio;
  const fallback = list.find((audio) => getBiliAudioUrl(audio));
  return (fallback as BiliDashAudio | undefined) ?? null;
}

function getDashAudioUrl(audio: BiliDashAudio | null): string {
  return getBiliAudioUrl(audio as BiliDashAudioLike | null);
}

async function resolveLegacyPlayUrl(bvid: string, aid: string, cid: string, referer: string, quality?: string): Promise<string> {
  const params = new URLSearchParams();
  if (bvid) params.set("bvid", bvid);
  if (!bvid && aid) params.set("aid", aid);
  params.set("cid", cid);
  params.set("qn", "64");
  params.set("fnval", "16");
  params.set("fnver", "0");
  params.set("fourk", "0");

  const data = await biliFetchJson<BiliPlayUrlData>(`https://api.bilibili.com/x/player/playurl?${params.toString()}`, referer);
  const rawUrl = getDashAudioUrl(selectDashAudioByQuality(data, quality));
  if (!rawUrl) throw new Error("普通 playurl 未返回音频流");
  return rawUrl;
}

async function resolveWbiPlayUrl(bvid: string, aid: string, cid: string, referer: string, quality?: string): Promise<string> {
  const keys = await getWbiKeys();
  const signedQuery = encWbi({
    ...(bvid ? { bvid } : { aid }),
    cid,
    qn: 0,
    fnver: 0,
    fnval: 4048,
    fourk: 1,
  }, keys.imgKey, keys.subKey);

  const data = await biliFetchJson<BiliPlayUrlData>(
    `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`,
    referer,
  );
  const rawUrl = getDashAudioUrl(selectDashAudioByQuality(data, quality));
  if (!rawUrl) throw new Error("WBI playurl 未返回音频流");
  return rawUrl;
}

async function resolveBiliPlaybackUrl(bvid: string, aid: string, cid: string, referer: string, quality?: string): Promise<string> {
  const errors: string[] = [];

  try {
    return await resolveLegacyPlayUrl(bvid, aid, cid, referer, quality);
  } catch (error) {
    errors.push(`普通 playurl: ${getErrorMessage(error)}`);
  }

  try {
    return await resolveWbiPlayUrl(bvid, aid, cid, referer, quality);
  } catch (error) {
    errors.push(`WBI playurl: ${getErrorMessage(error)}`);
  }

  throw new Error(`B站播放地址解析失败：${errors.join("；")}`);
}

async function fetchBiliMusicUrl(music: MusicInfo, quality?: string): Promise<string | null> {
  const bvid = getBvid(music);
  const aid = getAid(music);
  const cid = await getVideoCid(music);
  const referer = getVideoReferer(bvid, aid);
  const rawUrl = await resolveBiliPlaybackUrl(bvid, aid, cid, referer, quality);

  const cookie = await getBiliCookie();
  const cachePath = await biliCacheAudio({
    url: rawUrl,
    referer,
    cookie: cookie || null,
    cacheKey: CryptoJS.MD5(`${bvid}:${cid}:${rawUrl}`).toString(),
  });
  return convertFileSrc(cachePath);
}

/**
 * 拉取 B站视频 CC 字幕并转成 LRC 歌词文本。
 * 无字幕/失败返回 null,由调用方走外部歌词兜底。
 */
async function fetchBiliCcSubtitleLyric(music: MusicInfo): Promise<string | null> {
  try {
    const bvid = getBvid(music);
    const cid = await getVideoCid(music);
    if (!bvid || !cid) return null;
    const referer = getVideoReferer(bvid, getAid(music));

    let subtitleUrl: string | undefined;
    try {
      const keys = await getWbiKeys();
      const signed = encWbi({ bvid, cid, qn: 80, fnval: 4048, fnver: 0, fourk: 1 }, keys.imgKey, keys.subKey);
      const player = await biliFetchJson<{ subtitle?: { subtitles?: Array<{ subtitle_url?: string; subtitle_url_v2?: string }> } }>(
        `https://api.bilibili.com/x/player/wbi/v2?${signed}`,
        referer,
      );
      const sub = player?.subtitle?.subtitles?.[0];
      subtitleUrl = sub?.subtitle_url || sub?.subtitle_url_v2;
    } catch {
      return null;
    }
    if (!subtitleUrl) return null;

    const normalized = subtitleUrl.startsWith("//") ? `https:${subtitleUrl}` : subtitleUrl;
    const data = await biliFetchJson<{ body?: Array<{ from?: number; content?: string }> }>(normalized, referer);
    const body = Array.isArray(data?.body) ? data.body : [];
    if (!body.length) return null;

    const lines = body.map((item) => {
      const text = String(item.content || "").replace(/^[♪♫]+|[♪♫]+$/g, "").trim();
      if (!text) return "";
      const sec = Number(item.from) || 0;
      const ms = Math.max(0, Math.round(sec * 1000));
      const m = Math.floor(ms / 60000);
      const s2 = Math.floor((ms % 60000) / 1000);
      const cs = Math.floor((ms % 1000) / 10);
      return `[${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}.${String(cs).padStart(2, "0")}]${text}`;
    }).filter(Boolean).join("\n");
    return lines || null;
  } catch {
    return null;
  }
}

export const biliProvider: MusicSource = {
  id: "bili",
  name: "哔哩哔哩",
  supportedSearchTypes: [],

  async search(_keyword: string, _type: SearchType, _page = 1): Promise<SearchResult> {
    return {};
  },

  async getMusicUrl(music: MusicInfo, quality?: string): Promise<string | null> {
    return fetchBiliMusicUrl(music, quality);
  },

  async getMusicDetail(music: MusicInfo): Promise<MusicInfo> {
    return music;
  },

  async getLyric(music: MusicInfo) {
    const ccLyric = await fetchBiliCcSubtitleLyric(music);
    if (ccLyric) return { lyric: ccLyric, tlyric: undefined, message: "" };
    return { lyric: undefined, tlyric: undefined, message: "暂无歌词" };
  },

  async getPlaylistDetail(playlist: PlaylistInfo): Promise<MusicInfo[]> {
    return getBiliCollectionSongs(playlist as BiliCollectionInfo);
  },
};
