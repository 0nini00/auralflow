import { create } from "zustand";

import type { SettingsCategoryName } from "@/navigation/settingsRouteModel";

/**
 * 设置分类请求（抽屉侧边栏 → 设置堆栈 的唯一通道）。
 *
 * 不走路由 params：嵌套 navigate 的 {screen} 参数会被 react-navigation
 * 解释为「进入内部堆栈」，参数合并规则会让外部拿不到最新的目标分类，
 * 表现为「退出后点另一个分类仍显示上一个页面」。这里用显式 store 记录
 * 每次点击的 (分类, 递增 navId)，设置堆栈据此整体重挂载。
 */

interface SettingsCategoryRequestState {
  /** 当前目标分类（初始为设置首页，实际不可达，仅兜底） */
  category: SettingsCategoryName | "SettingsHome";
  /** 每次点击递增，参与重挂载 key：重复点同一分类也会刷新页面 */
  navId: number;
  requestCategory: (category: SettingsCategoryName) => void;
}

export const useSettingsCategoryStore = create<SettingsCategoryRequestState>((set) => ({
  category: "SettingsHome",
  navId: 0,
  requestCategory: (category) =>
    set((state) => ({ category, navId: state.navId + 1 })),
}));
