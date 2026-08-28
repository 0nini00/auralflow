import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MusicInfo } from "@lx/core";
import {
  checkBiliAccount,
  clearBiliCookie,
  getBiliCookie,
  getBiliCollectionSongs,
  getBiliSubscribedCollections,
  saveBiliCookie,
  type BiliAccountInfo,
  type BiliCollectionInfo,
} from "@/services/biliService";

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

interface BiliAccountState {
  account: BiliAccountInfo | null;
  playlists: BiliCollectionInfo[];
  hiddenCollectionIds: string[];
  knownCollectionIds: string[];
  newCollectionIds: string[];
  autoShowNewCollections: boolean;
  isLoading: boolean;
  isLoaded: boolean;
  error: string;

  load: (cookieStr?: string) => Promise<void>;
  logout: () => Promise<void>;
  getVisibleCollections: () => BiliCollectionInfo[];
  setCollectionVisible: (id: string, visible: boolean) => void;
  setAutoShowNewCollections: (enabled: boolean) => void;
  clearNewCollectionState: (id?: string) => void;
  getCollectionSongs: (id: string) => Promise<MusicInfo[]>;
  refreshCollectionSongs: (id: string) => Promise<MusicInfo[]>;
}

interface BiliCollectionVisibilityPreferences {
  hiddenCollectionIds: string[];
  knownCollectionIds: string[];
  newCollectionIds: string[];
  autoShowNewCollections: boolean;
}

/* ------------------------------------------------------------------ */
/* 持久化（AsyncStorage）                                                */
/* ------------------------------------------------------------------ */

const BILI_VISIBILITY_KEY = "auralflow.mobile.bili-collection-visibility";
const COLLECTION_CACHE_MAX = 20;
const collectionCache = new Map<string, MusicInfo[]>();

/** 写入缓存并按 LRU 淘汰最久未用的条目，避免会话内无限增长。 */
function cacheCollectionSongs(id: string, songs: MusicInfo[]): void {
  collectionCache.delete(id);
  collectionCache.set(id, songs);
  while (collectionCache.size > COLLECTION_CACHE_MAX) {
    const oldest = collectionCache.keys().next().value;
    if (oldest == null) break;
    collectionCache.delete(oldest);
  }
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

async function readVisibilityPreferences(): Promise<BiliCollectionVisibilityPreferences> {
  const fallback: BiliCollectionVisibilityPreferences = {
    hiddenCollectionIds: [],
    knownCollectionIds: [],
    newCollectionIds: [],
    autoShowNewCollections: false,
  };
  try {
    const raw = await AsyncStorage.getItem(BILI_VISIBILITY_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<BiliCollectionVisibilityPreferences>;
    return {
      hiddenCollectionIds: Array.isArray(parsed.hiddenCollectionIds)
        ? uniqueIds(parsed.hiddenCollectionIds)
        : [],
      knownCollectionIds: Array.isArray(parsed.knownCollectionIds)
        ? uniqueIds(parsed.knownCollectionIds)
        : [],
      newCollectionIds: Array.isArray(parsed.newCollectionIds)
        ? uniqueIds(parsed.newCollectionIds)
        : [],
      autoShowNewCollections: parsed.autoShowNewCollections === true,
    };
  } catch {
    return fallback;
  }
}

async function writeVisibilityPreferences(
  preferences: BiliCollectionVisibilityPreferences,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      BILI_VISIBILITY_KEY,
      JSON.stringify({
        hiddenCollectionIds: uniqueIds(preferences.hiddenCollectionIds),
        knownCollectionIds: uniqueIds(preferences.knownCollectionIds),
        newCollectionIds: uniqueIds(preferences.newCollectionIds),
        autoShowNewCollections: preferences.autoShowNewCollections,
      }),
    );
  } catch {}
}

