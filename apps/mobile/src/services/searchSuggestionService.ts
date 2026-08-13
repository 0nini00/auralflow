/**
 * 搜索建议结果
 */
export interface SearchSuggestion {
  keyword: string;
  type: "song" | "artist" | "album" | "playlist" | "keyword";
}

type JsonRecord = Record<string, any>;

/**
 * 获取搜索联想（网易云）
 */
export async function getSearchSuggestions(keyword: string): Promise<SearchSuggestion[]> {
  if (!keyword || keyword.trim().length === 0) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://music.163.com/api/search/suggest/web?s=${encodeURIComponent(keyword)}&limit=10`,
      {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: controller.signal as any,
      }
    );

    clearTimeout(timeoutId);

    const data = (await response.json()) as JsonRecord;
    
    if (data.code === 200 && data.result) {
      const suggestions: SearchSuggestion[] = [];
      
      // 歌曲建议
      if (data.result.songs) {
        data.result.songs.slice(0, 3).forEach((song: any) => {
          suggestions.push({
            keyword: `${song.name} - ${song.artists?.[0]?.name || ""}`,
            type: "song",
          });
        });
      }
      
      // 艺术家建议
      if (data.result.artists) {
        data.result.artists.slice(0, 2).forEach((artist: any) => {
          suggestions.push({
            keyword: artist.name,
            type: "artist",
          });
        });
      }
      
      // 专辑建议
      if (data.result.albums) {
        data.result.albums.slice(0, 2).forEach((album: any) => {
          suggestions.push({
            keyword: `${album.name} - ${album.artist?.name || ""}`,
            type: "album",
          });
        });
      }

      // 歌单建议
      if (data.result.playlists) {
        data.result.playlists.slice(0, 2).forEach((playlist: any) => {
          suggestions.push({
            keyword: String(playlist.name || ""),
            type: "playlist",
          });
        });
      }
      
      return suggestions;
    }

    return [];
  } catch (error) {
    return [];
  }
}
