import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";

import { isLyricOverlaySupported, setLyricOverlayStyle } from "./lyricOverlayService";

/**
 * 把歌词样式设置里的「颜色 / 字体」同步到悬浮歌词窗口。
 *
 * 沉浸歌词的 当前行颜色 / 其他行颜色 / 字体 对悬浮歌词同样生效（用户要求统一）；
 * 空值（跟随主题）解析为主题 primary / textMuted。悬浮歌词自身的
 * 字号、不透明度、显示下一行、投影等仍由悬浮歌词设置单独控制。
 */
export async function syncLyricOverlayTextAppearance(): Promise<void> {
  if (!isLyricOverlaySupported()) return;

  const { activeColor, inactiveColor, fontFamily } = useLyricSettingsStore.getState();
  const theme = useThemeStore.getState();
  const palette = getThemePalette(
    getResolvedTheme(theme.mode, theme.systemTheme),
    theme.accentColor,
  );

  try {
    await setLyricOverlayStyle({
      activeColor: activeColor || palette.primary,
      inactiveColor: inactiveColor || palette.textMuted,
      fontFamily,
    });
  } catch {
    // 悬浮窗不可用时静默：颜色/字体属于外观增强，失败不影响主流程
  }
}
