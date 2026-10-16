import type { LyricLine, MusicInfo } from "@lx/core";
import {
  hasLocalLyricsChoice,
  localLyricsModeOf,
  resolveLocalLyricsChoice,
  type LocalLyricsChoiceFields,
} from "./localLyricsChoiceModel";
import type { LocalMusicInfo } from "./localMusicScanModel";
import type { LocalMediaAssets } from "./localMediaSearchService";

export interface LocalAudioAssets {
  signature: string;
  lyrics?: string;
  warnings: string[];
}
export interface LocalMediaCache {
  version: 1;
  cachedAt: number;
  lyrics: LyricLine[];
  candidate?: LocalMediaAssets["candidate"];
  // 歌词来源标注（同曲异唱 / LRCLIB）。旧缓存没有这个可选字段，读出来只是「没有可标注的来源」，
  // 结构与语义仍然兼容，因此不升版本、不改缓存键：升版本会让所有既有缓存一次性失效。
  lyricOrigin?: LocalMediaAssets["lyricOrigin"];
}
export interface LocalMediaResult {
  status: "loading" | "local" | "cached" | "matched" | "partial" | "not-found" | "ambiguous" | "error";
  lyrics: LyricLine[];
  message: string;
  issues: string[];
  // 同曲异唱必须让 UI 标注「歌词来自谁的演唱版本」，不能静默；LRCLIB 来源同样标注。
  lyricOrigin?: LocalMediaAssets["lyricOrigin"];
}
interface Dependencies {
  readLocal: (song: MusicInfo) => Promise<LocalAudioAssets>;
  readCache: (key: string) => Promise<LocalMediaCache | null>;
  writeCache: (key: string, value: LocalMediaCache, isCurrent: () => boolean) => Promise<void>;
  parse: (raw: string) => Promise<LyricLine[]>;
  search: (song: MusicInfo) => Promise<LocalMediaAssets>;
  now: () => number;
  /**
   * 可选：认领歌词选择孤儿 —— 解析路径是唯一不额外花钱就能拿到文件指纹的地方（`local.signature`
   * 已在手），改名 / 移动后没主人的选择在这里按内容指纹搬回记录。
   * 实现方负责写回曲库；本层只负责在「记录还没有选择 + 指纹可用」时问一次，且任何失败都不影响解析。
   */
  claimOrphanedLyricsChoice?: (
    song: MusicInfo,
    fingerprint: string,
  ) => Promise<(LocalLyricsChoiceFields & { localLyrics?: string }) | null>;
}
/** 本地曲记录上属于「歌词选择」的字段（与桌面端同名同义）。 */
type LocalRecord = MusicInfo & LocalLyricsChoiceFields & Pick<LocalMusicInfo, "localOrigin" | "localEditedFields">;

/**
 * 补全缓存的输入键。
 *
 * 歌词选择三要素必须进键：缓存按「身份 + 文件签名」存 30 天，用户选了「不匹配」或某一份词之后
 * 若键不变，就会命中旧缓存，看起来像选择根本没生效。封面不进键——它已不参与补全。
 */
export function localMediaInputKey(song: MusicInfo): string {
  const record = song as LocalRecord;
  return JSON.stringify([song.source, song.id, song.url, song.name, song.singer, song.albumName,
    song.interval, song.localLyrics, record.localEditedFields, record.localOrigin,
    localLyricsModeOf(record), record.lyricsFingerprint]);
}

/**
 * 认领改名 / 移动后没主人的歌词选择。
 *
 * 为什么在这里做：原生 `readAudioAssets` 已经把文件内容 SHA-256 交到手上，重绑完全免费；
 * 扫描与播放路径都不该为了它多读一次文件。
 * 为什么必须无声失败：认领是增强而不是播放前提，存储故障或记录已消失都只能放弃这一次搬回。
 */
async function claimOrphanLyricsChoice(
  record: LocalRecord,
  signature: string | undefined,
  deps: Dependencies,
): Promise<LocalRecord> {
  const fingerprint = typeof signature === "string" ? signature.trim() : "";
  // 没有指纹、或记录本来就有自己的选择时直接返回：绝大多数本地曲都走这条早退路径。
  if (!deps.claimOrphanedLyricsChoice || !fingerprint || hasLocalLyricsChoice(record)) return record;
  try {
    const claimed = await deps.claimOrphanedLyricsChoice(record, fingerprint);
    return claimed ? { ...record, ...claimed } : record;
  } catch {
    return record;
  }
}
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * 所有补全都是派生缓存；永远不修改传入歌曲、曲库记录或原始音频。
 *
 * 封面不在本层：本地曲封面只来自音频文件自己的内嵌标签与同目录旁挂图（由扫描 / 下载元数据写进
 * 记录），因此这里只解析歌词，也不再有任何封面读取或联网路径。
 */
