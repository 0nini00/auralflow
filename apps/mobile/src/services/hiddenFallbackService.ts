import {
  buildVariantSearchKeyword,
  matchHiddenCandidates,
  type HiddenSourceId,
  type HiddenSourceTrack,
  type MusicInfo,
} from "@lx/core";
import { normalizeSourceQualityLabel } from "@/services/playbackQualityModel";
import {
  requestCustomSourceMusicUrl,
  type CustomSourcePlatformRequest,
} from "@/services/customSourceRuntime";
import { useCustomSourceStore, type CustomSourceItem } from "@/stores/customSourceStore";
import { hiddenSourceSearchers } from "./hiddenSourceSearchers";
import { probeStreamUrl } from "./streamProbe";
import { logger } from "@/services/logger";

/**
 * 移动端隐藏兜底解析：内置网关 / 自定义音源 / 官方直连全部失败后，
 * 按「歌名 + 首位歌手」去酷我、酷狗搜索同名曲目，再交给已启用的 LX 脚本取链。
 *
 * 约束与桌面端一致：隐藏平台不是 UI 来源，`MusicInfo.source` 始终保持原曲；
 * 搜索结果必须通过 @lx/core 的严格匹配；没有脚本声明对应平台时不发起搜索。
 *
 * 分成搜索与取链两段：常规链路运行期间只并行搜索（纯 HTTP），只有真的失败时
 * 才调脚本取链，避免常规链路成功的歌白唤醒 LX 脚本。
 */

/** 单平台搜索的硬超时；与 hiddenSourceSearchers 的 fetch 超时对齐。 */
const HIDDEN_SEARCH_TIMEOUT_MS = 6_000;
const HIDDEN_PROBE_RESERVE_MS = 1_500;
const HIDDEN_MIN_ATTEMPT_MS = 600;
const HIDDEN_MAX_TRACKS_PER_PLATFORM = 4;

/** 单次脚本取链超时：慢源不能吃完整轮兜底预算，超时后换下一个候选/音质。 */
const HIDDEN_ATTEMPT_TIMEOUT_MS = 6_000;

/**
 * 候选内层探活超时。
 *
 * 内层只回答「这个地址是不是死的」，不做试听片段判定，因此比外层探活更短；
 * 包体/时长判定仍由播放链路的 probeStreamUrl 完成。
 */
const HIDDEN_INNER_PROBE_TIMEOUT_MS = 2_500;

export interface HiddenFallbackResult {
  url: string;
  quality: string;
  resolverName: string;
}

