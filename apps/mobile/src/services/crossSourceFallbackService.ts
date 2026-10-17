import type { MusicInfo } from "@lx/core";
import { buildSongKey, buildVariantSearchKeyword, matchVariantCandidates } from "@lx/core";

import { searchSongs } from "@/services/musicApi";

/**
 * 网易云版播不了时，去 QQ 音乐找同一首歌。
 *
 * 背景：网易云搜歌手拿到的是网易云曲目，其中不少因版权下架而永远解析不出播放地址。
 * 与其让用户干看着报错，不如用「歌名 + 歌手」去 QQ 音乐搜同名曲顶上。
 *
 * 匹配规则统一由 @lx/core（song-variant）提供：歌名规整相等 + 歌手重合 +
 * 时长差 ≤ 5s 三重校验，避免两端各持一份拷贝后容差漂移。
 *
 * 取链说明：QQ 音乐在 AuralFlow 里没有内置取链通道（官方匿名 vkey 实测被腾讯以
 * invalidq 拒绝），只能靠用户导入的 tx 音源脚本经自定义音源链路解析。
 * 因此本模块只负责「找到候选」，能否真正播出来由调用方的解析结果决定。
 */

/** 单次匹配的搜索缓存：缓存完整候选数组，只留最优一条会丢弃「排序靠前但解析失败」时的次优候选。 */
const variantCache = new Map<string, MusicInfo[]>();

/**
 * 为网易云曲目寻找同名的 QQ 音乐版本，按匹配可信度返回候选列表（最优在前）。
 *
 * 只处理 wy → tx 这一个方向：反向（tx 播不了去网易云找）会与「用户明确选了 QQ 音乐
 * 曲目却播网易云版本」的元数据错位问题冲突，且网易云侧本就有官方兜底链路。
 *
 * @returns 通过三重校验的 tx 候选，无匹配时为空数组
 */
export async function findTxVariants(song: MusicInfo): Promise<MusicInfo[]> {
  if (song.source !== "wy") return [];
  const key = buildSongKey(song);
  const cached = variantCache.get(key);
  if (cached !== undefined) return cached;
  if (!song.name.trim()) return [];

  // 查询串用「歌名 + 首位歌手」：只带歌名时同名不同曲过多，只带歌手时搜不出具体曲目。
  const keyword = buildVariantSearchKeyword(song);

  let results: MusicInfo[] = [];
  try {
    results = await searchSongs("tx", keyword);
  } catch {
    // 搜索失败不缓存：网络抖动导致的失败不该让整次会话都放弃降级
    return [];
  }

  const matched = matchVariantCandidates(song, results, "tx");

  // 命中结果落缓存；未命中同样缓存空数组，避免每次失败都重打接口（同会话内结果稳定）
  variantCache.set(key, matched);
  return matched;
}

/** 清除匹配缓存（音源脚本集合变更后调用，强制下次重新匹配）。 */
export function clearCrossSourceVariantCache(): void {
  variantCache.clear();
}

/**
 * 结果播不出来时追加的说明文案。
 *
 * 区分「没找到 QQ 音乐版本」和「找到了但解析失败」：后者绝大多数是没导入 tx 音源脚本，
 * 直接说清楚比抛一句笼统的解析失败有用得多。
 */
export function describeCrossSourceFailure(candidates: MusicInfo[]): string {
  if (candidates.length === 0) return "网易云无版权，且 QQ 音乐未找到同名歌曲";
  return "网易云无版权，QQ 音乐找到同名歌曲但无法解析播放地址（请检查是否已导入可用的 QQ 音源脚本）";
}
