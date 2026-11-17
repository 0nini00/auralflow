import { create } from "zustand";
import { createCloudDriveState, type CloudDriveState } from "@lx/core";
import { getCloudSongs } from "@/services/wyAccountService";
import { clearCloudDriveSnapshot, loadCloudDriveSnapshot, saveCloudDriveSnapshot } from "@/services/cloudDriveCache";

/**
 * 云盘每页条数。接口实测接受 200，且对 200 的请求会一次返回整个云盘（161 首），
 * 所以「进页面就能看到全部」；更大的库由 hasMore/nextOffset 继续翻页。
 */
const PAGE_SIZE = 200;

/** 状态机在 `@lx/core` 的 `cloud-drive-store`（与移动端共用），这里只接上桌面的取页与落盘。 */
export const useCloudDriveStore = create<CloudDriveState>(
  createCloudDriveState({
    pageSize: PAGE_SIZE,
    // 用箭头函数包一层而不是直接传函数引用：调用时才解析导入，模块初始化顺序变化
    // （循环依赖、测试替身）不会让这里捕获到一个尚未就绪的绑定。
    fetchPage: (request) => getCloudSongs(request),
    loadSnapshot: (uid) => loadCloudDriveSnapshot(uid),
    saveSnapshot: (uid, snapshot) => saveCloudDriveSnapshot(uid, snapshot),
    clearSnapshot: (uid) => clearCloudDriveSnapshot(uid),
    reportSnapshotError: (error) => console.error("[cloud-drive] 云盘列表缓存写入失败", error),
  }),
);
