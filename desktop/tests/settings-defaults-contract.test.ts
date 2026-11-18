import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { SYSTEM_DEFAULT_LYRIC_FONT_FAMILY } from "../src/services/lyrics/immersiveLyricFont";

/**
 * 设置的默认值只在 Rust 的 `AppSettings::default()` 定义，「恢复默认」走 reset_settings。
 * 前端唯一还需要知道的默认值是歌词字体：字体下拉里的「系统默认」必须就是那个值，
 * 否则恢复默认之后下拉框对不上任何选项、恢复按钮也不会变灰。这里直接读 Rust 源码核对。
 */
it("字体下拉的「系统默认」等于 Rust 的 immersiveLyricFontFamily 默认值", () => {
  const models = readFileSync(resolve(__dirname, "../src-tauri/src/models.rs"), "utf8");
  const literal = models.match(/immersive_lyric_font_family:\s*"((?:[^"\\]|\\.)*)"/);
  if (!literal) throw new Error("models.rs 里找不到 immersive_lyric_font_family 的默认值，请更新本测试的解析规则");

  expect(SYSTEM_DEFAULT_LYRIC_FONT_FAMILY).toBe(literal[1].replace(/\\"/g, '"'));
});
