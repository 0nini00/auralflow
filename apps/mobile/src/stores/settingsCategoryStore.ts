import { create } from "zustand";

import type { SettingsCategoryName } from "@/navigation/settingsRouteModel";

/**
 * 设置分类请求（我的 / 设置首页 → 设置区 的唯一通道）。
 *
 * 不走路由 params：嵌套 navigate 的 {screen} 参数会被 react-navigation
 * 解释为「进入内部堆栈」，参数合并规则会让外部拿不到最新的目标分类，
 * 表现为「退出后点另一个分类仍显示上一个页面」。这里用显式 store 记录
 * 每次点击的 (分类, 递增 navId)，设置堆栈据此整体重挂载。
 */

interface SettingsCategoryRequestState {
  /** 当前目标分类（初始为设置首页） */
  category: SettingsCategoryName | "SettingsHome";
  /** 每次点击递增，参与重挂载 key：重复点同一分类也会刷新页面 */
  navId: number;
  /**
   * 二级设置是否从「设置首页」进入。
   * - true：返回先回设置首页（全部设置 → 二级设置）
   * - false：返回直接 pop 回「我的」（我的 → 外观/播放/歌词等直达入口）
   */
  fromSettingsHome: boolean;
  requestCategory: (
    category: SettingsCategoryName,
    options?: { fromSettingsHome?: boolean },
  ) => void;
  /** 从任意分类回到设置首页（顶栏返回 / 再次打开设置时） */
  resetToHome: () => void;
}

export const useSettingsCategoryStore = create<SettingsCategoryRequestState>((set) => ({
  category: "SettingsHome",
  navId: 0,
  fromSettingsHome: false,
  requestCategory: (category, options) =>
    set((state) => ({
      category,
      navId: state.navId + 1,
      fromSettingsHome: options?.fromSettingsHome === true,
    })),
  resetToHome: () =>
    set((state) => ({
      category: "SettingsHome",
      navId: state.navId + 1,
      fromSettingsHome: false,
    })),
}));
