import type { MusicInfo } from "@lx/core";
import { buildSongKey, buildVariantSearchKeyword, matchVariantCandidates } from "@lx/core";
import { getSource } from "@/services/sources/sourceService";

/**
 * 桌面端跨源降级服务：网易云版权缺失时，自动在 QQ 音乐中寻找同名曲目接管播放。
 *
 * 背景：网易云部分曲目因版权受限返回 403 或无播放地址。
 * 与其直接弹红报错中断播放，不如使用「歌名 + 首位歌手」直连 QQ 音乐检索同名曲目。
 *
 * 匹配规则统一由 @lx/core（song-variant）提供：歌名规整相同（忽略括号补充说明及
 * 符号标点）+ 歌手重叠（至少一位共同歌手）+ 时长严格校验（时长差 ≤ 5 秒，按差值
 * 升序防 Live/翻唱/重录版误匹配）。
 */

/** 单次匹配的搜索缓存：缓存完整候选数组，只留最优一条会丢弃「排序靠前但解析失败」时的次优候选。 */
const variantCache = new Map<string, MusicInfo[]>();

/**
 * 为网易云曲目寻找同名的 QQ 音乐版本，按匹配置信度排序（最优在前）。
 *
 * 仅单向处理 wy → tx：避免反向错位（用户明确选了 QQ 曲目却播网易云版本）。
 */
export async function findTxVariants(song: MusicInfo): Promise<MusicInfo[]> {
  if (song.source !== "wy") return [];
  const key = buildSongKey(song);
  const cached = variantCache.get(key);
  if (cached !== undefined) return cached;
  if (!song.name.trim()) return [];

  const keyword = buildVariantSearchKeyword(song);

  const tx = getSource("tx");
  if (!tx) return [];

  let results: MusicInfo[] = [];
  try {
    const searchRes = await tx.search(keyword, "song", 1);
    results = searchRes.songs || [];
  } catch {
    return [];
  }

  const matched = matchVariantCandidates(song, results, "tx");

  // 命中结果落缓存；未命中同样缓存空数组，避免每次失败都重打接口（同会话内结果稳定）
  variantCache.set(key, matched);
  return matched;
}

/** 格式化降级失败说明，引导用户配置音源 */
export function describeCrossSourceFailure(candidates: MusicInfo[]): string {
  if (candidates.length === 0) {
    return "QQ 音乐未找到匹配的同名曲目";
  }
  return `已找到 ${candidates.length} 个 QQ 音乐候选版本但均无法获取播放链接，建议导入或切换音源`;
}

/** 清理匹配缓存（音源脚本集合变更时调用，强制下次重新匹配） */
export function clearCrossSourceVariantCache(): void {
  variantCache.clear();
}
