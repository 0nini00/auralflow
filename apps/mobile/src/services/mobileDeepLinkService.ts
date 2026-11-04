import type { SearchDetailRoute } from "./searchDetailNavigation";

export type MobileDeepLinkIntent =
  | { type: "search"; keyword: string }
  | { type: "homeMode"; mode: "daily" | "fm" }
  | { type: "searchDetail"; route: SearchDetailRoute }
  /**
   * 外部「用其他应用打开」的音源脚本（由 AndroidManifest 注册 .js/.json）。
   * fileName 取不到时为 null（下载器的 content:// URI 常常只有文档 id）。
   */
  | { type: "importSource"; uri: string; fileName: string | null };

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

/**
 * 解出 URI 末段。下载器常把真实路径编码进最后一个 segment
 * （如 `.../document/primary%3ADownload%2Fsrc.js`），所以要再按 / 拆一次。
 */
function readUriTail(url: URL): string | null {
  const rawName = url.pathname.split("/").filter(Boolean).at(-1);
  if (!rawName) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    decoded = rawName;
  }
  const tail = decoded.split("/").filter(Boolean).at(-1) ?? decoded;
  return tail || null;
}

/** 明确不是音源脚本的常见类型：被别的应用直接拉起时不要误导入。 */
const NON_SCRIPT_EXTENSION =
  /\.(mp3|m4a|flac|wav|aac|ogg|mp4|mkv|avi|apk|zip|rar|7z|pdf|jpe?g|png|gif|webp|docx?|xlsx?|pptx?)$/i;

/**
 * 「用其他应用打开」进来的音源脚本。
 *
 * 主力过滤在 AndroidManifest 的 intent-filter（.js/.json 的 MIME 与扩展名），
 * 这里只挡「明确不是脚本」的类型：下载器给的 content:// URI 常常不带扩展名
 * （如 msf%3A1000012345），若要求必须带 .js 会把最需要支持的下载场景全部拒掉。
 */
function parseSourceScriptUri(rawUrl: string): MobileDeepLinkIntent | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "content:" && url.protocol !== "file:") return null;
  const tail = readUriTail(url);
  if (tail && NON_SCRIPT_EXTENSION.test(tail)) return null;
  // 有扩展名才当文件名展示；纯文档 id（msf:123）由调用方兜文案。
  const fileName = tail && /\.[a-z0-9]+$/i.test(tail) ? tail : null;
  return { type: "importSource", uri: rawUrl, fileName };
}

export function parseMobileDeepLink(rawUrl: string): MobileDeepLinkIntent | null {
  const sourceImport = parseSourceScriptUri(rawUrl);
  if (sourceImport) return sourceImport;
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
