import { create } from "zustand";
import type { LocalSong } from "../services/localMusicService";
import { LocalMusicService } from "../services/localMusicService";
import { attachLibraryPersistence } from "./libraryPersistence";
import { mergeLibraryRefreshResults, type LibraryScanResult } from "./libraryRefreshModel";
import { localLyricsModeOf } from "../services/localLyricsChoiceModel";
import {
  dropLocalLyricsOrphans,
  normalizeLocalLyricsOrphanTable,
  rebindLocalLyricsChoices,
  recordLocalLyricsChoiceOrphans,
  type LocalLyricsOrphanTable,
} from "../services/localLyricsChoiceOrphan";

interface LibraryStore {
  localSongs: LocalSong[];
  /**
   * 按内容哈希索引的「孤儿选择」表：文件被改名 / 移动 / 移出扫描目录后，记录 id（= md5(路径)）
   * 跟着变了，挂在旧记录上的歌词选择先寄存到这里，等新记录出现时按内容认回
   * （见 services/localLyricsChoiceOrphan）。与 localSongs 同一个 library 命名空间落盘。
   */
  lyricsChoicesByHash: LocalLyricsOrphanTable;
  scanPaths: string[];
  isScanning: boolean;
  setSongs: (songs: LocalSong[]) => void;
  addSongs: (songs: LocalSong[]) => void;
  updateSong: (id: string, patch: Partial<LocalSong>) => void;
  removeSong: (id: string) => void;
  clearLibrary: () => void;
  resetLibrary: () => void;
  addScanPath: (path: string) => void;
  removeScanPath: (path: string) => void;
  setScanning: (isScanning: boolean) => void;
  refreshLibrary: () => Promise<{ added: number; removed: number; failedPaths: string[] }>;
}

/** Monotonic token: only the latest refresh may write results / clear isScanning. */
let libraryRefreshToken = 0;

export const useLibraryStore = create<LibraryStore>()((set, get) => {
  /**
   * 把孤儿表里的选择认回到「还没有选择」的记录上，并把结果落回 store。
   *
   * 只在记录进入曲库的两处调用：扫描合并之后，以及新记录被添加之后（改名 / 移动过的文件要
   * 重新添加目录 / 添加文件才会回到曲库）。为什么要跟着这两个入口而不是别处：`hashLocalFile`
   * 一次就是一遍整文件读盘，只能由「记录真的进了库」来触发；而孤儿表通常是空的，空表时这里
   * 立刻返回，所以绝大多数扫描是零读盘。
   *
   * `isCurrent` 由调用方给出：哈希期间用户可能自己选好了，或又发生了一次扫描，作废的补丁不写。
   */
  const rebindOrphanedChoices = async (
    candidates: readonly LocalSong[],
    isCurrent: () => boolean,
  ): Promise<void> => {
    const { lyricsChoicesByHash } = get();
    // 常态（曲库没经历过改名 / 移动）：表里没东西，一个文件都不读。
    if (Object.keys(lyricsChoicesByHash).length === 0) return;

    const rebind = await rebindLocalLyricsChoices({ songs: candidates, table: lyricsChoicesByHash });
    if (rebind.patchById.size === 0 || !isCurrent()) return;

    set((state) => ({
      localSongs: state.localSongs.map((song) => {
        const patch = rebind.patchById.get(song.id);
        // 已有明确选择的记录不许被孤儿换掉：用户的意志优先于一张「猜」出来的匹配表。
        if (!patch || localLyricsModeOf(song) !== "auto") return song;
        return { ...song, ...patch };
      }),
      lyricsChoicesByHash: dropLocalLyricsOrphans(state.lyricsChoicesByHash, rebind.consumedHashes),
    }));
  };

  return {
    localSongs: [],
    lyricsChoicesByHash: {},
    scanPaths: [],
    isScanning: false,

    setSongs: (songs) => set({ localSongs: songs }),

    addSongs: (songs) => {
      // 同 id 的旧记录优先：与既有行为一致（重新添加文件不会覆盖用户改过的字段）。
      const existingIds = new Set(get().localSongs.map((song) => song.id));
      const addedSongs = songs.filter((song) => !existingIds.has(song.id));
      if (addedSongs.length === 0) return;
      set((state) => ({ localSongs: [...state.localSongs, ...addedSongs] }));
      // 新记录可能就是刚被改名 / 移动的那首歌（重新添加目录 / 添加文件才会回到曲库）：
      // 按内容把选择认回来，用户不必重选。
      void rebindOrphanedChoices(addedSongs, () => true);
    },

    updateSong: (id, patch) =>
      set((state) => ({
        localSongs: state.localSongs.map((song) => (song.id === id ? { ...song, ...patch } : song)),
      })),

    removeSong: (id) =>
      set((state) => ({
        localSongs: state.localSongs.filter((song) => song.id !== id),
      })),

    // 清空 / 重置曲库：孤儿表里那份歌词文本属于已消失的记录，曲库都清了没有理由继续留着。
    clearLibrary: () => set({ localSongs: [], lyricsChoicesByHash: {} }),
    resetLibrary: () => set({ localSongs: [], scanPaths: [], lyricsChoicesByHash: {} }),

    addScanPath: (path) =>
      set((state) => {
        if (state.scanPaths.includes(path)) return state;
        return { scanPaths: [...state.scanPaths, path] };
      }),

    removeScanPath: (path) =>
      set((state) => ({
        scanPaths: state.scanPaths.filter((item) => item !== path),
      })),

    setScanning: (isScanning) => set({ isScanning }),

    refreshLibrary: async () => {
      const { scanPaths } = get();
      if (scanPaths.length === 0) return { added: 0, removed: 0, failedPaths: [] };

      // Only the latest refresh may write results / clear isScanning
      const token = ++libraryRefreshToken;
      set({ isScanning: true });
      try {
        const pathsSnapshot = [...get().scanPaths];
        const scanResults: LibraryScanResult[] = await Promise.all(
          pathsSnapshot.map(async (path) => {
            try {
              return { path, ok: true as const, songs: await LocalMusicService.scanDirectory(path) };
            } catch (error) {
              return { path, ok: false as const, error };
            }
          }),
        );

        if (token !== libraryRefreshToken) {
          return { added: 0, removed: 0, failedPaths: [] };
        }

        // Re-read localSongs at merge time so mid-scan edits are not blindly clobbered
        const { localSongs, lyricsChoicesByHash } = get();
        const result = mergeLibraryRefreshResults({
          scanPaths: pathsSnapshot,
          localSongs,
          scanResults,
        });

        // 记录消失 = 文件被改名 / 移动 / 移出扫描目录。记录 id 是 md5(路径)，换个名字就是另一条
        // 记录，选择若只挂在记录上会跟着一起消失；先把选择按**内容哈希**搬进孤儿表（纯计算，
        // 不读盘），记录没了、选择还在，等新记录出现时再认回。
        const orphanedTable = recordLocalLyricsChoiceOrphans(
          lyricsChoicesByHash,
          result.removedSongs,
          Date.now(),
        );
        set({ localSongs: result.songs, lyricsChoicesByHash: orphanedTable });

        // 自动重绑：只对「没有选择」的记录做，且只有 size 恰好与某个孤儿条目相同才去读文件哈希
        // （见 rebindLocalLyricsChoices：不做全库哈希）。
        await rebindOrphanedChoices(result.songs, () => token === libraryRefreshToken);

        return {
          added: result.added,
          removed: result.removed,
          failedPaths: result.failedPaths,
        };
      } finally {
        if (token === libraryRefreshToken) {
          set({ isScanning: false });
        }
      }
    },
  };
});

