import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getDownloadedLocalSongs,
  isDownloadedLocalSong,
  pickLocalAudioFiles,
  scanLocalMusic,
  updateLocalMusicMetadata,
} from "../services/localMusicService";
import { buildLocalMusicMetadataUpdate, type LocalMusicMetadataInput } from "@/services/localMusicMetadataModel";
import {
  buildLocalLyricsChoicePatch,
  hasLocalLyricsChoice,
  type LocalLyricsChoiceFields,
  type LocalLyricsChoiceRequest,
} from "@/services/localLyricsChoiceModel";
import {
  collectLyricsChoiceOrphans,
  lyricsChoiceRequestFromOrphan,
  type LocalLyricsChoiceOrphan,
} from "@/services/localLyricsChoiceOrphanModel";
import { claimLyricsChoiceOrphan, rememberLyricsChoiceOrphans } from "@/services/localLyricsChoiceOrphanStore";

import {
  applyLocalMetadataEdit,
  mergeManualLocalSongs,
  parseLocalSongs,
  reconcileLocalMusic,
  type LocalMusicInfo,
} from "../services/localMusicScanModel";

export const LOCAL_MUSIC_KEY = "auralflow.mobile.localMusic";

export interface LocalMusicState {
  localSongs: LocalMusicInfo[];
  loading: boolean;
  error: string | null;
}

interface LocalMusicActions {
  loadLocalSongs: () => Promise<void>;
  scanMusic: () => Promise<void>;
  /** 手动挑选音频文件并合并进本地曲库（不覆盖已有扫描结果）。 */
  importLocalFiles: () => Promise<{ added: number; total: number }>;
  removeLocalSong: (song: Pick<MusicInfo, "id" | "source">) => Promise<void>;
  updateLocalSongMetadata: (
    song: Pick<MusicInfo, "id" | "source">,
    input: LocalMusicMetadataInput,
  ) => Promise<void>;
  /** 「选择歌词」面板的落点：只改歌词选择字段与按曲文本，不触碰媒体库标签与文件。 */
  setLocalSongLyricsChoice: (
    song: Pick<MusicInfo, "id" | "source">,
    request: LocalLyricsChoiceRequest,
  ) => Promise<void>;
  /**
   * 歌词选择孤儿认领：解析路径已经拿到文件指纹时调用（那里是唯一不用额外花钱就有指纹的地方）。
   * 记录还没有自己的选择、而这份内容正是某条消失记录的选择所绑定的内容时，把选择搬回记录并清掉孤儿。
   * 返回搬回的选择字段，让本次解析立刻用上，不必等下一次读记录。
   */
  claimOrphanedLyricsChoice: (
    song: Pick<MusicInfo, "id" | "source">,
    fingerprint: string,
  ) => Promise<(LocalLyricsChoiceFields & { localLyrics?: string }) | null>;
  clearLocalMusic: () => Promise<void>;
}

type LocalMusicStore = LocalMusicState & LocalMusicActions;

let localSongsLoadPromise: Promise<void> | null = null;
let localSongsHydrated = false;
let localSongsOperationTail: Promise<void> = Promise.resolve();

function serializeLocalMusicOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = localSongsOperationTail.then(operation);
  // 队列恢复仅用于接纳后续操作；调用方仍接收原始 result 的拒绝，错误不被吞掉。
  localSongsOperationTail = result.then(() => undefined, () => undefined);
  return result;
}

async function ensureLocalSongsLoaded(get: () => LocalMusicStore): Promise<void> {
  if (!localSongsHydrated || localSongsLoadPromise) await get().loadLocalSongs();
}

type LocalSongsUpdate = (songs: LocalMusicInfo[]) => LocalMusicInfo[] | Promise<LocalMusicInfo[]>;

/** 本地曲库的身份判定：id + source，两处认领逻辑都靠它找到目标记录。 */
function isSameLocalSong(
  item: Pick<MusicInfo, "id" | "source">,
  song: Pick<MusicInfo, "id" | "source">,
): boolean {
  return String(item.id) === String(song.id) && item.source === song.source;
}

/**
 * 认领没写成（曲库写盘失败，或期间记录已被人改过）时把孤儿放回。
 * 放回失败不覆盖原始错误：一次存储故障不该让用户的选择从此消失，但调用方更需要知道真正的原因。
 */
async function restoreLyricsChoiceOrphan(orphan: LocalLyricsChoiceOrphan): Promise<void> {
  try {
    await rememberLyricsChoiceOrphans([orphan]);
  } catch {
    // 孤儿表是可重建的认回线索，放不回去也不能把播放路径或扫描拖进异常。
  }
}

