import type { MusicInfo } from "@lx/core";

import { searchSongs } from "@/services/musicApi";
import { isSameSong, normalizeSongName } from "@/services/songMetadataMerge";

/**
 * 网易云版播不了时，去 QQ 音乐找同一首歌。
 *
 * 背景：网易云搜歌手拿到的是网易云曲目，其中不少因版权下架而永远解析不出播放地址。
 * 与其让用户干看着报错，不如用「歌名 + 歌手」去 QQ 音乐搜同名曲顶上。
 *
 * 为什么这次能做得比历史实现准：
 * 之前那版同名转译被移除，原因是匹配到了 Live / 翻唱 / 重录 / 同名不同曲——
 * 当时依赖的第三方网关搜索结果不带 interval，isSameSong 的时长校验形同虚设，
 * 只剩「歌名相同 + 歌手重合」。而 QQ 音乐直连搜索结果带 interval，三重校验
 * （歌名规整相等 + 歌手重合 + 时长差 ≤ 5s）能真正生效。
 *
 * 取链说明：QQ 音乐在 AuralFlow 里没有内置取链通道（官方匿名 vkey 实测被腾讯以
 * invalidq 拒绝），只能靠用户导入的 tx 音源脚本经自定义音源链路解析。
 * 因此本模块只负责「找到候选」，能否真正播出来由调用方的解析结果决定。
 */

/** 候选上限：搜到的 tx 结果里最多取前若干条做匹配，避免长列表里捞出边缘同名的曲目。 */
const MAX_CANDIDATES = 12;

/** 单次匹配的搜索缓存：同一首歌在一次会话里失败多次时不再重复打接口。 */
const variantCache = new Map<string, MusicInfo | null>();

/** 匹配候选：按时长差升序，时长完全一致、歌名完全一致的优先。 */
interface RankedCandidate {
  song: MusicInfo;
  durationDelta: number;
  exactName: boolean;
}

function buildSongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

/**
 * 给候选打分排序。
 *
 * 并列时的取舍：时长差更小者优先（Live/重录版通常与录音室版时长不同），
 * 其次是歌名规整后完全一致者，最后按原搜索顺序（QQ 音乐自身的相关度排序）。
 */
function rankCandidates(source: MusicInfo, candidates: MusicInfo[]): RankedCandidate[] {
  const sourceName = normalizeSongName(source.name);
  return candidates
    .map((song) => ({
      song,
      durationDelta:
        source.interval && song.interval ? Math.abs(source.interval - song.interval) : Number.MAX_SAFE_INTEGER,
      exactName: normalizeSongName(song.name) === sourceName,
    }))
    .sort((a, b) => {
      if (a.durationDelta !== b.durationDelta) return a.durationDelta - b.durationDelta;
      if (a.exactName !== b.exactName) return a.exactName ? -1 : 1;
      return 0;
    });
}

/**
 * 为网易云曲目寻找同名的 QQ 音乐版本，按匹配可信度返回候选列表（最优在前）。
 *
 * 只处理 wy → tx 这一个方向：反向（tx 播不了去网易云找）会与「用户明确选了 QQ 音乐
 * 曲目却播网易云版本」的元数据错位问题冲突，且网易云侧本就有官方兜底链路。
 *
 * @returns 通过 isSameSong 严格校验的 tx 候选，无匹配时为空数组
 */
export async function findTxVariants(song: MusicInfo): Promise<MusicInfo[]> {
  if (song.source !== "wy") return [];
  const key = buildSongKey(song);
  const cached = variantCache.get(key);
  if (cached !== undefined) return cached ? [cached] : [];
  if (!song.name.trim()) return [];

  // 查询串用「歌名 + 首位歌手」：只带歌名时同名不同曲过多，只带歌手时搜不出具体曲目。
  const primarySinger = song.singer?.split(/[、/,，&＋+]/)[0]?.trim() ?? "";
  const keyword = [song.name.trim(), primarySinger].filter(Boolean).join(" ");

  let results: MusicInfo[] = [];
  try {
    results = await searchSongs("tx", keyword);
  } catch {
    // 搜索失败不缓存：网络抖动导致的失败不该让整次会话都放弃降级
    return [];
  }

  const matched = rankCandidates(
    song,
    results.filter((item) => item.source === "tx" && isSameSong(song, item)).slice(0, MAX_CANDIDATES),
  ).map((entry) => entry.song);

  // 命中结果落缓存；未命中同样缓存 null，避免每次失败都重打接口（同会话内结果稳定）
  variantCache.set(key, matched[0] ?? null);
  return matched;
}

/** 清除匹配缓存（音源变更后可调用，强制下次重新匹配）。 */
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