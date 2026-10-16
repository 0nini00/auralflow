/**
 * 本地曲歌词选择的纯模型：三态（自动 / 选中一份 / 不匹配）与「文件内容指纹」绑定。
 *
 * 为什么要有独立的 `lyricsMode`：自动匹配会连网猜词，同名不同曲必然猜错，用户需要一种
 * 可持久、可失效的意志表达。空字符串承担不了这个语义——`localMusicMetadataModel.normalizeOptionalText`
 * 会把空串归一成 undefined，「明确不匹配」根本存不下来；因此空串从此只表示「没有文本」，
 * 「不匹配」由 mode 表达。
 *
 * 为什么绑定指纹：选择只对做出选择时的那份音频内容成立。文件被替换（同名换曲）后必须静默
 * 失效回自动匹配——把别人的词继续当成这首歌的，比没有词更糟。
 */

export type LocalLyricsMode = "auto" | "picked" | "local-only";
export const LOCAL_LYRICS_MODES: readonly LocalLyricsMode[] = ["auto", "picked", "local-only"];
export const DEFAULT_LOCAL_LYRICS_MODE: LocalLyricsMode = "auto";

/** 本地曲记录上的歌词选择三字段（与桌面端同名同义）。 */
export interface LocalLyricsChoiceFields {
  /** 缺省即 "auto"：内嵌标签 / 旁挂 .lrc → LRCLIB → 平台搜索。 */
  lyricsMode?: LocalLyricsMode;
  /** 做出选择时该音频文件的 SHA-256（复用原生 `readAudioAssets` 的 signature，不额外算哈希）。 */
  lyricsFingerprint?: string;
  /** 仅用于 UI 显示「当前使用：LRCLIB / QQ音乐」，不参与任何判定。 */
  lyricsSourceLabel?: string;
}

export function isLocalLyricsMode(value: unknown): value is LocalLyricsMode {
  return typeof value === "string" && (LOCAL_LYRICS_MODES as readonly string[]).includes(value);
}

/** 持久化数据可能来自旧版本或被外部改坏：无法识别的 mode 一律回落到 auto，绝不按未知语义联网。 */
export function localLyricsModeOf(song: LocalLyricsChoiceFields): LocalLyricsMode {
  return isLocalLyricsMode(song.lyricsMode) ? song.lyricsMode : DEFAULT_LOCAL_LYRICS_MODE;
}

/**
 * 记录是否已经表达过歌词选择（哪怕它已经随文件内容变更失效）。
 *
 * 孤儿认领的卡口：只认领「还没有主人的记录」。用户在这条记录上做过的选择即使是失效的，
 * 也代表他在这条路径上表过态，不能被另一份内容留下的孤儿无声顶掉。
 */
export function hasLocalLyricsChoice(song: LocalLyricsChoiceFields): boolean {
  return localLyricsModeOf(song) !== DEFAULT_LOCAL_LYRICS_MODE;
}

/**
 * 指纹绑定判定：路径命中即「这就是这首歌的记录」，但选择是否仍然有效只看内容指纹——
 * 同名换曲（内容变）必须失效，改名/移动（内容不变）必须仍然生效，两者都落在指纹上。
 * 缺失任一侧指纹都视为未绑定：宁可退回自动匹配，也不拿不确定的指纹当真。
 */
export function isLyricsChoiceBoundToFile(
  choice: LocalLyricsChoiceFields,
  fingerprint: string | undefined,
): boolean {
  const bound = typeof choice.lyricsFingerprint === "string" ? choice.lyricsFingerprint.trim() : "";
  const current = typeof fingerprint === "string" ? fingerprint.trim() : "";
  return Boolean(bound && current && bound === current);
}

export interface LocalLyricsChoicePlan extends LocalLyricsChoiceFields {
  mode: LocalLyricsMode;
  /** 选择已失效（指纹不匹配）：本次按 auto 走，UI 不提示——静默失效比弹窗噪音更合适。 */
  expired: boolean;
}

/**
 * 这次播放实际该用哪一态。
 *
 * @param fingerprint 当前文件内容的指纹（原生 signature）；调用方拿不到时传 undefined，
 *   此时任何显式选择都视为未绑定 → 回 auto。
 */
export function resolveLocalLyricsChoice(
  song: LocalLyricsChoiceFields & { localLyrics?: string },
  fingerprint: string | undefined,
): LocalLyricsChoicePlan {
  const mode = localLyricsModeOf(song);
  if (mode === "auto") return { mode, expired: false };
  if (!isLyricsChoiceBoundToFile(song, fingerprint)) return { mode: "auto", expired: true };
  // picked 的歌词文本沿用既有 localLyrics；文本没了（被外部清掉 / 旧数据）等于选择失效。
  if (mode === "picked" && !song.localLyrics?.trim()) return { mode: "auto", expired: true };
  return { mode, expired: false, lyricsFingerprint: song.lyricsFingerprint, lyricsSourceLabel: song.lyricsSourceLabel };
}

export type LocalLyricsChoiceRequest =
  | { type: "auto" }
  | { type: "local-only"; fingerprint: string }
  | { type: "picked"; fingerprint: string; sourceLabel: string; text: string };

/**
 * 面板上的三个动作 → 记录补丁。
 *
 * 「恢复自动匹配」必须同时清掉文本与指纹：留着旧文本会让下一次自动匹配继续命中用户已放弃的
 * 那一份词（auto 下按曲文本优先于文件标签），看起来就像没生效。
 * 「不匹配」同样清掉文本——那一档的语义就是「只用内嵌/旁挂」，留着选过的词会自相矛盾。
 */
export function buildLocalLyricsChoicePatch(
  request: LocalLyricsChoiceRequest,
): LocalLyricsChoiceFields & { localLyrics?: string } {
  switch (request.type) {
    case "auto":
      return { lyricsMode: "auto", lyricsFingerprint: undefined, lyricsSourceLabel: undefined, localLyrics: undefined };
    case "local-only":
      return {
        lyricsMode: "local-only", lyricsFingerprint: request.fingerprint,
        lyricsSourceLabel: undefined, localLyrics: undefined,
      };
    case "picked":
      return {
        lyricsMode: "picked", lyricsFingerprint: request.fingerprint,
        lyricsSourceLabel: request.sourceLabel, localLyrics: request.text,
      };
  }
}

/** 面板顶部与列表里都要显示的当前状态文案。 */
export function formatLyricsChoiceLabel(song: LocalLyricsChoiceFields): string {
  const mode = localLyricsModeOf(song);
  if (mode === "local-only") return "不匹配（只用本地歌词）";
  if (mode === "picked") {
    const label = song.lyricsSourceLabel?.trim();
    return label ? `正在使用：${label}` : "正在使用：选中的歌词";
  }
  return "自动匹配";
}
