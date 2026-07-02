import { create } from "zustand";
import { patchSettings } from "@lx/tauri-bridge";
import type { MusicInfo } from "@lx/core";
import {
  checkBiliAccount,
  getBiliCookie,
  getBiliCollectionSongs,
  getBiliSubscribedCollections,
  setBiliCookie,
  type BiliAccountInfo,
  type BiliCollectionInfo,
} from "@/services/biliAccountService";

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

const BILI_COLLECTION_VISIBILITY_KEY = "auralflow:bili-collection-visibility";
const collectionCache = new Map<string, MusicInfo[]>();

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

function readVisibilityPreferences(): BiliCollectionVisibilityPreferences {
  const fallback: BiliCollectionVisibilityPreferences = {
    hiddenCollectionIds: [],
    knownCollectionIds: [],
    newCollectionIds: [],
    autoShowNewCollections: false,
  };
  if (typeof window === "undefined") return fallback;

  const raw = window.localStorage.getItem(BILI_COLLECTION_VISIBILITY_KEY);
  if (!raw) return fallback;

  const parsed = JSON.parse(raw) as Partial<BiliCollectionVisibilityPreferences>;
  return {
    hiddenCollectionIds: Array.isArray(parsed.hiddenCollectionIds) ? uniqueIds(parsed.hiddenCollectionIds) : [],
    knownCollectionIds: Array.isArray(parsed.knownCollectionIds) ? uniqueIds(parsed.knownCollectionIds) : [],
    newCollectionIds: Array.isArray(parsed.newCollectionIds) ? uniqueIds(parsed.newCollectionIds) : [],
    autoShowNewCollections: parsed.autoShowNewCollections === true,
  };
}

function writeVisibilityPreferences(preferences: BiliCollectionVisibilityPreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BILI_COLLECTION_VISIBILITY_KEY, JSON.stringify({
    hiddenCollectionIds: uniqueIds(preferences.hiddenCollectionIds),
    knownCollectionIds: uniqueIds(preferences.knownCollectionIds),
    newCollectionIds: uniqueIds(preferences.newCollectionIds),
    autoShowNewCollections: preferences.autoShowNewCollections,
  }));
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
  const hiddenIdSet = new Set(preferences.hiddenCollectionIds.filter((id) => currentIdSet.has(id)));

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

const initialVisibilityPreferences = readVisibilityPreferences();

export const useBiliAccountStore = create<BiliAccountState>((set, get) => ({
  account: null,
  playlists: [],
  hiddenCollectionIds: initialVisibilityPreferences.hiddenCollectionIds,
  knownCollectionIds: initialVisibilityPreferences.knownCollectionIds,
  newCollectionIds: initialVisibilityPreferences.newCollectionIds,
  autoShowNewCollections: initialVisibilityPreferences.autoShowNewCollections,
  isLoading: false,
  isLoaded: false,
  error: "",

  load: async (cookieStr) => {
    try {
      const cookie = cookieStr ?? (await getBiliCookie());
      if (!cookie) {
        collectionCache.clear();
        set({ isLoaded: true, playlists: [], account: null, error: "" });
        return;
      }

      setBiliCookie(cookie);
      set({ isLoading: true, error: "" });

      const account = await checkBiliAccount();
      const playlists = await getBiliSubscribedCollections(account.uid);
      const visibility = applyCollectionVisibilityUpdate(playlists, {
        hiddenCollectionIds: get().hiddenCollectionIds,
        knownCollectionIds: get().knownCollectionIds,
        newCollectionIds: get().newCollectionIds,
        autoShowNewCollections: get().autoShowNewCollections,
      });
      writeVisibilityPreferences(visibility);
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
  },

  logout: async () => {
    await patchSettings({ biliCookie: null });
    setBiliCookie("");
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
    writeVisibilityPreferences(next);
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
    writeVisibilityPreferences(next);
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
    writeVisibilityPreferences(next);
    set(next);
  },

  getCollectionSongs: async (id: string) => {
    const cached = collectionCache.get(id);
    if (cached) return cached;

    const collection = get().playlists.find((item) => item.id === id);
    if (!collection) throw new Error("B站合集不存在或尚未同步");
    const songs = await getBiliCollectionSongs(collection);
    collectionCache.set(id, songs);
    return songs;
  },

  refreshCollectionSongs: async (id: string) => {
    collectionCache.delete(id);
    const collection = get().playlists.find((item) => item.id === id);
    if (!collection) throw new Error("B站合集不存在或尚未同步");
    const songs = await getBiliCollectionSongs(collection);
    collectionCache.set(id, songs);
    return songs;
  },
}));
