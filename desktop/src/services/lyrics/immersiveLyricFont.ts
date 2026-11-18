/**
 * 沉浸式歌词字体下拉里「系统默认」这一项的字体栈。
 *
 * 它必须等于 Rust 的 immersiveLyricFontFamily 默认值，界面才能判断「当前是不是默认字体」
 * （恢复按钮是否可点）；恢复动作本身不用它，走 resetSettingsToDefault。
 * 两边一致由 tests/settings-defaults-contract.test.ts 把关。
 */
export const SYSTEM_DEFAULT_LYRIC_FONT_FAMILY =
  "\"Inter\", \"Noto Sans CJK SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
