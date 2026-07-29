import type { SearchDetailRoute } from "./searchDetailNavigation";

export type MobileDeepLinkIntent =
  | { type: "search"; keyword: string }
  | { type: "homeMode"; mode: "daily" | "fm" }
  | { type: "searchDetail"; route: SearchDetailRoute };

function buildNeteaseDetailRoute(route: string, id: string): SearchDetailRoute | null {
  switch (route) {
    case "playlist":
      return {
        type: "playlist",
        playlist: {
          id,
          name: "网易云歌单",
          author: "未知创建者",
          trackCount: 0,
          source: "wy",
        },
      };
    case "album":
      return {
        type: "album",
        album: {
          id,
          name: "网易云专辑",
          artistName: "未知歌手",
          source: "wy",
        },
        parentArtist: null,
      };
    case "artist":
      return {
        type: "artist",
        artist: {
          id,
          name: "网易云歌手",
          source: "wy",
        },
        parentAlbum: null,
      };
    default:
      return null;
  }
}

export function parseMobileDeepLink(rawUrl: string): MobileDeepLinkIntent | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "auralflow:") return null;

    const path = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    const route = url.hostname || path[0] || "";
    const arg = url.hostname ? path[0] : path[1];

    switch (route) {
      case "search": {
        const keyword = decodeURIComponent(arg ?? "").trim();
        return keyword ? { type: "search", keyword } : null;
      }
      case "daily":
        return { type: "homeMode", mode: "daily" };
      case "fm":
        return { type: "homeMode", mode: "fm" };
      case "playlist":
      case "album":
      case "artist": {
        const id = decodeURIComponent(arg ?? "").trim();
        if (!id) return null;
        const detailRoute = buildNeteaseDetailRoute(route, id);
        return detailRoute ? { type: "searchDetail", route: detailRoute } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
