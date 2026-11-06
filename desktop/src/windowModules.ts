import { lazy, type ComponentType } from "react";
import type { AppWindowRole } from "./utils/windowRole";

/** 窗口界面模块：不接受 props，渲染成该窗口的整棵界面树。 */
type WindowComponent = ComponentType<Record<string, never>>;
type WindowModule = { default: WindowComponent };

/**
 * 四个窗口共用同一个 index.html。过去所有视图都同步 import，于是打开迷你窗 / 歌词窗
 * 也要解析整个主窗口应用（搜索页 41KB、歌词窗 34KB 全部白读）。这里按窗口标签分流，
 * 主窗口内部再按路由拆一层（见 MainWindow.tsx）。
 *
 * 这张表是「窗口角色 -> 界面模块」的唯一真相源：App.tsx 用它建懒组件，
 * main.tsx 用它在本窗口渲染前预取。
 */
const windowLoaders: Record<AppWindowRole, () => Promise<WindowModule>> = {
  main: () => import("./MainWindow"),
  lyric: () => import("./views/LyricWindowView").then((module) => ({ default: module.LyricWindowView })),
  "lyric-unlock": () => import("./views/LyricUnlockView").then((module) => ({ default: module.LyricUnlockView })),
  "mini-player": () => import("./views/MiniPlayerView").then((module) => ({ default: module.MiniPlayerView })),
};

/** lazy() 只登记加载函数、不立刻加载：进到对应窗口才真正取 chunk。 */
export const windowComponents: Record<AppWindowRole, WindowComponent> = {
  main: lazy(windowLoaders.main),
  lyric: lazy(windowLoaders.lyric),
  "lyric-unlock": lazy(windowLoaders["lyric-unlock"]),
  "mini-player": lazy(windowLoaders["mini-player"]),
};

/** 错误边界的上下文名，用户反馈问题时用来指认是哪个窗口。 */
export const windowScopes: Record<AppWindowRole, string> = {
  main: "main-window",
  lyric: "lyric-window",
  "lyric-unlock": "lyric-unlock",
  "mini-player": "mini-player",
};

/** 渲染前先取本窗口的模块：窗口 show() 之后才可见，模块还在路上会先闪一帧空白。 */
export function preloadWindowModule(role: AppWindowRole): Promise<WindowModule> {
  return windowLoaders[role]();
}
