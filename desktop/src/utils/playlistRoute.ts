import type { PlaylistInfo } from "@lx/core";

/**
 * 远端歌单详情路由。
 *
 * `source` 这个查询参数不是装饰：PlaylistDetailView 在缺少它时会按 id 形状猜来源，
 * 猜错就会拿 QQ 音乐的 provider 去拉一个网易云 id，表现为「进去转圈然后报错」。
 * 榜单与歌单广场的来源是确定的（都是 wy），所以一路带过去，别让详情页再猜。
 */
export function buildPlaylistDetailPath(playlist: Pick<PlaylistInfo, "id" | "source">): string {
  return `/playlist/${encodeURIComponent(playlist.id)}?source=${playlist.source}`;
}
