import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

/**
 * 设置二级页的滚动控制面。
 *
 * 拖拽排序需要三件只有页面滚动容器才知道的事：
 * - 拖拽期间锁住页面滚动，否则竖滑会被 ScrollView 抢走；
 * - 读到当前滚动偏移与可视区位置，用于折算卡片位移、判断边缘自动滚动；
 * - 拖到边缘时程序化滚动页面。
 * 用 context 传递，避免把设置页的滚动容器改成全局单例。
 */
export interface SettingsScrollMetrics {
  /** 可视区顶部在窗口坐标中的位置 */
  top: number;
  /** 可视区高度 */
  height: number;
  /** 滚动内容总高度 */
  contentHeight: number;
}

export interface SettingsScrollController {
  scrollOffset: SharedValue<number>;
  metrics: SharedValue<SettingsScrollMetrics>;
  lock: (locked: boolean) => void;
  scrollTo: (y: number) => void;
}

export const SettingsScrollContext = createContext<SettingsScrollController | null>(null);

export function useSettingsScrollController(): SettingsScrollController | null {
  return useContext(SettingsScrollContext);
}
