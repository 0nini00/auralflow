import { clearAllCache, getCacheSize } from "@/services/cacheService";
import { clearPrefetchCache } from "@/services/playerService";

export async function clearMediaCache(): Promise<number> {
  await clearAllCache();
  clearPrefetchCache();
  return getCacheSize();
}
