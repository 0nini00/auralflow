/**
 * 本地曲歌词选择的纯模型：三态（自动 / 选中一份 / 不匹配）与「文件内容指纹」绑定。
 *
 * 为什么要有独立的 `lyricsMode`：自动匹配会连网猜词，同名不同曲必然猜错，用户需要一种可持久、
 * 可失效的意志表达。空字符串承担不了这个语义——它既可能是「用户清空了文本」，也可能是旧数据
 * 本来就没有文本，两者无从区分。因此「明确不匹配」从此由 `lyricsMode: "local-only"` 表达，
 * 空串只表示「没有文本」（与移动端 `localLyricsChoiceModel` 同一结论，两端不再各有一套约定）。
 *
 * 为什么绑定指纹：选择只对做出选择时的那份音频内容成立。文件被替换（同名换曲）后必须静默失效
 * 回自动匹配——把别人的词继续当成这首歌的，比没有词更糟。
 *
 * 桌面端的指纹是「做出选择时的文件大小 + 内容 md5」的复合串（见 buildLocalLyricsFingerprint）：
 * 桌面不允许在扫描/播放路径上重算哈希（一次 md5 就是把整个文件读一遍），唯一零成本的变更检测
 * 就是拿选择时的大小与扫描刷新后的 `size` 对一下，所以把大小一并编进指纹里——判定不需要第二次扫描。
 */

export type LocalLyricsMode = "auto" | "picked" | "local-only";
export const LOCAL_LYRICS_MODES: readonly LocalLyricsMode[] = ["auto", "picked", "local-only"];
export const DEFAULT_LOCAL_LYRICS_MODE: LocalLyricsMode = "auto";

/** 本地曲记录上的歌词选择三字段（与移动端同名同义）。 */
export interface LocalLyricsChoiceFields {
  /** 缺省即 "auto"：内嵌标签 / 旁挂 .lrc → LRCLIB → 平台搜索。 */
  lyricsMode?: LocalLyricsMode;
  /** 做出选择时该音频文件的指纹（大小 + 内容 md5）。 */
  lyricsFingerprint?: string;
  /** 仅用于 UI 显示「正在使用：网易云」，不参与任何判定。 */
  lyricsSourceLabel?: string;
}

export function isLocalLyricsMode(value: unknown): value is LocalLyricsMode {
  return typeof value === "string" && (LOCAL_LYRICS_MODES as readonly string[]).includes(value);
}

/** 持久化数据可能来自旧版本或被外部改坏：无法识别的 mode 一律回落到 auto，绝不按未知语义联网。 */
export function localLyricsModeOf(choice: LocalLyricsChoiceFields): LocalLyricsMode {
  return isLocalLyricsMode(choice.lyricsMode) ? choice.lyricsMode : DEFAULT_LOCAL_LYRICS_MODE;
}

/** 指纹两段之间的分隔符：只由本模型自己编解码。 */
const FINGERPRINT_SEPARATOR = ":";

export function buildLocalLyricsFingerprint(size: number, contentHash: string): string {
  const safeSize = Number.isFinite(size) ? Math.max(0, Math.trunc(size)) : 0;
  return `${safeSize}${FINGERPRINT_SEPARATOR}${contentHash.trim()}`;
}

export interface LocalLyricsFingerprint {
  /** 做出选择时那个文件的大小（字节）。 */
  size: number;
  contentHash: string;
}

/**
 * 解析指纹。旧数据、被外部改坏、或只有 md5 没有大小的串一律返回 null：
 * 判定随后按「未绑定」处理——宁可退回自动匹配，也不拿一个不确定的指纹当真。
 */
export function parseLocalLyricsFingerprint(fingerprint?: string): LocalLyricsFingerprint | null {
  if (typeof fingerprint !== "string") return null;
  const separator = fingerprint.indexOf(FINGERPRINT_SEPARATOR);
  if (separator <= 0) return null;
  const size = Number(fingerprint.slice(0, separator));
  const contentHash = fingerprint.slice(separator + 1).trim();
  if (!Number.isFinite(size) || size < 0 || !contentHash) return null;
  return { size, contentHash };
}

/**
 * 指纹绑定判定：记录里选择时的大小，与记录当前的 `size`（由重新扫描刷新）必须一致。
 *
 * 大小就是「零额外开销」的那一半证据：同名换曲、重录、改动标签都会改变文件大小，据此让选择
 * 静默失效；占用相同字节数的不同内容检测不出来，这是不重算哈希换来的已知代价。
 * 当前大小未知时同样视为未绑定：拿不到证据就不承认选择。
 */
export function isLocalLyricsChoiceBound(choice: LocalLyricsChoiceFields, size?: number): boolean {
  const bound = parseLocalLyricsFingerprint(choice.lyricsFingerprint);
  if (!bound) return false;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return false;
  return bound.size === Math.trunc(size);
}

/** 与 `LocalSong` 同形的最小输入：模型不依赖具体服务类型，避免服务之间互相 import。 */
export interface LocalLyricsChoiceInput extends LocalLyricsChoiceFields {
  /** 扫描写进记录的「文件自身的词」（内嵌标签 / 同目录旁挂 .lrc）。 */
  embeddedLyrics?: string;
  /** 用户按曲保存的歌词文本：手动编辑写下的，或面板选中的那一份。 */
  lyricsOverride?: string;
  size?: number;
}

