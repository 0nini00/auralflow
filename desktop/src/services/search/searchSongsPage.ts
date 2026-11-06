import type { MusicInfo, SearchPage, SearchResult } from "@lx/core";
import { searchBuiltinMusicApiWithMetadata } from "@/services/builtinMusicApiModel";

/** 保留主链与元数据合并策略，任一链路还有下一页时继续搜索。 */
export async function searchSongsPage(
  primary: () => Promise<SearchPage<MusicInfo[]>>,
  metadata: () => Promise<SearchPage<MusicInfo[]>>,
): Promise<SearchResult> {
  let hasMore = false;
  const read = async (request: () => Promise<SearchPage<MusicInfo[]>>) => {
    const page = await request();
    hasMore ||= page.hasMore;
    return page.result;
  };
  const songs = await searchBuiltinMusicApiWithMetadata(() => read(primary), () => read(metadata));
  return { songs, hasMore };
}
