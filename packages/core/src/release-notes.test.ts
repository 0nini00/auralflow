import { describe, expect, it } from "vitest";

import { summarizeReleaseNotes } from "./release-notes";

/**
 * 这套用例锚定一个真实观感问题：发布正文是 markdown，直接当纯文本塞进更新弹窗时，
 * 用户看到的是 `| 平台 | 文件 |` 这类表格语法与 `##` 标题符号。这里测的就是「清干净」。
 */
describe("summarizeReleaseNotes", () => {
  it("丢掉表格 / 分隔线 / 代码块 / 图片，保留可读文字", () => {
    const body = [
      "## 移除 B 站功能",
      "",
      "B 站不再是本播放器的一部分。",
      "",
      "| 平台 | 文件 | 说明 |",
      "| --- | --- | --- |",
      "| Android | app.apk | 手机 |",
      "",
      "---",
      "",
      "```bash",
      "pnpm mobile:build:release",
      "```",
      "",
      "![badge](https://img.example/badge.svg)",
      "",
      "## 下载",
    ].join("\n");

    const { lines } = summarizeReleaseNotes(body);

    expect(lines).toEqual([
      "移除 B 站功能",
      "B 站不再是本播放器的一部分。",
      "下载",
    ]);
  });

  it("列表项加 `· ` 前缀，标题与引用去掉标记", () => {
    const body = ["## 变更", "> 请注意", "- 第一条", "* 第二条", "1. 第三条", "2) 第四条"].join("\n");

    const { lines } = summarizeReleaseNotes(body);

    expect(lines).toEqual([
      "变更",
      "请注意",
      "· 第一条",
      "· 第二条",
      "· 第三条",
      "· 第四条",
    ]);
  });

  it("链接只留文字，粗体/斜体/行内代码的标记去掉", () => {
    const body = "**重点**：见 [发布页](https://example.com/x)，参数是 `--foo`，*强调*也算。";

    const { lines } = summarizeReleaseNotes(body);

    expect(lines).toEqual(["重点：见 发布页，参数是 --foo，强调也算。"]);
  });

  it("不碰下划线标识符（避免把 snake_case 搅烂）", () => {
    const { lines } = summarizeReleaseNotes("字段 `max_history_items` 与 __强强调__ 都在。");

    expect(lines).toEqual(["字段 max_history_items 与 强强调 都在。"]);
  });

  it("去掉 HTML 注释，兼容 CRLF 换行", () => {
    const body = "第一行\r\n<!-- 这是给维护者看的 -->\r\n第二行";

    const { lines } = summarizeReleaseNotes(body);

    expect(lines).toEqual(["第一行", "第二行"]);
  });

  it("超过 maxLines 时截断并标记 truncated", () => {
    const body = Array.from({ length: 10 }, (_, i) => `第 ${i + 1} 行`).join("\n");

    const summary = summarizeReleaseNotes(body, 6);

    expect(summary.lines).toHaveLength(6);
    expect(summary.lines[0]).toBe("第 1 行");
    expect(summary.truncated).toBe(true);
  });

  it("刚好等于 maxLines 时不算截断", () => {
    const body = ["一", "二", "三"].join("\n");

    const summary = summarizeReleaseNotes(body, 3);

    expect(summary.lines).toHaveLength(3);
    expect(summary.truncated).toBe(false);
  });

  it("空 / null / 纯空白输入安全", () => {
    expect(summarizeReleaseNotes("")).toEqual({ lines: [], truncated: false });
    expect(summarizeReleaseNotes(null)).toEqual({ lines: [], truncated: false });
    expect(summarizeReleaseNotes(undefined)).toEqual({ lines: [], truncated: false });
    expect(summarizeReleaseNotes("   \n\n  ")).toEqual({ lines: [], truncated: false });
  });

  it("只有表格与装饰的正文会清成空，交给 UI 显示兜底文案", () => {
    const { lines } = summarizeReleaseNotes("| a | b |\n| --- | --- |\n---");

    expect(lines).toEqual([]);
  });
});
