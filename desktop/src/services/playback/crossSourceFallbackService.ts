import type { MusicInfo } from "@lx/core";
import { getSource } from "@/services/sources/sourceService";
import { isSameSong } from "@/services/search/songMetadataMerge";

/**
 * 桌面端跨源降级服务：网易云版权缺失时，自动在 QQ 音乐中寻找同名曲目接管播放。
 *
 * 背景：网易云部分曲目因版权受限返回 403 或无播放地址。
 * 与其直接弹红报错中断播放，不如使用「歌名 + 首位歌手」直连 QQ 音乐检索同名曲目。
 *
 * 匹配准确性保证（三重校验）：
 * 1. 歌名规整相同（忽略括号补充说明及符号标点）
 * 2. 歌手重叠（至少包含一位共同歌手）
 * 3. 时长严格校验（时长差 ≤ 5 秒，按差值升序防 Live/翻唱/重录版误匹配）
 */

const MAX_CANDIDATES = 12;

/** 跨源候选缓存：同一首歌在一次会话里重复遇到解析失败不再重复请求接口 */
const variantCache = new Map<string, MusicInfo | null>();

export function normalizeSongName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .replace(/[\s\-—_·.,，。:：'"《》<>]/g, "")
    .trim();
}

interface RankedCandidate {
  song: MusicInfo;
  durationDelta: number;
  exactName: boolean;
}

function buildSongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

function rankCandidates(source: MusicInfo, candidates: MusicInfo[]): RankedCandidate[] {
  const sourceNormalized = normalizeSongName(source.name);
  return candidates
    .map((song) => ({
      song,
      durationDelta:
        source.interval && song.interval
          ? Math.abs(source.interval - song.interval)
          : Number.MAX_SAFE_INTEGER,
      exactName: normalizeSongName(song.name) === sourceNormalized,
    }))
    .sort((a, b) => {
      if (a.durationDelta !== b.durationDelta) return a.durationDelta - b.durationDelta;
      if (a.exactName !== b.exactName) return a.exactName ? -1 : 1;
      return 0;
    });
}

/**
 * 为网易云曲目寻找同名的 QQ 音乐版本，按匹配置信度排序（最优在前）。
 *
 * 仅单向处理 wy → tx：避免反向错位（用户明确选了 QQ 曲目却播网易云版本）。
 */
export async function findTxVariants(song: MusicInfo): Promise<MusicInfo[]> {
  if (song.source !== "wy") return [];
  const key = buildSongKey(song);
  const cached = variantCache.get(key);
  if (cached !== undefined) return cached ? [cached] : [];
  if (!song.name.trim()) return [];

  const primarySinger = song.singer?.split(/[、/,，&＋+]/)[0]?.trim() ?? "";
  const keyword = [song.name.trim(), primarySinger].filter(Boolean).join(" ");

  const tx = getSource("tx");
  if (!tx) return [];

  let results: MusicInfo[] = [];
  try {
    const searchRes = await tx.search(keyword, "song", 1);
    results = searchRes.songs || [];
  } catch {
    return [];
  }

  // 严格过滤：来自 tx 且满足 isSameSong（歌名+歌手+时长差校验）
  const matched = rankCandidates(
    song,
    results
      .filter((item) => {
        if (item.source !== "tx") return false;
        if (!isSameSong(song, item)) return false;
        // 如果双方都有时长，严格限制在 5 秒以内
        if (song.interval && item.interval && Math.abs(song.interval - item.interval) > 5) {
          return false;
        }
        return true;
      })
      .slice(0, MAX_CANDIDATES),
  ).map((entry) => entry.song);

  variantCache.set(key, matched[0] ?? null);
  return matched;
}

/** 格式化降级失败说明，引导用户配置音源 */
export function describeCrossSourceFailure(candidates: MusicInfo[]): string {
  if (candidates.length === 0) {
    return "QQ 音乐未找到匹配的同名曲目";
  }
  return `已找到 ${candidates.length} 个 QQ 音乐候选版本但均无法获取播放链接，建议导入或切换音源`;
}

/** 清理匹配缓存（音源脚本变更时调用） */
export function clearCrossSourceVariantCache(): void {
  variantCache.clear();
}
