/**
 * 移动端主导航模型 —— 对齐桌面 Sidebar 分组。
 * 唯一差异：移动端侧边栏默认隐藏为抽屉，不常驻。
 *
 * "player" 不在抽屉列表中，由 PlayerBar / 程序化入口打开。
 * "library" 保留为兼容别名（历史代码），新 UI 用 playlists/local/downloads 拆分。
 *
 * 注意：本模块不引入 lucide-react-native（RN 原生库在 vitest/Node 环境解析失败），
 *      icon 只声明语义键，由 UI 层（AppSidebar）映射到具体图标组件。
 */
export type AppTabId =
  | "home"
  | "search"
  | "daily"
  | "fm"
  | "playlists"
  | "downloads"
  | "local"
  | "settings"
  | "library"
  | "player"
  | "download";

/** 抽屉主导航实际展示的页面（不含设置——设置在 footer） */
export type VisibleTabId =
  | "home"
  | "search"
  | "daily"
  | "fm"
  | "playlists"
  | "downloads"
  | "local"
  | "settings";

/** 图标语义键 —— UI 层负责映射到 lucide 组件（对齐桌面 Sidebar） */
export type AppTabIconKey =
  | "home"
  | "search"
  | "calendar"
  | "radio"
  | "listMusic"
  | "download"
  | "music"
  | "settings";

export interface AppTabItem {
  id: VisibleTabId;
  label: string;
  /** 图标语义键，由 UI 层映射为矢量图标 */
  icon: AppTabIconKey;
}

export const DEFAULT_APP_TAB: AppTabId = "home";

/** 主列表项：对齐桌面 Sidebar navItems（desktop/src/components/Layout/Sidebar.tsx） */
export const APP_TABS: AppTabItem[] = [
  { id: "home", label: "发现", icon: "home" },
  { id: "search", label: "搜索", icon: "search" },
  { id: "daily", label: "每日推荐", icon: "calendar" },
  { id: "fm", label: "私人 FM", icon: "radio" },
  { id: "playlists", label: "歌单", icon: "listMusic" },
  { id: "downloads", label: "下载", icon: "download" },
  { id: "local", label: "本地音乐", icon: "music" },
];

/** footer 设置项（与桌面 af-sidebar-footer 一致） */
export const APP_SETTINGS_TAB: AppTabItem = {
  id: "settings",
  label: "设置",
  icon: "settings",
};

const VISIBLE_TAB_IDS = new Set<VisibleTabId>([
  ...APP_TABS.map((tab) => tab.id),
  APP_SETTINGS_TAB.id,
]);

/**
 * 切换到目标 Tab；如果目标不在可见列表中，保持不变。
 * player / download 等由各自入口直接打开，不经此函数。
 */
export function getNextAppTab(current: AppTabId, next: AppTabId): AppTabId {
  return VISIBLE_TAB_IDS.has(next as VisibleTabId) ? next : current;
}

export function openPlayerTab(): AppTabId {
  return "player";
}

export function shouldShowNestedBackButton(onBack: unknown): boolean {
  return typeof onBack === "function";
}

export function isVisibleTabId(id: string): id is VisibleTabId {
  return VISIBLE_TAB_IDS.has(id as VisibleTabId);
}
