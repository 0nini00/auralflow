import {
  CircleUserRound,
  Cloud,
  Database,
  Info,
  Mic2,
  Palette,
  RadioTower,
  Volume2,
  type LucideIcon,
} from "lucide-react-native";

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
  { name: "Account", label: "账号与服务", description: "网易云账号", icon: "account" },
  { name: "Playback", label: "播放", description: "在线播放与新建下载的默认音质与打断策略", icon: "playback" },
  { name: "Lyrics", label: "歌词", description: "沉浸歌词与悬浮歌词", icon: "lyrics" },
  { name: "Appearance", label: "外观", description: "明暗模式、主题色与调色盘", icon: "appearance" },
  { name: "Sources", label: "音源", description: "自定义音源管理", icon: "sources" },
  { name: "Sync", label: "同步与备份", description: "WebDAV 数据同步", icon: "sync" },
  { name: "Data", label: "存储与数据", description: "缓存、下载、播放历史与运行日志", icon: "data" },
  { name: "About", label: "关于", description: "版本与软件更新", icon: "about" },
] as const;

export const SETTINGS_CATEGORY_ICONS: Record<SettingsCategory["icon"], LucideIcon> = {
  account: CircleUserRound,
  appearance: Palette,
  playback: Volume2,
  sources: RadioTower,
  lyrics: Mic2,
  sync: Cloud,
  data: Database,
  about: Info,
};
