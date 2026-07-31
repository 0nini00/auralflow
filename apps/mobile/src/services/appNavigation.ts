/**
 * 移动端主导航模型 —— 底部 4 标签 + 侧边抽屉。
 *
 * "player" 不在标签列表中，由 PlayerBar / 程序化入口打开。
 *
 * 注意：本模块不引入 lucide-react-native（RN 原生库在 vitest/Node 环境解析失败），
 *      icon 只声明语义键，由 UI 层映射到具体图标组件。
 */
export type AppTabId =
  | "home"
  | "search"
  | "library"
  | "myMusic"
  | "settings"
  | "player";

/** 底部标签实际展示的页面 */
export type VisibleTabId =
  | "home"
  | "search"
  | "library"
  | "myMusic"
  | "settings";

/** 图标语义键 —— UI 层负责映射到 lucide 组件 */
export type AppTabIconKey =
  | "home"
  | "search"
  | "library"
  | "user"
  | "settings";

export interface AppTabItem {
  id: VisibleTabId;
  label: string;
  /** 图标语义键，由 UI 层映射为矢量图标 */
  icon: AppTabIconKey;
}

export const DEFAULT_APP_TAB: AppTabId = "home";

/** 主列表项：底部 4 标签 */
export const APP_TABS: AppTabItem[] = [
  { id: "home", label: "发现", icon: "home" },
  { id: "library", label: "曲库", icon: "library" },
  { id: "myMusic", label: "我的", icon: "user" },
  { id: "search", label: "搜索", icon: "search" },
];

/** footer 设置项 */
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
 * player 等由各自入口直接打开，不经此函数。
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