export interface LocalLyricsChoiceView {
  mode: LocalLyricsMode;
  /** 该模式下真正生效的按曲文本；缺省表示这首歌没有任何可用的本地文本。 */
  text?: string;
  /** 显式选择已失效（指纹/大小对不上，或选中文本丢失）：本次按 auto 走，UI 不提示——静默失效比弹窗噪音更合适。 */
  expired: boolean;
  /** 只在选择仍然成立时透出；auto 下不携带，避免 UI 误标来源。 */
  lyricsFingerprint?: string;
  lyricsSourceLabel?: string;
}

/**
 * 这次播放实际该用哪一态，以及该态下生效的文本。
 *
 * 与移动端 `resolveLocalLyricsChoice` 同义，只是把「当前内容指纹」换成记录上已有的 `size`：
 * 指纹不成立时按 auto 走，并且**不**沿用选中的那份文本（它属于上一份内容）。
 */
export function resolveLocalLyricsChoice(input: LocalLyricsChoiceInput): LocalLyricsChoiceView {
  const declared = localLyricsModeOf(input);
  const ownText = input.embeddedLyrics?.trim() ? input.embeddedLyrics : undefined;
  // 按曲文本优先于文件标签（与既有行为一致），但**只有空白字符的按曲文本不算文本**：
  // 用户清空过文本框之后，文件自己的词仍然是这首歌的本地词——空串只表示「这条记录没有文本」，
  // 不能再顺手把文件里的词一起屏蔽掉。
  const override = input.lyricsOverride?.trim() ? input.lyricsOverride : undefined;
  const localText = override ?? ownText;

  if (declared === DEFAULT_LOCAL_LYRICS_MODE) {
    return { mode: "auto", expired: false, ...(localText ? { text: localText } : {}) };
  }
  if (!isLocalLyricsChoiceBound(input, input.size)) {
    return { mode: "auto", expired: true, ...(ownText ? { text: ownText } : {}) };
  }
  if (declared === "picked") {
    // 选中的那一份文本就存在按曲覆盖里：它没了（被外部清掉 / 旧数据）等于选择失效，
    // 而不是「这首歌没词」——不能拿文件里的词冒充用户选的那一份。
    if (!override) {
      return { mode: "auto", expired: true, ...(ownText ? { text: ownText } : {}) };
    }
    return {
      mode: "picked",
      expired: false,
      text: override,
      ...(input.lyricsFingerprint ? { lyricsFingerprint: input.lyricsFingerprint } : {}),
      ...(input.lyricsSourceLabel ? { lyricsSourceLabel: input.lyricsSourceLabel } : {}),
    };
  }
  // local-only：「不匹配」= 不联网，只用本机上已有的词（内嵌 / 旁挂 / 用户自己写下的文本）。
  // 这一档没有来源可言，因此不透出 lyricsSourceLabel。
  return {
    mode: "local-only",
    expired: false,
    ...(localText ? { text: localText } : {}),
    ...(input.lyricsFingerprint ? { lyricsFingerprint: input.lyricsFingerprint } : {}),
  };
}

/**
 * 面板上的三个动作 → 记录补丁。
 *
 * 「恢复自动匹配」必须同时清掉文本与指纹：留着旧文本会让下一次自动匹配继续命中用户已放弃的
 * 那一份词（auto 下按曲文本优先于文件标签），看起来就像没生效。
 * 「不要匹配」同样清掉文本——那一档的语义就是「只用内嵌/旁挂」，留着选过的词会自相矛盾。
 *
 * 译文 / 罗马音是按曲歌词的伴生字段：换一份词之后它们对不上新词就是错行，因此每次选择都随文本
 * 一起清掉（桌面端只在文本字段里存词，不新增字段）。
 */
export interface LocalLyricsChoicePatch extends LocalLyricsChoiceFields {
  lyricsOverride?: string;
  lyricsTranslationOverride?: string;
  lyricsRomanizationOverride?: string;
}

export type LocalLyricsChoiceRequest =
  | { type: "auto" }
  | { type: "local-only"; fingerprint: string }
  | { type: "picked"; fingerprint: string; sourceLabel: string; text: string };

export function buildLocalLyricsChoicePatch(request: LocalLyricsChoiceRequest): LocalLyricsChoicePatch {
  switch (request.type) {
    case "auto":
      return {
        lyricsMode: "auto", lyricsFingerprint: undefined, lyricsSourceLabel: undefined,
        lyricsOverride: undefined, lyricsTranslationOverride: undefined, lyricsRomanizationOverride: undefined,
      };
    case "local-only":
      return {
        lyricsMode: "local-only", lyricsFingerprint: request.fingerprint, lyricsSourceLabel: undefined,
        lyricsOverride: undefined, lyricsTranslationOverride: undefined, lyricsRomanizationOverride: undefined,
      };
    case "picked":
      return {
        lyricsMode: "picked", lyricsFingerprint: request.fingerprint, lyricsSourceLabel: request.sourceLabel,
        lyricsOverride: request.text, lyricsTranslationOverride: undefined, lyricsRomanizationOverride: undefined,
      };
  }
}

/** 面板顶部与列表里都要显示的当前状态文案。传已判定的 view，失效的选择才不会显示成「正在使用」。 */
export function formatLocalLyricsChoiceLabel(
  view: Pick<LocalLyricsChoiceView, "mode" | "lyricsSourceLabel">,
): string {
  if (view.mode === "local-only") return "不匹配（只用本地歌词）";
  if (view.mode === "picked") {
    const label = view.lyricsSourceLabel?.trim();
    return label ? `正在使用：${label}` : "正在使用：选中的歌词";
  }
  return "自动匹配";
}