function applyCollectionVisibilityUpdate(
  playlists: BiliCollectionInfo[],
  preferences: BiliCollectionVisibilityPreferences,
): BiliCollectionVisibilityPreferences {
  const currentIds = playlists.map((item) => item.id);
  const currentIdSet = new Set(currentIds);
  const knownIdSet = new Set(preferences.knownCollectionIds);
  const isFirstSync = knownIdSet.size === 0;
  const discoveredIds = isFirstSync ? [] : currentIds.filter((id) => !knownIdSet.has(id));
  const hiddenIdSet = new Set(
    preferences.hiddenCollectionIds.filter((id) => currentIdSet.has(id)),
  );

  if (!preferences.autoShowNewCollections) {
    discoveredIds.forEach((id) => hiddenIdSet.add(id));
  }

  return {
    hiddenCollectionIds: Array.from(hiddenIdSet),
    knownCollectionIds: uniqueIds([...preferences.knownCollectionIds, ...currentIds]),
    newCollectionIds: uniqueIds([
      ...preferences.newCollectionIds.filter((id) => currentIdSet.has(id)),
      ...discoveredIds,
    ]),
    autoShowNewCollections: preferences.autoShowNewCollections,
  };
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

// 初始可见性偏好（异步加载后会被 load 覆盖）
const initialVisibility: BiliCollectionVisibilityPreferences = {
  hiddenCollectionIds: [],
  knownCollectionIds: [],
  newCollectionIds: [],
  autoShowNewCollections: false,
};

// 应用启动时异步恢复可见性偏好
readVisibilityPreferences().then((prefs) => {
  useBiliAccountStore.setState({
    hiddenCollectionIds: prefs.hiddenCollectionIds,
    knownCollectionIds: prefs.knownCollectionIds,
    newCollectionIds: prefs.newCollectionIds,
    autoShowNewCollections: prefs.autoShowNewCollections,
  });
});

// load 串行化链：并发 load（页面挂载 + 设置页保存 Cookie）会重复请求 nav + 全量收藏
// 列表（易触发风控），且两次 writeVisibilityPreferences 竞态可能丢一次新合集发现；
// 后到的 load（如重新登录后的新 Cookie）排队执行，保证最终状态正确
let loadChain: Promise<void> = Promise.resolve();

export const useBiliAccountStore = create<BiliAccountState>((set, get) => ({
  account: null,
  playlists: [],
  hiddenCollectionIds: initialVisibility.hiddenCollectionIds,
  knownCollectionIds: initialVisibility.knownCollectionIds,
  newCollectionIds: initialVisibility.newCollectionIds,
  autoShowNewCollections: initialVisibility.autoShowNewCollections,
  isLoading: false,
  isLoaded: false,
  error: "",

  load: (cookieStr) => {
    const execute = async () => {
      try {
        const cookie = cookieStr ?? (await getBiliCookie());
        if (!cookie) {
          collectionCache.clear();
          set({ isLoaded: true, playlists: [], account: null, error: "" });
          return;
        }

        await saveBiliCookie(cookie);
        set({ isLoading: true, error: "" });

        const account = await checkBiliAccount();
        const playlists = await getBiliSubscribedCollections(account.uid);
        const visibility = applyCollectionVisibilityUpdate(playlists, {
          hiddenCollectionIds: get().hiddenCollectionIds,
          knownCollectionIds: get().knownCollectionIds,
          newCollectionIds: get().newCollectionIds,
          autoShowNewCollections: get().autoShowNewCollections,
        });
        await writeVisibilityPreferences(visibility);
        collectionCache.clear();
        set({ account, playlists, ...visibility, isLoaded: true, isLoading: false, error: "" });
      } catch (error) {
        collectionCache.clear();
        set({
          account: null,
          playlists: [],
          error: error instanceof Error ? error.message : String(error),
          isLoading: false,
          isLoaded: true,
        });
      }
    };
    loadChain = loadChain.then(execute);
    return loadChain;
  },

  logout: async () => {
    await clearBiliCookie();
    collectionCache.clear();
    set({
      account: null,
      playlists: [],
      isLoading: false,
      isLoaded: true,
      error: "",
    });
  },

  getVisibleCollections: () => {
    const hidden = new Set(get().hiddenCollectionIds);
    return get().playlists.filter((item) => !hidden.has(item.id));
  },

  setCollectionVisible: (id, visible) => {
    const current = get();
    const hidden = new Set(current.hiddenCollectionIds);
    if (visible) {
      hidden.delete(id);
    } else {
      hidden.add(id);
    }

    const next: BiliCollectionVisibilityPreferences = {
      hiddenCollectionIds: Array.from(hidden),
      knownCollectionIds: uniqueIds([...current.knownCollectionIds, id]),
      newCollectionIds: current.newCollectionIds.filter((item) => item !== id),
      autoShowNewCollections: current.autoShowNewCollections,
    };
    void writeVisibilityPreferences(next);
    set(next);
  },

  setAutoShowNewCollections: (enabled) => {
    const current = get();
    const hidden = new Set(current.hiddenCollectionIds);
    if (enabled) {
      current.newCollectionIds.forEach((id) => hidden.delete(id));
    }

    const next: BiliCollectionVisibilityPreferences = {
      hiddenCollectionIds: Array.from(hidden),
      knownCollectionIds: current.knownCollectionIds,
      newCollectionIds: enabled ? [] : current.newCollectionIds,
      autoShowNewCollections: enabled,
    };
    void writeVisibilityPreferences(next);
    set(next);
  },

  clearNewCollectionState: (id) => {
    const current = get();
    const next: BiliCollectionVisibilityPreferences = {
      hiddenCollectionIds: current.hiddenCollectionIds,
      knownCollectionIds: current.knownCollectionIds,
      newCollectionIds: id ? current.newCollectionIds.filter((item) => item !== id) : [],
      autoShowNewCollections: current.autoShowNewCollections,
    };
    void writeVisibilityPreferences(next);
    set(next);
  },

  getCollectionSongs: async (id) => {
    const cached = collectionCache.get(id);
    if (cached) {
      // 命中时刷新 LRU 顺序
      cacheCollectionSongs(id, cached);
      return cached;
    }

    const collection = get().playlists.find((item) => item.id === id);
    if (!collection) throw new Error("B站合集不存在或尚未同步");
    const songs = await getBiliCollectionSongs(collection);
    cacheCollectionSongs(id, songs);
    return songs;
  },

  refreshCollectionSongs: async (id) => {
    collectionCache.delete(id);
    const collection = get().playlists.find((item) => item.id === id);
    if (!collection) throw new Error("B站合集不存在或尚未同步");
    const songs = await getBiliCollectionSongs(collection);
    cacheCollectionSongs(id, songs);
    return songs;
  },
}));
