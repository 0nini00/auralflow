import { create } from "zustand";
import { createCloudDriveState, type CloudDriveState } from "@lx/core";
import { getCloudSongs } from "@/services/wyCloudService";
import { clearCloudDriveSnapshot, loadCloudDriveSnapshot, saveCloudDriveSnapshot } from "@/services/cloudDriveCache";
import { logger } from "@/services/logger";

/**
 * 音乐云盘的列表缓存（移动端）。
 *
 * 为什么要有它：云盘页原来把列表放在组件 state 里，每次进栈都从头拉一遍——用户只是去
 * 别的页面听首歌再回来，也要重新等一次 weapi 请求，列表还会先被清空再填回来。
 * **同一账号只要加载过就复用，只有换账号或用户明确点「刷新」才重新请求。**
 *
 * 状态机在 `@lx/core` 的 `cloud-drive-store`（与桌面端共用），这里只接上移动端的
 * 取页与落盘。
 */

/**
 * 每页条数：沿用移动端原来的 50（桌面端是 200）。移动端列表是虚拟化的，单页小一点
 * 可以减少一次进页面时的解析与内存峰值；翻页仍由 hasMore 驱动。
 */
const PAGE_SIZE = 50;

export const useCloudDriveStore = create<CloudDriveState>(
  createCloudDriveState({
    pageSize: PAGE_SIZE,
    // 用箭头函数包一层而不是直接传函数引用：调用时才解析导入，模块初始化顺序变化
    // （循环依赖、测试替身）不会让这里捕获到一个尚未就绪的绑定。
    fetchPage: (request) => getCloudSongs(request),
    loadSnapshot: (uid) => loadCloudDriveSnapshot(uid),
    saveSnapshot: (uid, snapshot) => saveCloudDriveSnapshot(uid, snapshot),
    clearSnapshot: (uid) => clearCloudDriveSnapshot(uid),
    reportSnapshotError: (error) => logger.warn("[cloud-drive] 云盘列表缓存写入失败", error),
  }),
);