export function createLocalMediaResolver(deps: Dependencies) {
  async function resolve(
    song: MusicInfo,
    onUpdate: (result: LocalMediaResult) => void,
    isCurrent: () => boolean,
  ): Promise<LocalMediaResult | null> {
    const record = song as LocalRecord;
    let lyrics: LyricLine[] = [];
    // 来源标注只随命中的那份歌词产生：缓存复用、LRCLIB 直查、同曲异唱都各带自己的来源。
    let lyricOrigin: LocalMediaAssets["lyricOrigin"];
    const issues: string[] = [];
    const report = (status: LocalMediaResult["status"], message: string): LocalMediaResult => {
      const result = { status, lyrics, message, issues: [...issues], ...(lyricOrigin ? { lyricOrigin } : {}) };
      if (isCurrent()) onUpdate(result);
      return result;
    };

    try {
      // 先展示记录中已有的歌词；原生文件读取不能让它们暂时消失。
      if (song.localLyrics?.trim()) lyrics = await deps.parse(song.localLyrics);
      if (!isCurrent()) return null;
      report("loading", "正在读取本地歌词");
      const local = await deps.readLocal(song);
      if (!isCurrent()) return null;
      issues.push(...local.warnings);
      // 改名 / 移动后记录会换 id：这份内容若正是某条消失记录的选择所绑定的内容，就在这里把它搬回来。
      const live = await claimOrphanLyricsChoice(record, local.signature, deps);
      // 三态判定：显式选择只对做出选择时的那份文件内容成立，指纹不符即静默失效回自动匹配。
      const choice = resolveLocalLyricsChoice(live, local.signature);
      // 搬回的选择带着它自己的文本：显示它，不能沿用新记录扫描出来的文件歌词（那可能是另一份词）。
      if (!choice.expired && live.localLyrics?.trim() && live.localLyrics !== song.localLyrics) {
        lyrics = await deps.parse(live.localLyrics);
      }
      // 用户编辑过的字段以搬回后的记录为准：认领走的就是面板同一条「用户编辑」路径。
      const edited = live.localEditedFields ?? [];
      // 失效的选择连同它的按曲文本一起作废：指纹不匹配说明这份文本属于另一份文件内容，
      // 继续显示就是把别人的词当成这首歌的（静默失效不等于继续用错的词）。
      if (choice.expired) lyrics = [];
      // 文件里的内嵌 / 旁挂歌词优先于记录里的旧值；用户在表单里写过的文本不被它覆盖。
      const preferRecordLyrics = !choice.expired && edited.includes("localLyrics") && Boolean(song.localLyrics?.trim());
      if (choice.mode === "local-only") {
        // 「不匹配」= 不联网，只用这台设备上已有的歌词：内嵌 / 旁挂 .lrc，或用户自己写下的文本。
        if (local.lyrics && !preferRecordLyrics) lyrics = await deps.parse(local.lyrics);
        return report("local", lyrics.length ? "" : "无歌词");
      }
      if (choice.mode === "picked") {
        // 「选中一份」= 只用选中的文本（存在按曲字段里），永不联网再搜。
        return report("local", lyrics.length ? "" : "无歌词");
      }
      if (local.lyrics && !preferRecordLyrics) lyrics = await deps.parse(local.lyrics);
      if (!isCurrent()) return null;
      report("loading", "正在检查缺失的歌词");
      if (lyrics.length) return report("local", "");

      const key = JSON.stringify([localMediaInputKey(song), local.signature]);
      let cached: LocalMediaCache | null = null;
      try { cached = await deps.readCache(key); }
      catch (error) { issues.push(`补全缓存读取失败：${messageOf(error)}`); }
      if (!isCurrent()) return null;
      if (cached?.lyrics.length) {
        // 缓存命中即完成：歌词已是这首曲子的全部派生资料，无需再问任何候选，
        // 也就不可能出现「缓存身份 A 的歌词 + 候选身份 B 的资料」这种混用。
        lyrics = cached.lyrics;
        lyricOrigin = cached.lyricOrigin;
        if (!isCurrent()) return null;
        return report("cached", "");
      }
      report("loading", "正在按歌名查找缺失的歌词");
      const found = await deps.search(song);
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
      if (found.lyrics?.length) {
        lyrics = found.lyrics;
        lyricOrigin = found.lyricOrigin;
      }
      if (!isCurrent()) return null;
      if (lyrics.length) {
        try {
          await deps.writeCache(key, { version: 1, cachedAt: deps.now(), lyrics, candidate: found.candidate,
            ...(lyricOrigin ? { lyricOrigin } : {}) }, isCurrent);
        } catch (error) { issues.push(`补全缓存保存失败：${messageOf(error)}`); }
      }
      if (!isCurrent()) return null;
      // 纯音乐（LRCLIB 明确标注）在 matched 路径同样要如实说明：歌词本来就没有。
      if (found.issues.includes("lrclib:instrumental")) return report("not-found", "纯音乐，无歌词");
      return lyrics.length ? report("matched", "") : report("partial", "已找到匹配歌曲，但没取到歌词");
    } catch (error) {
      if (!isCurrent()) return null;
      issues.push(messageOf(error));
      return report("error", "资料读取或查询失败，播放不受影响");
    }
  }
  return { resolve };
}
