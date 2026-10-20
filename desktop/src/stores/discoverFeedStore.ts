/**
 * 发现页 / 排行榜页共用的网易云公开数据。
 *
 * 单独开一个 store 而不是各页自己 useState，有两个具体理由：
 *
 * 1. 发现页与排行榜页请求的是同一份榜单清单。各页各拉一次，切页就是两次 /api/toplist，
 *    弱网下还会出现「发现页有封面、排行榜页没有」的不一致。
 * 2. 首页排行榜区块要的是「首个官方榜的前 10 首」，那是一次 100 首的详情请求。用户
 *    在首页与排行榜页之间来回切时，这份数据应当还在（10 分钟 TTL），不然每切一次就
 *    白拉一次整榜。
 *
 * 所有数据都与账号无关：未登录用户进发现页也必须看到内容。因此这里不读 Cookie、
 * 不监听账号变化，也就没有「切账号竞态」这类问题需要防。
 */
import { create } from "zustand";
import type { MusicInfo, PlaylistInfo, WyLeaderboardBoard } from "@lx/core";
import {
  fetchWyLeaderboardBoards,
  fetchWyRecommendedPlaylists,
} from "@/services/wyDiscoverService";
import { getSource } from "@/services/sources/sourceService";

/** 缓存有效期。榜单一天内变不了多少，推荐歌单更慢；10 分钟足够挡住切页抖动。 */
export const DISCOVER_FEED_TTL_MS = 10 * 60 * 1000;
/** 发现页排行榜区块展示的试读首数。 */
const PREVIEW_LIMIT = 10;
const RECOMMENDED_LIMIT = 12;

type SectionStatus = "idle" | "loading" | "ready" | "error";

interface DiscoverFeedState {
  recommended: PlaylistInfo[];
  recommendedStatus: SectionStatus;
  recommendedError: string;

  boards: WyLeaderboardBoard[];
  boardsStatus: SectionStatus;
  boardsError: string;
  /** `/api/toplist` 失败时为 true：榜单仍可点，但没有封面与 TOP3。 */
  boardsDegraded: boolean;

  previewBoardId: string;
  previewBoardName: string;
  previewSongs: MusicInfo[];
  previewStatus: SectionStatus;
  previewError: string;

  fetchedAt: number;
  load: (options?: { force?: boolean }) => Promise<void>;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? "").trim();
  return text || fallback;
}

export const useDiscoverFeedStore = create<DiscoverFeedState>((set, get) => {
  // 同一次刷新只发一轮请求：并发调用（发现页与排行榜页同时挂载）共享同一个 Promise。
  let inFlight: Promise<void> | null = null;
  // 代次：强制刷新会让上一轮的结果作废，避免旧响应覆盖新数据。
  let generation = 0;

  const loadPreview = async (board: WyLeaderboardBoard, requestGeneration: number) => {
    set({ previewBoardId: board.id, previewBoardName: board.name });
    const provider = getSource("wy");
    if (!provider?.getPlaylistDetail) {
      set({ previewStatus: "error", previewError: "未找到网易云音源", previewSongs: [] });
      return;
    }
    try {
      const songs = await provider.getPlaylistDetail({
        id: board.id,
        name: board.name,
        author: "网易云音乐",
        source: "wy",
      });
      if (requestGeneration !== generation) return;
      set({
        previewSongs: songs.slice(0, PREVIEW_LIMIT),
        previewStatus: songs.length > 0 ? "ready" : "error",
        previewError: songs.length > 0 ? "" : "这个榜单没有返回歌曲",
      });
    } catch (error) {
      if (requestGeneration !== generation) return;
      set({
        previewSongs: [],
        previewStatus: "error",
        previewError: errorText(error, "榜单试读加载失败"),
      });
    }
  };

  const run = async () => {
    const requestGeneration = ++generation;
    set({
      recommendedStatus: "loading",
      recommendedError: "",
      boardsStatus: "loading",
      boardsError: "",
      previewStatus: "loading",
      previewError: "",
    });

    const [recommendedResult, boardsResult] = await Promise.allSettled([
      fetchWyRecommendedPlaylists(RECOMMENDED_LIMIT),
      fetchWyLeaderboardBoards(),
    ]);
    if (requestGeneration !== generation) return;

    if (recommendedResult.status === "fulfilled") {
      set({
        recommended: recommendedResult.value,
        recommendedStatus: recommendedResult.value.length > 0 ? "ready" : "error",
        recommendedError: recommendedResult.value.length > 0 ? "" : "推荐歌单为空",
      });
    } else {
      set({
        recommended: [],
        recommendedStatus: "error",
        recommendedError: errorText(recommendedResult.reason, "推荐歌单加载失败"),
      });
    }

    const boards = boardsResult.status === "fulfilled"
      ? boardsResult.value.boards
      : [];
    if (boardsResult.status === "fulfilled") {
      set({
        boards,
        boardsDegraded: boardsResult.value.degraded,
        boardsStatus: "ready",
        boardsError: "",
      });
    } else {
      set({
        boards: [],
        boardsStatus: "error",
        boardsError: errorText(boardsResult.reason, "排行榜加载失败"),
      });
    }

    // 试读固定取首个官方榜（飙升榜）：它是「现在在火什么」最直接的一列。
    const firstOfficial = boards.find((board) => board.group === "official");
    if (firstOfficial) {
      await loadPreview(firstOfficial, requestGeneration);
    } else if (requestGeneration === generation) {
      set({ previewSongs: [], previewStatus: "idle", previewError: "" });
    }

    if (requestGeneration === generation) set({ fetchedAt: Date.now() });
  };

  return {
    recommended: [],
    recommendedStatus: "idle",
    recommendedError: "",
    boards: [],
    boardsStatus: "idle",
    boardsError: "",
    boardsDegraded: false,
    previewBoardId: "",
    previewBoardName: "",
    previewSongs: [],
    previewStatus: "idle",
    previewError: "",
    fetchedAt: 0,

    load: async (options) => {
      const force = options?.force === true;
      const { fetchedAt, recommendedStatus, boardsStatus } = get();
      const fresh = Date.now() - fetchedAt < DISCOVER_FEED_TTL_MS;
      if (!force && fresh && recommendedStatus !== "error" && boardsStatus !== "error") return;
      if (inFlight) return inFlight;
      inFlight = run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
});