export interface HiddenCandidateGroup {
  platform: HiddenSourceId;
  tracks: HiddenSourceTrack[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function enabledResolvers(platform: HiddenSourceId): CustomSourceItem[] {
  return useCustomSourceStore.getState().sources.filter((source) => {
    if (!source.enabled) return false;
    const infos = source.sources;
    if (!infos) return true;
    return infos[platform]?.actions.includes("musicUrl") ?? false;
  });
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`隐藏音源搜索超时（${timeoutMs}ms）`)), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 判定候选地址是否必须丢弃；返回 `null` 表示可以交给外层继续判定。
 *
 * 脚本「调用成功」不等于「地址可用」：LX 源常见返回过期签名或已下架的资源，
 * 此时若直接定稿，外层探活判死后整条隐藏兜底就放弃了，后面的候选（同曲更高码率
 * 或另一平台）根本没被尝试过。
 *
 * 只把 definitive（服务端明确 4xx）当作换候选的理由：超时 / 抖动 / 5xx 下不了
 * 结论，误杀一个慢 CDN 上完全可用的地址比多花一次探活更糟。
 */
async function rejectCandidate(url: string, deadlineAt: number): Promise<string | null> {
  const budget = Math.min(
    HIDDEN_INNER_PROBE_TIMEOUT_MS,
    deadlineAt - HIDDEN_PROBE_RESERVE_MS - Date.now(),
  );
  // 预算不足时不做内层判定，交给外层探活兜底。
  if (budget <= 0) return null;
  const probe = await probeStreamUrl(url, undefined, budget);
  if (probe.ok || !probe.definitive) return null;
  return probe.reason;
}

/**
 * 只做平台搜索与严格匹配，不触碰 LX 脚本运行时。
 *
 * 可以在常规链路运行期间提前调用：结果只有真正失败时才会被消费。
 * 没有脚本声明对应平台、预算不足或全部搜索失败时返回空数组。
 */
export async function startHiddenSearch(
  song: MusicInfo,
  deadlineAt: number,
): Promise<HiddenCandidateGroup[]> {
  if (song.isLocal || song.source === "local") return [];

  const keyword = buildVariantSearchKeyword(song);
  if (!keyword) return [];

  const remaining = deadlineAt - Date.now() - HIDDEN_PROBE_RESERVE_MS;
  if (remaining <= HIDDEN_MIN_ATTEMPT_MS) return [];
  const timeoutMs = Math.min(HIDDEN_SEARCH_TIMEOUT_MS, remaining);

  const groups = await Promise.all(
    hiddenSourceSearchers.map(async (searcher) => {
      if (enabledResolvers(searcher.id).length === 0) return null;
      try {
        const tracks = await withTimeout(searcher.search(keyword), timeoutMs);
        const matched = matchHiddenCandidates(song, tracks);
        if (matched.length === 0) return null;
        logger.debug(`[hidden] ${searcher.id} 匹配到 ${matched.length} 个候选: ${song.name}`);
        return { platform: searcher.id, tracks: matched } satisfies HiddenCandidateGroup;
      } catch (error) {
        logger.debug(`[hidden] ${searcher.id} 搜索失败: ${errorMessage(error)}`);
        return null;
      }
    }),
  );

  return groups.filter((group): group is HiddenCandidateGroup => group != null);
}

function pickQualities(api: CustomSourceItem, platform: HiddenSourceId, preference: string[]): string[] {
  const declared = api.sources?.[platform]?.qualitys ?? [];
  if (declared.length === 0) return preference;
  return preference.filter((quality) => declared.includes(quality));
}

/**
 * 用已搜到的候选调 LX 脚本取链，只应在常规链路确认失败后调用。
 *
 * 返回 null 表示没有可用兜底（没有匹配候选、预算耗尽或全部失败）。
 * 成功时调用方仍保留原曲作为 `resolvedSong`：UI、歌词、历史都显示用户点的歌。
 */
export async function resolveHiddenFromGroups(
  groups: HiddenCandidateGroup[],
  song: MusicInfo,
  qualityPreference: string[],
  deadlineAt: number,
): Promise<HiddenFallbackResult | null> {
  if (groups.length === 0) return null;
  if (qualityPreference.length === 0) return null;

  for (const group of groups) {
    const resolvers = enabledResolvers(group.platform);
    if (resolvers.length === 0) continue;

    for (const track of group.tracks.slice(0, HIDDEN_MAX_TRACKS_PER_PLATFORM)) {
      const platformRequest: CustomSourcePlatformRequest = {
        source: group.platform,
        songmid: track.id,
        interval: track.interval,
        albumName: track.albumName,
        picUrl: track.picUrl,
        extra: track.extra,
      };

      for (const api of resolvers) {
        const qualities = pickQualities(api, group.platform, qualityPreference);
        if (qualities.length === 0) continue;

        for (const quality of qualities) {
          if (Date.now() >= deadlineAt - HIDDEN_PROBE_RESERVE_MS) {
            logger.debug(`[hidden] 预算耗尽，停止兜底: ${song.name}`);
            return null;
          }

          try {
            const attemptBudget = Math.min(
              HIDDEN_ATTEMPT_TIMEOUT_MS,
              deadlineAt - HIDDEN_PROBE_RESERVE_MS - Date.now(),
            );
            if (attemptBudget <= 0) return null;
            const result = await withTimeout(
              requestCustomSourceMusicUrl(api, song, quality, undefined, platformRequest),
              attemptBudget,
            );
            const resolvedQuality = normalizeSourceQualityLabel(result.quality, quality);
            const resolverName = `${group.platform}/${api.name}`;
            // 脚本调用成功不等于地址可用：先判死链，死了就换下一个候选/音质/平台。
            const deadReason = await rejectCandidate(result.url, deadlineAt);
            if (deadReason) {
              logger.debug(
                `[hidden] ${song.name} ${resolverName} 返回的地址不可用（${deadReason}），换下一个候选`,
              );
              continue;
            }
            logger.debug(`[hidden] ${song.name} 由 ${resolverName} 兜底成功 (${resolvedQuality})`);
            return { url: result.url, quality: resolvedQuality, resolverName };
          } catch (error) {
            logger.debug(`[hidden] ${song.name} ${group.platform}/${api.name} ${quality} 失败: ${errorMessage(error)}`);
          }
        }
      }
    }
  }

  return null;
}

/**
 * 一次性完成「搜索 + 取链」的便捷入口。
 *
 * 供没有提前搜索机会的调用方使用（移动端下载链路）。播放链路请用
 * `startHiddenSearch` + `resolveHiddenFromGroups`，避免常规链路成功时白调脚本。
 */
export async function resolveHiddenFallback(
  song: MusicInfo,
  qualityPreference: string[],
  deadlineAt: number,
): Promise<HiddenFallbackResult | null> {
  const groups = await startHiddenSearch(song, deadlineAt);
  return resolveHiddenFromGroups(groups, song, qualityPreference, deadlineAt);
}
