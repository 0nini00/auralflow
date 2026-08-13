import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  fetchHomeFeed,
  fetchHomeFeedSection,
  mergeHomeSectionResult,
} from "../services/homeFeedService";
import {
  getHomeFeedCacheKey as getScopedHomeFeedCacheKey,
  isHomeFeedSection,
  type HomeFeedContext,
  type HomeFeedSection,
  type HomeFeedSectionById,
  type HomeFeedSectionId,
} from "../services/homeFeedModels";

export const HOME_FEED_TTL_MS = 600_000;

export type HomeFeedStoreContext = HomeFeedContext & {
  userId?: string | null;
};

export type HomeFeedSectionLoading = Record<HomeFeedSectionId, boolean>;

export interface HomeFeedStoreState {
  cacheKey: string | null;
  sections: HomeFeedSection[];
  loaded: boolean;
  refreshing: boolean;
  sectionLoading: HomeFeedSectionLoading;
  lastUpdated: number | null;
  error: string | null;
}

export interface HomeFeedStoreActions {
  load: (context: HomeFeedStoreContext) => Promise<void>;
  refreshAll: (
    context: HomeFeedStoreContext,
    options?: { force?: boolean },
  ) => Promise<void>;
  refreshSection: (
    sectionId: HomeFeedSectionId,
    context: HomeFeedStoreContext,
  ) => Promise<void>;
  resetForAccount: (context: HomeFeedStoreContext) => Promise<void>;
}

export type HomeFeedStore = HomeFeedStoreState & HomeFeedStoreActions;

interface PersistedHomeFeed {
  sections: HomeFeedSection[];
  lastUpdated: number;
}

interface CachedHomeFeed extends PersistedHomeFeed {
  invalidSectionIds: HomeFeedSectionId[];
}

// 首页只保留推荐歌单 + 每日推荐；新歌/新碟已由排行榜区块取代。
const SECTION_IDS: readonly HomeFeedSectionId[] = [
  "recommendedPlaylists",
  "dailySongs",
];
const EMPTY_SECTION_LOADING: HomeFeedSectionLoading = {
  recommendedPlaylists: false,
  dailySongs: false,
  newSongs: false,
  newAlbums: false,
};

interface InFlightRequest {
  generation: number;
  promise: Promise<void>;
}

const loadPromises = new Map<string, InFlightRequest>();
const refreshPromises = new Map<string, InFlightRequest>();
const sectionPromises = new Map<string, InFlightRequest>();
let accountGeneration = 0;
let requestGeneration = 0;
let fullRefreshGeneration = 0;
const sectionRequestGenerations = new Map<HomeFeedSectionId, number>();

function userIdForContext(context: HomeFeedStoreContext): string | null {
  if (Object.prototype.hasOwnProperty.call(context, "userId")) {
    const userId = context.userId == null ? "" : String(context.userId).trim();
    return userId || null;
  }

  const scopeKey = context.scopeKey.trim();
  if (!scopeKey || scopeKey === "anonymous" || scopeKey === "guest") return null;
  return scopeKey.startsWith("wy:") ? scopeKey.slice(3) || null : scopeKey;
}

export function getHomeFeedCacheKey(context: HomeFeedStoreContext): string {
  const userId = userIdForContext(context);
  return getScopedHomeFeedCacheKey(userId ? `wy:${userId}` : "anonymous");
}

function sectionIdFromInvalidCacheValue(value: unknown): HomeFeedSectionId | null {
  if (!value || typeof value !== "object") return null;
  const section = value as { id?: unknown; kind?: unknown };
  const id = section.id === section.kind ? section.id : null;
  return SECTION_IDS.find((sectionId) => sectionId === id) ?? null;
}

function parsePersistedHomeFeed(value: unknown): CachedHomeFeed | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as { lastUpdated?: unknown; sections?: unknown };
  if (
    typeof snapshot.lastUpdated !== "number"
    || !Number.isFinite(snapshot.lastUpdated)
    || snapshot.lastUpdated < 0
    || !Array.isArray(snapshot.sections)
  ) return null;

  const sections: HomeFeedSection[] = [];
  const invalidSectionIds = new Set<HomeFeedSectionId>();
  for (const section of snapshot.sections) {
    if (isHomeFeedSection(section)) {
      sections.push(section);
      continue;
    }
    const sectionId = sectionIdFromInvalidCacheValue(section);
    if (!sectionId) return null;
    invalidSectionIds.add(sectionId);
  }
  return { sections, lastUpdated: snapshot.lastUpdated, invalidSectionIds: [...invalidSectionIds] };
}

function mergeFeedSectionResult<K extends HomeFeedSectionId>(
  previous: HomeFeedSectionById<K> | undefined,
  next: HomeFeedSectionById<K>,
): HomeFeedSectionById<K> {
  return mergeHomeSectionResult(previous, next);
}