attachLibraryPersistence<
  LibraryStore,
  { localSongs: LocalSong[]; scanPaths: string[]; lyricsChoicesByHash: LocalLyricsOrphanTable }
>(useLibraryStore, {
  namespace: "library",
  // 落盘前再过一道：即使载入的旧数据带着 base64，也不会再写回大文件
  pick: (state) => ({
    localSongs: stripLegacyCoverBlobs(state.localSongs),
    scanPaths: state.scanPaths,
    lyricsChoicesByHash: state.lyricsChoicesByHash,
  }),
  apply: (slice, set) =>
    set({
      localSongs: stripLegacyCoverBlobs(slice.localSongs ?? []),
      scanPaths: slice.scanPaths ?? [],
      // 旧版本没有这张表，被外部改坏也可能：过一道校验，认不出的条目一律丢弃。
      lyricsChoicesByHash: normalizeLocalLyricsOrphanTable(slice.lyricsChoicesByHash),
    }),
  legacyLocalStorageKey: "library-storage",
});

/**
 * 剔除历史版本持久化下来的大字段。
 *
 * 旧版本把内嵌封面 base64（cover_data，以及 cover 里的 data URL）和整库歌词一并写进
 * library.json：一个几千首的库就是几百 MB 的 JSON，每次写盘全量重写、启动全量常驻内存。
 * 这些内容都能从音频文件重新扫描得到（新版本会落成封面缓存里的短路径），直接丢弃。
 */
function stripLegacyCoverBlobs(songs: LocalSong[]): LocalSong[] {
  let changed = false;
  const cleaned = songs.map((raw) => {
    const song = raw as LocalSong & { cover_data?: unknown; lyrics?: unknown };
    const hasLegacyFields = song.cover_data !== undefined || song.lyrics !== undefined;
    const hasInlineCover = typeof song.cover === "string" && song.cover.startsWith("data:");
    if (!hasLegacyFields && !hasInlineCover) return raw;

    changed = true;
    const { cover_data: _coverData, lyrics: _lyrics, cover, ...rest } = song;
    void _coverData;
    void _lyrics;
    return (hasInlineCover ? rest : { ...rest, cover }) as LocalSong;
  });
  return changed ? cleaned : songs;
}
