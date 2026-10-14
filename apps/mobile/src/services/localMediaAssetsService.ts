import type { LyricLine, MusicInfo } from "@lx/core";
import type { LocalMusicInfo } from "./localMusicScanModel";
import type { LocalMediaAssets } from "./localMediaSearchService";

export interface LocalAudioAssets {
  signature: string;
  lyrics?: string;
  coverUri?: string;
  warnings: string[];
}
export interface LocalMediaCache {
  version: 1;
  cachedAt: number;
  lyrics: LyricLine[];
  coverUri?: string;
  candidate?: LocalMediaAssets["candidate"];
  // 歌词来源标注（同曲异唱 / LRCLIB）。旧缓存没有这个可选字段，读出来只是「没有可标注的来源」，
  // 结构与语义仍然兼容，因此不升版本、不改缓存键：升版本会让所有既有缓存一次性失效。
  lyricOrigin?: LocalMediaAssets["lyricOrigin"];
}
export interface LocalMediaResult {
  status: "loading" | "local" | "cached" | "matched" | "partial" | "not-found" | "ambiguous" | "error";
  lyrics: LyricLine[];
  coverUri?: string;
  message: string;
  issues: string[];
  // 同曲异唱必须让 UI 标注「歌词来自谁的演唱版本」，不能静默；LRCLIB 来源同样标注。
  lyricOrigin?: LocalMediaAssets["lyricOrigin"];
}
interface Dependencies {
  readLocal: (song: MusicInfo) => Promise<LocalAudioAssets>;
  readCache: (key: string) => Promise<LocalMediaCache | null>;
  writeCache: (key: string, value: LocalMediaCache, isCurrent: () => boolean) => Promise<void>;
  cover: (uri: string) => Promise<string | undefined>;
  parse: (raw: string) => Promise<LyricLine[]>;
  search: (song: MusicInfo, needs: { lyrics: boolean; cover: boolean }) => Promise<LocalMediaAssets>;
  now: () => number;
}
export function localMediaInputKey(song: MusicInfo): string {
  const fields = (song as MusicInfo & { localEditedFields?: string[] }).localEditedFields;
  return JSON.stringify([song.source, song.id, song.url, song.name, song.singer, song.albumName,
    song.interval, song.localLyrics, song.picUrl, song.img, fields, (song as LocalMusicInfo).localOrigin]);
}
const candidateKey = (value: NonNullable<LocalMediaAssets["candidate"]>) => JSON.stringify([
  value.source, value.id, value.name, value.singer, value.gatewaySource, value.gatewayTrackId,
]);
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 所有补全都是派生缓存；永远不修改传入歌曲、曲库记录或原始音频。 */
export function createLocalMediaResolver(deps: Dependencies) {
  async function resolve(
    song: MusicInfo,
    onUpdate: (result: LocalMediaResult) => void,
    isCurrent: () => boolean,
  ): Promise<LocalMediaResult | null> {
    let lyrics: LyricLine[] = [];
    let coverUri: string | undefined;
    // 来源标注只随命中的那份歌词产生：缓存复用、LRCLIB 直查、同曲异唱都各带自己的来源。
    let lyricOrigin: LocalMediaAssets["lyricOrigin"];
    const issues: string[] = [];
    const edited = (song as MusicInfo & { localEditedFields?: string[] }).localEditedFields ?? [];
    const needs = () => ({ lyrics: lyrics.length === 0, cover: !coverUri });
    const complete = () => !needs().lyrics && !needs().cover;
    const report = (status: LocalMediaResult["status"], message: string): LocalMediaResult => {
      const result = { status, lyrics, coverUri, message, issues: [...issues], ...(lyricOrigin ? { lyricOrigin } : {}) };
      if (isCurrent()) onUpdate(result);
      return result;
    };
    const getCover = async (uri: string | undefined): Promise<string | undefined> => {
      if (!uri) return undefined;
      try { return await deps.cover(uri); }
      catch (error) { issues.push(`封面读取失败：${messageOf(error)}`); return undefined; }
    };

    try {
      // 先展示记录中已有的歌词；原生文件读取不能让它们暂时消失。
      if (song.localLyrics?.trim()) lyrics = await deps.parse(song.localLyrics);
      if (!isCurrent()) return null;
      report("loading", "正在读取本地歌词和封面");
      const local = await deps.readLocal(song);
      if (!isCurrent()) return null;
      issues.push(...local.warnings);
      if (local.lyrics && (!edited.includes("localLyrics") || !song.localLyrics?.trim())) lyrics = await deps.parse(local.lyrics);
      if (!isCurrent()) return null;
      report("loading", "正在检查缺失资料");
      const originalCover = song.picUrl || song.img;
      // 下载索引的 URL 不是手动设置；本地齐全时不为它额外联网。
      const preferOriginalCover = edited.includes("picUrl") || edited.includes("img") ||
        ((song as LocalMusicInfo).localOrigin !== "download" && Boolean(originalCover?.match(/^https?:\/\//i)));
      coverUri = preferOriginalCover
        ? await getCover(originalCover) || await getCover(local.coverUri)
        : await getCover(local.coverUri) || await getCover(originalCover);
      if (!isCurrent()) return null;
      if (complete()) return report("local", lyrics.length ? "" : "暂无歌词");

      const key = JSON.stringify([localMediaInputKey(song), local.signature]);
      let cached: LocalMediaCache | null = null;
      try { cached = await deps.readCache(key); }
      catch (error) { issues.push(`补全缓存读取失败：${messageOf(error)}`); }
      if (!isCurrent()) return null;
      let reusedCache = false;
      if (cached) {
        if (needs().lyrics && cached.lyrics.length) { lyrics = cached.lyrics; reusedCache = true; lyricOrigin = cached.lyricOrigin; }
        if (needs().cover) {
          coverUri = await getCover(cached.coverUri);
          reusedCache ||= Boolean(coverUri);
        }
        if (!isCurrent()) return null;
        if (complete()) return report("cached", lyrics.length ? "" : "暂无歌词");
      }
      report("loading", "正在按歌名查找缺失的歌词或封面");
      const wanted = needs();
      const found = await deps.search(song, wanted);
      if (!isCurrent()) return null;
      issues.push(...found.issues);
      if (found.status !== "matched") {
        // LRCLIB 已明确判定纯音乐：这不是「没找到可靠匹配」，而是这首歌本来就没有词（对齐桌面端提示）。
        // 任何搜索都补不出歌词，直接结束，别让用户以为补全失败。
        if (found.issues.includes("lrclib:instrumental")) return report("local", "纯音乐，无歌词");
        const status = found.status === "not-found" && issues.some(issue => /failed|失败/.test(issue)) ? "error" : found.status;
        const message = status === "ambiguous" ? "同名歌曲存在歧义，未自动补全"
          : status === "error" ? "资料查询失败，播放不受影响" : "未找到可靠匹配，未自动补全";
        return report(status, message);
      }
      if (reusedCache && (!cached?.candidate || !found.candidate || candidateKey(cached.candidate) !== candidateKey(found.candidate))) {
        issues.push("match:cached-identity-conflict");
        return report("ambiguous", "新的匹配与缓存来源不一致，未混用资料");
      }
      if (wanted.lyrics && found.lyrics?.length) { lyrics = found.lyrics; lyricOrigin = found.lyricOrigin; }
      if (wanted.cover && found.coverUrl) coverUri = await getCover(found.coverUrl);
      if (!isCurrent()) return null;
      if (lyrics.length || coverUri) {
        try {
          await deps.writeCache(key, { version: 1, cachedAt: deps.now(), lyrics, coverUri, candidate: found.candidate,
            ...(lyricOrigin ? { lyricOrigin } : {}) }, isCurrent);
        } catch (error) { issues.push(`补全缓存保存失败：${messageOf(error)}`); }
      }
      if (!isCurrent()) return null;
      // 纯音乐（LRCLIB 明确标注）在 matched 路径同样要如实说明：歌词本来就没有，
      // 不能说成「部分资料暂不可用」——那会让用户以为稍后能补上词。
      if (found.issues.includes("lrclib:instrumental")) return report(coverUri ? "matched" : "not-found", "纯音乐，无歌词");
      return complete() ? report("matched", lyrics.length ? "" : "暂无歌词")
        : report("partial", "已找到匹配歌曲，但部分资料暂不可用");
    } catch (error) {
      if (!isCurrent()) return null;
      issues.push(messageOf(error));
      return report("error", "资料读取或查询失败，播放不受影响");
    }
  }
  return { resolve };
}