function mergeFeedSection(
  previous: HomeFeedSection | undefined,
  next: HomeFeedSection,
): HomeFeedSection {
  switch (next.kind) {
    case "recommendedPlaylists":
      return mergeFeedSectionResult(
        previous?.kind === next.kind ? previous : undefined,
        next,
      );
    case "dailySongs":
      return mergeFeedSectionResult(
        previous?.kind === next.kind ? previous : undefined,
        next,
      );
    case "newSongs":
      return mergeFeedSectionResult(
        previous?.kind === next.kind ? previous : undefined,
        next,
      );
    case "newAlbums":
      return mergeFeedSectionResult(
        previous?.kind === next.kind ? previous : undefined,
        next,
      );
  }
}

function sectionsForContext(
  context: HomeFeedStoreContext,
  sections: HomeFeedSection[],
): HomeFeedSection[] {
  const byId = new Map<HomeFeedSectionId, HomeFeedSection>();
  sections.forEach((section) => byId.set(section.id, section));
  return SECTION_IDS.reduce<HomeFeedSection[]>((result, id) => {
    if (id === "dailySongs" && !context.isLoggedIn) return result;
    const section = byId.get(id);
    if (section) result.push(section);
    return result;
  }, []);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "加载失败");
}

async function readCache(cacheKey: string): Promise<CachedHomeFeed | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = parsePersistedHomeFeed(JSON.parse(raw));
    if (parsed) return parsed;
    await AsyncStorage.removeItem(cacheKey);
  } catch {
    await AsyncStorage.removeItem(cacheKey).catch(() => undefined);
  }
  return null;
}

async function writeCache(
  cacheKey: string,
  sections: HomeFeedSection[],
  lastUpdated: number,
): Promise<void> {
  const snapshot: PersistedHomeFeed = { sections, lastUpdated };
  await AsyncStorage.setItem(cacheKey, JSON.stringify(snapshot));
}

