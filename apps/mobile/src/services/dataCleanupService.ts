import { clearAllCache, getCacheSize } from "@/services/cacheService";
import { clearPrefetchCache } from "@/services/playerService";
import { useHistoryStore } from "@/stores/historyStore";

export interface PlaybackHistoryAndCacheCleanupAction {
  title: string;
  caption: string;
  confirmTitle: string;
  confirmMessage: string;
  successMessage: string;
}

export interface PlaybackHistoryAndCacheCleanupResult {
  cacheSize: number;
  message: string;
}

export function getPlaybackHistoryAndCacheCleanupAction(): PlaybackHistoryAndCacheCleanupAction {
  return {
    title: "清空历史和缓存",
    caption: "清空播放历史、封面、歌词和播放预读缓存",
    confirmTitle: "清空历史和缓存",
    confirmMessage: "将删除播放历史、封面、歌词和播放预读缓存，下次播放时会重新生成。",
    successMessage: "已清空播放历史与缓存",
  };
}

export async function clearMediaCache(): Promise<number> {
  await clearAllCache();
  clearPrefetchCache();
  return getCacheSize();
}

export async function clearPlaybackHistoryAndCache(): Promise<PlaybackHistoryAndCacheCleanupResult> {
  const action = getPlaybackHistoryAndCacheCleanupAction();
  await useHistoryStore.getState().clearHistory();
  const cacheSize = await clearMediaCache();

  return {
    cacheSize,
    message: action.successMessage,
  };
}
