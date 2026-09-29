/**
 * Release 正文 → 更新弹窗里能直接读的纯文本。
 *
 * 放在 core 而不是移动端：这是一段纯逻辑，而移动端没有测试框架（回归只能靠真机手测），
 * 放这里才能被单测钉住。桌面端目前用不到（它的更新说明来自清单里的短 notes），需要时可直接复用。
 *
 * 为什么需要：发布正文是 markdown，而且常常带下载表格、分隔线、代码块与徽章。直接把它当
 * 纯文本渲染，用户看到的就是一堆 `|` 和 `#`（移动端的更新弹窗原本正是这个观感）。
 * 这里只做一件事：去掉结构性噪声，留下人能读的行，并按行数截断给 UI 决定是否「展开」。
 *
 * 刻意不做完整 markdown 渲染：更新说明里真正有用的就是几行标题/列表，
 * 引入渲染器换来的复杂度与体积都不值。
 */

/** 标题：`## x` / `### x` */
const HEADING_RE = /^\s{0,3}#{1,6}\s*/;
/** 引用：`> x` */
const QUOTE_RE = /^\s{0,3}>\s?/;
/** 无序列表项 */
const BULLET_RE = /^\s*[-*+]\s+/;
/** 有序列表项 */
const ORDERED_RE = /^\s*\d+[.)]\s+/;
/** 表格行（GitHub 表格：以 | 开头并以 | 结束） */
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
/** 分隔线：--- / *** / ___ */
const RULE_RE = /^\s*([-*_])\s*(\1\s*){2,}$/;
/** 代码围栏 */
const FENCE_RE = /^\s*```/;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
/** `[文字](链接)` → 文字；链接本身对更新说明没有价值 */
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const STRONG_RE = /\*\*([^*]+)\*\*/g;
const UNDERSCORE_STRONG_RE = /__([^_]+)__/g;
/** 单星号强调。刻意不处理下划线——那会把 `snake_case` 这类标识符搅烂。 */
const STAR_EMPHASIS_RE = /\*([^*\s][^*]*)\*/g;
const CODE_SPAN_RE = /`([^`]*)`/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

export interface ReleaseNotesSummary {
  /** 可直接逐行渲染的纯文本（已去掉空行，列表项带 `· ` 前缀） */
  lines: string[];
  /** 原文多于 maxLines，UI 据此显示「展开」 */
  truncated: boolean;
}

/**
 * 把 markdown 正文压成若干行纯文本。
 *
 * 丢弃：HTML 注释、代码块内容、表格行、分隔线、空行、图片。
 * 保留：标题文字、引用与列表项的文字、链接文字（丢掉 URL）。
 */
export function summarizeReleaseNotes(
  markdown: string | null | undefined,
  maxLines = 6,
): ReleaseNotesSummary {
  const raw = typeof markdown === "string" ? markdown : "";
  if (!raw.trim()) {
    return { lines: [], truncated: false };
  }

  const lines: string[] = [];
  let inFence = false;

  for (const rawLine of raw.replace(HTML_COMMENT_RE, "").split(/\r?\n/)) {
    if (FENCE_RE.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!rawLine.trim()) continue;
    if (TABLE_ROW_RE.test(rawLine) || RULE_RE.test(rawLine)) continue;

    let line = rawLine.replace(QUOTE_RE, "").replace(HEADING_RE, "");
    const isListItem = BULLET_RE.test(line) || ORDERED_RE.test(line);
    line = line
      .replace(BULLET_RE, "")
      .replace(ORDERED_RE, "")
      .replace(IMAGE_RE, "")
      .replace(LINK_RE, "$1")
      .replace(STRONG_RE, "$1")
      .replace(UNDERSCORE_STRONG_RE, "$1")
      .replace(STAR_EMPHASIS_RE, "$1")
      .replace(CODE_SPAN_RE, "$1")
      .trim();

    if (!line) continue;
    lines.push(isListItem ? `· ${line}` : line);
  }

  if (lines.length <= maxLines) {
    return { lines, truncated: false };
  }
  return { lines: lines.slice(0, maxLines), truncated: true };
}