export const useHomeFeedStore = create<HomeFeedStore>((set, get) => {
  const cacheWritePromises = new Map<string, Promise<void>>();

  function switchAccount(context: HomeFeedStoreContext): string {
    const cacheKey = getHomeFeedCacheKey(context);
    if (get().cacheKey !== cacheKey) {
      accountGeneration += 1;
      requestGeneration += 1;
      fullRefreshGeneration += 1;
      sectionRequestGenerations.clear();
      set({
        cacheKey,
        sections: [],
        loaded: false,
        refreshing: false,
        sectionLoading: { ...EMPTY_SECTION_LOADING },
        lastUpdated: null,
        error: null,
      });
    }
    return cacheKey;
  }

  async function writeCacheIfCurrent(
    cacheKey: string,
    sections: HomeFeedSection[],
    lastUpdated: number,
    isCurrent: () => boolean,
  ): Promise<void> {
    const previous = cacheWritePromises.get(cacheKey) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(async () => {
      if (!isCurrent()) return;
      await writeCache(cacheKey, sections, lastUpdated);
    });
    cacheWritePromises.set(cacheKey, write);
    try {
      await write;
    } finally {
      if (cacheWritePromises.get(cacheKey) === write) cacheWritePromises.delete(cacheKey);
    }
  }

  return {
    cacheKey: null,
    sections: [],
    loaded: false,
    refreshing: false,
    sectionLoading: { ...EMPTY_SECTION_LOADING },
    lastUpdated: null,
    error: null,

    load: async (context) => {
      const cacheKey = switchAccount(context);
      const existing = loadPromises.get(cacheKey);
      if (existing?.generation === accountGeneration) return existing.promise;

      const generation = accountGeneration;
      const requestsAtStart = requestGeneration;
      const task: Promise<void> = (async () => {
        const cached = await readCache(cacheKey);
        if (
          generation !== accountGeneration
          || requestsAtStart !== requestGeneration
          || get().cacheKey !== cacheKey
        ) return;

        const sections = cached ? sectionsForContext(context, cached.sections) : [];
        set({
          sections,
          loaded: true,
          lastUpdated: cached?.lastUpdated ?? null,
          error: null,
        });

        if (!cached || Date.now() - cached.lastUpdated >= HOME_FEED_TTL_MS) {
          void get().refreshAll(context);
          return;
        }
        cached.invalidSectionIds.forEach((sectionId) => {
          void get().refreshSection(sectionId, context);
        });
      })().finally(() => {
        if (loadPromises.get(cacheKey)?.promise === task) loadPromises.delete(cacheKey);
      });

      loadPromises.set(cacheKey, { generation, promise: task });
      return task;
    },

    refreshAll: async (context, options) => {
      const cacheKey = switchAccount(context);
      const existing = refreshPromises.get(cacheKey);
      if (existing?.generation === accountGeneration) return existing.promise;

      const current = get();
      if (
        !options?.force
        && current.loaded
        && current.lastUpdated !== null
        && Date.now() - current.lastUpdated < HOME_FEED_TTL_MS
      ) {
        return;
      }

      const generation = accountGeneration;
      const request = ++requestGeneration;
      fullRefreshGeneration = request;
      const task: Promise<void> = (async () => {
        set({ refreshing: true, error: null });
        try {
          const incoming = sectionsForContext(context, await fetchHomeFeed(context));
          if (
            generation !== accountGeneration
            || request !== requestGeneration
            || get().cacheKey !== cacheKey
          ) return;

          const previous = get().sections;
          const sections = incoming.map((section) => mergeFeedSection(
            previous.find((item) => item.id === section.id),
            section,
          ));
          const lastUpdated = Date.now();
          await writeCacheIfCurrent(
            cacheKey,
            sections,
            lastUpdated,
            () => generation === accountGeneration
              && request === requestGeneration
              && get().cacheKey === cacheKey,
          );
          if (
            generation === accountGeneration
            && request === requestGeneration
            && get().cacheKey === cacheKey
          ) {
            set({ sections, loaded: true, lastUpdated, error: null });
          }
        } catch (error) {
          if (
            generation === accountGeneration
            && request === requestGeneration
            && get().cacheKey === cacheKey
          ) {
            set({ loaded: true, error: errorMessage(error) });
          }
        } finally {
          if (
            generation === accountGeneration
            && request === requestGeneration
            && get().cacheKey === cacheKey
          ) {
            set({ refreshing: false });
          }
        }
      })().finally(() => {
        if (refreshPromises.get(cacheKey)?.promise === task) {
          refreshPromises.delete(cacheKey);
        }
      });

      refreshPromises.set(cacheKey, { generation, promise: task });
      return task;
    },

    refreshSection: async (sectionId, context) => {
      if (sectionId === "dailySongs" && !context.isLoggedIn) return;

      const cacheKey = switchAccount(context);
      const fullRefresh = refreshPromises.get(cacheKey);
      if (fullRefresh?.generation === accountGeneration) await fullRefresh.promise;
      if (get().cacheKey !== cacheKey) return;

      const promiseKey = `${cacheKey}.${sectionId}`;
      const existing = sectionPromises.get(promiseKey);
      if (existing?.generation === accountGeneration) return existing.promise;

      const generation = accountGeneration;
      const fullRefreshAtStart = fullRefreshGeneration;
      const request = ++requestGeneration;
      sectionRequestGenerations.set(sectionId, request);
      const task: Promise<void> = (async () => {
        set((state) => ({
          sectionLoading: { ...state.sectionLoading, [sectionId]: true },
          error: null,
        }));
        try {
          const incoming = await fetchHomeFeedSection(sectionId, context);
          if (
            generation !== accountGeneration
            || sectionRequestGenerations.get(sectionId) !== request
            || fullRefreshAtStart !== fullRefreshGeneration
            || get().cacheKey !== cacheKey
          ) return;

          const current = get();
          const previous = current.sections.find((section) => section.id === sectionId);
          const merged = mergeFeedSectionResult(previous, incoming);
          const sections = sectionsForContext(context, [
            ...current.sections.filter((section) => section.id !== sectionId),
            merged,
          ]);
          const lastUpdated = current.lastUpdated ?? Date.now();
          set({ sections, loaded: true, lastUpdated, error: null });
          await writeCacheIfCurrent(
            cacheKey,
            sections,
            lastUpdated,
            () => generation === accountGeneration
              && sectionRequestGenerations.get(sectionId) === request
              && fullRefreshAtStart === fullRefreshGeneration
              && get().cacheKey === cacheKey,
          );
        } catch (error) {
          if (
            generation === accountGeneration
            && sectionRequestGenerations.get(sectionId) === request
            && fullRefreshAtStart === fullRefreshGeneration
            && get().cacheKey === cacheKey
          ) {
            set({ error: errorMessage(error) });
          }
        } finally {
          if (generation === accountGeneration && get().cacheKey === cacheKey) {
            set((state) => ({
              sectionLoading: { ...state.sectionLoading, [sectionId]: false },
            }));
          }
        }
      })().finally(() => {
        if (sectionPromises.get(promiseKey)?.promise === task) {
          sectionPromises.delete(promiseKey);
        }
      });

      sectionPromises.set(promiseKey, { generation, promise: task });
      return task;
    },

    resetForAccount: async (context) => {
      const cacheKey = getHomeFeedCacheKey(context);
      accountGeneration += 1;
      requestGeneration += 1;
      fullRefreshGeneration += 1;
      sectionRequestGenerations.clear();
      set({
        cacheKey,
        sections: [],
        loaded: false,
        refreshing: false,
        sectionLoading: { ...EMPTY_SECTION_LOADING },
        lastUpdated: null,
        error: null,
      });
      await get().load(context);
    },
  };
});
