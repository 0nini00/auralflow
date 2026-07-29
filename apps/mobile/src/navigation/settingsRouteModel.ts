export type SettingsCategoryName =
  | "Account"
  | "Appearance"
  | "Playback"
  | "Sources"
  | "Lyrics"
  | "Sync"
  | "Data"
  | "About";

export interface SettingsCategory {
  name: SettingsCategoryName;
  label: string;
  description: string;
  icon:
    | "account"
    | "appearance"
    | "playback"
    | "sources"
    | "lyrics"
    | "sync"
    | "data"
    | "about";
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { name: "Account", label: "账号", description: "网易云与 B站账号", icon: "account" },
  { name: "Appearance", label: "外观", description: "主题、强调色与背景", icon: "appearance" },
  { name: "Playback", label: "播放与音效", description: "音质、打断策略与均衡器", icon: "playback" },
  { name: "Sources", label: "音源", description: "自定义音源管理", icon: "sources" },
  { name: "Lyrics", label: "歌词", description: "沉浸歌词与悬浮歌词", icon: "lyrics" },
  { name: "Sync", label: "同步", description: "WebDAV 数据同步", icon: "sync" },
  { name: "Data", label: "数据", description: "缓存与历史清理", icon: "data" },
  { name: "About", label: "关于", description: "版本与软件更新", icon: "about" },
] as const;

export const DEFAULT_SETTINGS_CATEGORY: SettingsCategoryName = "Account";

export function getSettingsCategory(name: SettingsCategoryName): SettingsCategory {
  const category = SETTINGS_CATEGORIES.find((item) => item.name === name);
  if (!category) throw new Error(`Unknown settings category: ${name}`);
  return category;
}
