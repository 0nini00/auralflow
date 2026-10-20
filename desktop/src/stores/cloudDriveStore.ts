import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import { getCloudSongs } from "@/services/wyAccountService";
import { clearCloudDriveSnapshot, loadCloudDriveSnapshot, saveCloudDriveSnapshot } from "@/services/cloudDriveCache";

/**
 * 云盘每页条数。接口实测接受 200，且对 200 的请求会一次返回整个云盘（161 首），
 * 所以「进页面就能看到全部」；更大的库由 hasMore/nextOffset 继续翻页。
 */
const PAGE_SIZE = 200;

interface CloudDriveState {
  songs: MusicInfo[];
  /** 云盘内歌曲总数（来自接口的 count，不是已加载条数） */
  count: number;
  /** 已用容量字节数 */
  usedBytes?: number;
  /** 容量上限字节数 */
  maxBytes?: number;
  /** 下一页起点：由接口原始条数推进（见 getCloudSongs 的 nextOffset 说明） */
  nextOffset: number;
  /** 是否还有下一页（接口给的结论，不由 songs.length 推断） */
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  /** 当前列表归属的账号 uid；换账号后旧列表必须整体丢弃 */
  accountUid: string;
  /** 首屏是否已尝试加载过（用于区分「还没加载」和「确实为空」） */
  loaded: boolean;

  /**
   * 首屏加载。uid 变化（含退出登录传空串）时清空旧列表再拉；
   * 同一账号且已加载过则默认复用，`force` 才重拉。
   */
  initialize: (accountUid: string, options?: { force?: boolean }) => Promise<void>;
  /** 加载下一页 */
  loadMore: () => Promise<void>;
  /** 用户点「刷新」：清空后从头拉 */
  refresh: () => Promise<void>;
}

/**
 * 追加一页并按 `source:id` 去重。
 *
 * 接口按 offset 翻页，理论上不会重复；但翻页期间账号里增删条目会让 offset 错位，
 * 不去重就会出现两条一模一样的行（React key 也会撞）。
 */
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
 * 请求世代。
 *
 * 每次账号切换 / 退出登录都递增：晚到的响应如果世代已经变了就直接丢弃。
 * 否则会出现两个真实事故：
 * 1. 退出的瞬间 `initialize("")` 清空了列表，但仍在飞的 `fetchPage` 随后把
 *    上一个账号的条目写回 state——界面在未登录状态下显示了别人的云盘。
 * 2. 切账号时新账号的 `initialize` 复用了旧账号的 in-flight promise，新账号
 *    拿到的是旧账号的列表，且 `refresh()` 因为 uid 已被写成空串而变成空操作。
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
    // 落盘缓存：下次冷启动先显示它（见 services/cloudDriveCache）。写失败不影响本次结果。
    const settled = get();
    void saveCloudDriveSnapshot(settled.accountUid, {
      songs: settled.songs,
      count: settled.count,
      usedBytes: settled.usedBytes,
      maxBytes: settled.maxBytes,
      nextOffset: settled.nextOffset,
      hasMore: settled.hasMore,
    }).catch(() => undefined);
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
        // 退出登录：立刻清空并作废在飞的请求，别让上一个账号的文件留在界面上；
        // 盘上那份也要删——把云盘内容留在磁盘上比多拉一次请求更糟。
        const previousUid = state.accountUid;
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
        if (previousUid) void clearCloudDriveSnapshot(previousUid).catch(() => undefined);
        return;
      }

      if (sameAccount && state.loaded && !options?.force) return;
      // 同一账号的并发调用合并；换了账号则必须新起一条，不能复用旧账号的结果
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

      /*
       * 冷启动 / 换账号：先读盘上的列表。
       * 10 分钟内直接采信（一次请求都不发）；过期则先把旧列表显示出来，再照常刷新——
       * 这就是「打开云盘不再每次都转圈」的关键：过期数据仍然比空白有用。
       * 用户点「刷新」时跳过这一步（force）：他明确要求新数据。
       */
      const hydrateGeneration = generation;
      const cached = options?.force ? null : await loadCloudDriveSnapshot(accountUid);
      if (hydrateGeneration !== generation || get().accountUid !== accountUid) return;
      if (cached) {
        set({
          songs: cached.snapshot.songs,
          count: cached.snapshot.count,
          usedBytes: cached.snapshot.usedBytes,
          maxBytes: cached.snapshot.maxBytes,
          nextOffset: cached.snapshot.nextOffset,
          hasMore: cached.snapshot.hasMore,
          loaded: true,
          // 保鲜期内没有后续请求了，别把「加载中」留给界面。
          loading: !cached.fresh,
        });
        if (cached.fresh) return;
      }

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
