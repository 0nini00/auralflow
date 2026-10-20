import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import { getCloudSongs } from "@/services/wyCloudService";

/**
 * 音乐云盘的列表缓存（移动端）。
 *
 * 为什么要有它：云盘页原来把列表放在组件 state 里，每次进栈都从头拉一遍——用户只是去
 * 别的页面听首歌再回来，也要重新等一次 weapi 请求，列表还会先被清空再填回来。桌面端
 * 早就有 `stores/cloudDriveStore` 做这件事，两端行为应当一致：**同一账号只要加载过就复用，
 * 只有换账号或用户明确点「刷新」才重新请求。**
 *
 * 列表与账号强绑定，所以缓存键就是 `accountUid`：退出登录（传空串）会清空，切账号会作废
 * 在飞的请求，绝不让上一个账号的条目留在界面上。
 */

/**
 * 每页条数：沿用移动端原来的 50（桌面端是 200）。移动端列表是虚拟化的，单页小一点
 * 可以减少一次进页面时的解析与内存峰值；翻页仍由 hasMore 驱动。
 */
const PAGE_SIZE = 50;

interface CloudDriveState {
  songs: MusicInfo[];
  /** 云盘内歌曲总数（接口的 count，不是已加载条数） */
  count: number;
  usedBytes?: number;
  maxBytes?: number;
  /** 下一页起点：由接口原始条数推进（见 getCloudSongs 的 nextOffset 说明） */
  nextOffset: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  /** 当前列表归属的账号 uid；换账号后旧列表必须整体丢弃 */
  accountUid: string;
  /** 首屏是否已尝试加载过（用于区分「还没加载」和「确实为空」） */
  loaded: boolean;

  initialize: (accountUid: string, options?: { force?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  /** 用户点「刷新」/ 下拉刷新：强制从头拉 */
  refresh: () => Promise<void>;
}

/** 追加一页并按 `source:id` 去重：翻页期间账号增删条目会让 offset 错位。 */
function mergePage(current: MusicInfo[], incoming: MusicInfo[]): MusicInfo[] {
  const seen = new Set(current.map((song) => `${song.source}:${song.id}`));
  const merged = [...current];
  for (const song of incoming) {
    const key = `${song.source}:${song.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(song);
  }
  return merged;
}

/**
 * 请求世代：账号切换 / 退出登录时递增，晚到的响应直接丢弃。
 * 否则退出登录清空列表后，仍在飞的响应会把上一个账号的文件写回来。
 */
let generation = 0;
let inflight: Promise<void> | null = null;
let inflightGeneration = -1;

export const useCloudDriveStore = create<CloudDriveState>((set, get) => {
  const fetchPage = async (offset: number, replace: boolean) => {
    const requestGeneration = generation;
    const page = await getCloudSongs({ offset, limit: PAGE_SIZE });
    if (requestGeneration !== generation) return; // 账号已切换，结果作废
    set((state) => ({
      songs: replace ? page.songs : mergePage(state.songs, page.songs),
      count: page.count,
      usedBytes: page.usedBytes,
      maxBytes: page.maxBytes,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore,
      loading: false,
      loadingMore: false,
      error: "",
      loaded: true,
    }));
  };

  const run = (task: Promise<void>, onError: (error: unknown) => void) => {
    const taskGeneration = generation;
    inflightGeneration = taskGeneration;
    inflight = task
      .catch((error: unknown) => {
        if (taskGeneration !== generation) return;
        onError(error);
      })
      .finally(() => {
        if (inflightGeneration === taskGeneration) {
          inflight = null;
          inflightGeneration = -1;
        }
      });
    return inflight;
  };

  return {
    songs: [],
    count: 0,
    usedBytes: undefined,
    maxBytes: undefined,
    nextOffset: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: "",
    accountUid: "",
    loaded: false,

    initialize: async (accountUid, options) => {
      const state = get();
      const sameAccount = state.accountUid === accountUid;

      if (!accountUid) {
        // 退出登录：立刻清空并作废在飞的请求
        generation += 1;
        inflight = null;
        inflightGeneration = -1;
        set({
          songs: [],
          count: 0,
          usedBytes: undefined,
          maxBytes: undefined,
          nextOffset: 0,
          hasMore: false,
          error: "",
          accountUid: "",
          loaded: false,
          loading: false,
          loadingMore: false,
        });
        return;
      }

      // 关键的一条：同账号且已加载过，进页面就不该再请求。
      if (sameAccount && state.loaded && !options?.force) return;
      // 同一账号的并发调用合并；换账号必须新起一条，不能复用旧账号的结果
      if (inflight && inflightGeneration === generation && sameAccount) return inflight;

      if (!sameAccount) {
        generation += 1;
        inflight = null;
        inflightGeneration = -1;
      }

      set({
        accountUid,
        loading: true,
        error: "",
        // 换账号时先清空，避免短暂显示上一个账号的条目
        songs: sameAccount ? state.songs : [],
        nextOffset: 0,
        hasMore: false,
        loaded: sameAccount ? state.loaded : false,
      });

      return run(fetchPage(0, true), (error) => {
        set({
          loading: false,
          loadingMore: false,
          error: error instanceof Error ? error.message : String(error),
          loaded: true,
        });
      });
    },

    loadMore: async () => {
      const state = get();
      if (state.loading || state.loadingMore) return;
      if (!state.hasMore) return;
      if (inflight) return inflight;

      set({ loadingMore: true, error: "" });
      return run(fetchPage(state.nextOffset, false), (error) => {
        set({
          loading: false,
          loadingMore: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },

    refresh: async () => {
      const { accountUid } = get();
      if (!accountUid) return;
      await get().initialize(accountUid, { force: true });
    },
  };
});