export const useLocalMusicStore = create<LocalMusicStore>((set, get) => {
  // 所有写入共享同一提交边界：读取当前态、变换、落盘、发布内存态不可交错。
  const commitLocalSongs = (update: LocalSongsUpdate, removeStorage = false) => serializeLocalMusicOperation(async () => {
    try {
      const current = get().localSongs;
      const songs = await update(current);
      if (removeStorage) {
        await AsyncStorage.removeItem(LOCAL_MUSIC_KEY);
      } else {
        await AsyncStorage.setItem(LOCAL_MUSIC_KEY, JSON.stringify(songs));
      }
      set({ localSongs: songs, loading: false, error: null });
      return { added: songs.length - current.length, total: songs.length };
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "保存本地音乐失败", loading: false });
      throw error;
    }
  });

  return {
    localSongs: [],
    loading: false,
    error: null,

    loadLocalSongs: async () => {
      if (localSongsLoadPromise) return localSongsLoadPromise;
      localSongsLoadPromise = serializeLocalMusicOperation(async () => {
        try {
          set({ loading: true, error: null });
          const raw = await AsyncStorage.getItem(LOCAL_MUSIC_KEY);
          set({ localSongs: parseLocalSongs(raw), loading: false });
          localSongsHydrated = true;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "加载本地音乐失败", loading: false });
          throw error;
        }
      });
      try {
        await localSongsLoadPromise;
      } finally {
        localSongsLoadPromise = null;
      }
    },

    scanMusic: async () => {
      set({ loading: true, error: null });
      try {
        await ensureLocalSongsLoaded(get);
        set({ loading: true, error: null });
        // 并行查询 MediaStore 与检查已知下载文件，不枚举下载目录或重建孤儿文件索引。
        const [scanned, downloaded] = await Promise.all([
          scanLocalMusic(get().localSongs),
          getDownloadedLocalSongs(get().localSongs),
        ]);
        // 扫描只看得见文件，看不见用户表达过的歌词意志：本范围内消失的记录（改名 / 移动 / 移出
        // 扫描范围）先把选择登记进孤儿表，等同一份内容再出现时按指纹认回。
        const removed: LocalMusicInfo[] = [];
        await commitLocalSongs(async (songs) => {
          const merged = reconcileLocalMusic(songs, [scanned, downloaded], (song) => removed.push(song));
          // 先登记孤儿、后提交曲库：反过来的话中途失败就会永久丢选择；这个顺序最坏只留下一条无主孤儿，
          // 它会被「记录已有自己的选择就不认领」挡住，最终由上限淘汰。
          await rememberLyricsChoiceOrphans(collectLyricsChoiceOrphans(removed, Date.now()));
          return merged;
        });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "扫描失败", loading: false });
        throw error;
      }
    },

    importLocalFiles: async () => {
      set({ loading: true, error: null });
      try {
        await ensureLocalSongsLoaded(get);
        set({ loading: true, error: null });
        const picked = await pickLocalAudioFiles();
        return await commitLocalSongs((songs) => mergeManualLocalSongs(songs, picked));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "导入失败", loading: false });
        throw error;
      }
    },

    removeLocalSong: async (song) => {
      await ensureLocalSongsLoaded(get);
      await commitLocalSongs((songs) => songs.filter(
        (item) => !(String(item.id) === String(song.id) && item.source === song.source),
      ));
    },

    updateLocalSongMetadata: async (song, input) => {
      await ensureLocalSongsLoaded(get);
      const patch = buildLocalMusicMetadataUpdate(input);
      await commitLocalSongs(async (songs) => {
        const current = songs.find((item) => item.id === song.id && item.source === song.source);
        const downloaded = isDownloadedLocalSong(current ?? song);
        // 下载曲编辑只保存在本地曲库；记录字段名，避免刷新时被旧下载元数据覆盖。
        if (!downloaded) await updateLocalMusicMetadata(String(song.id), patch);
        return songs.map((item) => {
          if (String(item.id) !== String(song.id) || item.source !== song.source) return item;
          return downloaded ? applyLocalMetadataEdit(item, patch) : { ...item, ...patch };
        });
      });
    },
    setLocalSongLyricsChoice: async (song, request) => {
      await ensureLocalSongsLoaded(get);
      const patch = buildLocalLyricsChoicePatch(request);
      await commitLocalSongs((songs) => songs.map((item) => {
        if (String(item.id) !== String(song.id) || item.source !== song.source) return item;
        // 走「用户编辑」路径标记字段：重新扫描才不会把它当成未编辑值清掉。
        return applyLocalMetadataEdit(item, patch);
      }));
    },

    /**
     * 认领是「取走 + 写回曲库」两步，必须防两种情形：
     * 记录在这期间已经被人改过（以用户的显式选择为准，孤儿留给别的记录）、曲库写盘失败（把孤儿放回）。
     */
    claimOrphanedLyricsChoice: async (song, fingerprint) => {
      await ensureLocalSongsLoaded(get);
      const target = get().localSongs.find((item) => isSameLocalSong(item, song));
      // 记录已经有自己的选择（哪怕已随内容变更失效）时不认领：孤儿只认「还没有主人」的记录。
      if (!target || hasLocalLyricsChoice(target)) return null;
      // 命中才写盘：绝大多数本地曲既没有选择也没有孤儿，这条路径不该给播放加任何存储往返。
      const orphan = await claimLyricsChoiceOrphan(fingerprint);
      if (!orphan) return null;
      const patch = buildLocalLyricsChoicePatch(lyricsChoiceRequestFromOrphan(orphan));
      let adopted = false;
      try {
        await commitLocalSongs((songs) => songs.map((item) => {
          if (!isSameLocalSong(item, song) || hasLocalLyricsChoice(item)) return item;
          adopted = true;
          // 与面板同一条落盘路径：标记用户编辑字段，重新扫描才不会把它当未编辑值清掉。
          return applyLocalMetadataEdit(item, patch);
        }));
      } catch (error) {
        await restoreLyricsChoiceOrphan(orphan);
        throw error;
      }
      if (!adopted) {
        await restoreLyricsChoiceOrphan(orphan);
        return null;
      }
      return patch;
    },

    clearLocalMusic: async () => {
      await ensureLocalSongsLoaded(get);
      await commitLocalSongs(() => [], true);
    },
  };
});
