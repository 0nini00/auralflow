/**
 * 本地曲歌词选择的「孤儿表」纯模型：把消失记录上的选择按内容指纹暂存，等同一份内容再出现时认回。
 *
 * 为什么需要它：选择绑定在「文件内容指纹」上，而记录的身份（id）来自路径 —— 改名 / 移动会让旧记录
 * 从曲库里消失、新记录顶着新 id 出现，选择看起来像丢了，其实用户只是换了文件名。
 * 为什么键是指纹而不是文件名：改名之后唯一还能把「还是那份音频」认出来的东西就是内容哈希。
 * 没有指纹、或记录本来就没有选择时不入表：认不回来的条目只会占配额。
 */
import { localLyricsModeOf, type LocalLyricsChoiceFields, type LocalLyricsChoiceRequest } from "./localLyricsChoiceModel";

/** 孤儿表只可能存「用户明确表达过」的两态：auto 没有需要认回的东西。 */
export type LocalLyricsChoiceOrphanMode = "picked" | "local-only";

export interface LocalLyricsChoiceOrphan {
  /** 做出选择时那份音频内容的指纹（原生 SHA-256 signature），也是孤儿表的唯一键。 */
  fingerprint: string;
  mode: LocalLyricsChoiceOrphanMode;
  /** 入表时间：只用于淘汰最旧条目与排查，不参与认回判定。 */
  savedAt: number;
  /** 仅用于 UI 显示「当前使用：LRCLIB / QQ音乐」，不参与判定。 */
  lyricsSourceLabel?: string;
  /** picked 的那份文本：必须连同文本一起搬回去，否则「选中」等于没有词。 */
  localLyrics?: string;
}

/**
 * 上限：只保留最近 200 条。
 *
 * 一条孤儿最大几百字节到几 KB（picked 带上整份歌词），200 条最坏也就几百 KB，相对 AsyncStorage
 * 完全可接受；而 200 条足够覆盖「一次整理音乐目录」这种最常见的批量改名场景。
 * 超限时淘汰入表最早的条目：选择的价值随时间衰减，刚消失的文件最可能还在设备上。
 */
export const LOCAL_LYRICS_CHOICE_ORPHAN_LIMIT = 200;

/**
 * 记录 → 孤儿条目；不值得入表时返回 null。
 *
 * picked 却没有文本的记录在解析时本来就会被判失效，入表只会占一个永远认不回来的位置。
 */
export function buildLyricsChoiceOrphan(
  song: LocalLyricsChoiceFields & { localLyrics?: string },
  now: number,
): LocalLyricsChoiceOrphan | null {
  const mode = localLyricsModeOf(song);
  if (mode === "auto") return null;
  const fingerprint = song.lyricsFingerprint?.trim();
  if (!fingerprint) return null;
  const lyrics = song.localLyrics?.trim() ? song.localLyrics : undefined;
  if (mode === "picked" && !lyrics) return null;
  const label = song.lyricsSourceLabel?.trim();
  return {
    fingerprint,
    mode,
    savedAt: now,
    ...(label ? { lyricsSourceLabel: label } : {}),
    // 只有 picked 的文本要跟着走：「不匹配」那档的语义就是只用内嵌 / 旁挂，带词过去自相矛盾。
    ...(mode === "picked" && lyrics ? { localLyrics: lyrics } : {}),
  };
}

/** 一次扫描里消失的记录 → 孤儿条目（自动过滤掉没有选择可认回的记录）。 */
export function collectLyricsChoiceOrphans(
  songs: readonly (LocalLyricsChoiceFields & { localLyrics?: string })[],
  now: number,
): LocalLyricsChoiceOrphan[] {
  return songs
    .map((song) => buildLyricsChoiceOrphan(song, now))
    .filter((orphan): orphan is LocalLyricsChoiceOrphan => orphan !== null);
}

/**
 * 合并入表：同一指纹只留最后一条（后到的选择覆盖先到的 —— 同一份内容被反复挑词时以最后一次为准），
 * 再按「入表顺序即新旧」淘汰到上限。
 */
export function mergeLyricsChoiceOrphans(
  existing: readonly LocalLyricsChoiceOrphan[],
  incoming: readonly LocalLyricsChoiceOrphan[],
  limit = LOCAL_LYRICS_CHOICE_ORPHAN_LIMIT,
): LocalLyricsChoiceOrphan[] {
  const merged = [...existing, ...incoming];
  const lastIndex = new Map<string, number>();
  merged.forEach((orphan, index) => lastIndex.set(orphan.fingerprint, index));
  const deduped = merged.filter((orphan, index) => lastIndex.get(orphan.fingerprint) === index);
  return deduped.length > limit ? deduped.slice(deduped.length - limit) : deduped;
}

/**
 * 磁盘数据可能来自旧版本或被外部改坏。孤儿表是可重建的认回线索，不是曲库本身：
 * 读坏一条就丢一条（坏到整体解析不出就当空表），绝不让播放路径因为一次存储内容异常而抛错。
 */
function normalizeOrphan(value: unknown): LocalLyricsChoiceOrphan | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<LocalLyricsChoiceOrphan>;
  const fingerprint = typeof entry.fingerprint === "string" ? entry.fingerprint.trim() : "";
  if (!fingerprint || (entry.mode !== "picked" && entry.mode !== "local-only")) return null;
  const savedAt = typeof entry.savedAt === "number" && Number.isFinite(entry.savedAt) ? entry.savedAt : 0;
  const label = typeof entry.lyricsSourceLabel === "string" ? entry.lyricsSourceLabel.trim() : "";
  const lyrics = typeof entry.localLyrics === "string" && entry.localLyrics.trim() ? entry.localLyrics : undefined;
  if (entry.mode === "picked" && !lyrics) return null;
  return {
    fingerprint,
    mode: entry.mode,
    savedAt,
    ...(label ? { lyricsSourceLabel: label } : {}),
    // 「不匹配」那档的语义就是只用内嵌 / 旁挂，带上文本会自相矛盾：直接丢弃而不是留着当词。
    ...(entry.mode === "picked" && lyrics ? { localLyrics: lyrics } : {}),
  };
}

/** 读盘：坏数据当空表，重复指纹只留最后一条，超限即截断（与合并同一条策略）。 */
export function parseLyricsChoiceOrphans(raw: string | null): LocalLyricsChoiceOrphan[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return mergeLyricsChoiceOrphans([], parsed
    .map((entry) => normalizeOrphan(entry))
    .filter((orphan): orphan is LocalLyricsChoiceOrphan => orphan !== null));
}

/**
 * 孤儿条目 → 面板三个动作里的一个。
 * 复用既有的补丁构造，保证自动重绑落盘的结构与用户手动选择完全一致（少了文本的 picked 会被解析层判失效）。
 */
export function lyricsChoiceRequestFromOrphan(orphan: LocalLyricsChoiceOrphan): LocalLyricsChoiceRequest {
  return orphan.mode === "picked"
    ? { type: "picked", fingerprint: orphan.fingerprint, sourceLabel: orphan.lyricsSourceLabel ?? "", text: orphan.localLyrics ?? "" }
    : { type: "local-only", fingerprint: orphan.fingerprint };
}
