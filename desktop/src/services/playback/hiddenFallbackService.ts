import {
  buildVariantSearchKeyword,
  matchHiddenCandidates,
  normalizePlaybackQuality,
  type HiddenSourceId,
  type HiddenSourceTrack,
  type MusicInfo,
} from "@lx/core";
import { debugLog } from "@lx/tauri-bridge";
import {
  requestCustomSourceMusicUrl,
  type CustomSourcePlatformRequest,
} from "@/services/customSourceRuntime";
import { hiddenSourceSearchers } from "@/services/sources/hidden/hiddenSearchers";
import {
  customSourcePersistence,
  useCustomSourceStore,
  type CustomSourceItem,
} from "@/stores/customSourceStore";
import type { CustomSourceOperation } from "@/services/customSourceAccess";
import { probeStreamUrl } from "./streamProbe";
import { withTimeout } from "@/utils/withTimeout";
import type { PlaybackAttempt, PlaybackResolvedUrl } from "./types";

/**
 * 隐藏兜底解析：常规链路（内置网关 / 自定义音源 / 官方直连）全部失败后，
 * 按「歌名 + 首位歌手」去酷我、酷狗搜索同名曲目，再交给用户已启用的 LX 脚本取链。
 *
 * 设计约束：
 * - 这些平台不是 UI 来源，`MusicInfo.source` 始终保持原曲的 wy/tx/local；
 * - 搜索结果必须通过 @lx/core 的严格匹配（歌名 + 歌手 + 时长 ≤ 5s），宁可不兜底也不播错歌；
 * - 没有任何脚本声明对应平台时不发起搜索，避免无谓的网络请求。
 *
 * 分成搜索与取链两段是刻意的：常规链路运行期间只并行「搜索」这一半（纯 HTTP，
 * 便宜且无副作用）；只有常规链路真的失败时才调脚本取链。否则常规链路 1s 就成功
 * 的歌也会白唤醒 LX 脚本、白跑一轮 musicUrl。
 */

/** 单平台搜索的硬超时；与 hiddenSearchers 的 Rust 请求超时对齐。 */
const HIDDEN_SEARCH_TIMEOUT_MS = 6_000;

/** 给外层探活与媒体缓存预留的时间。 */
const HIDDEN_PROBE_RESERVE_MS = 1_500;

/** 剩余预算不足该值时不启动任何隐藏平台请求。 */
const HIDDEN_MIN_ATTEMPT_MS = 600;

/** 单次脚本取链超时：慢源不能吃完整轮兜底预算，超时后换下一个候选/音质。 */
const HIDDEN_ATTEMPT_TIMEOUT_MS = 6_000;

/** 每平台最多尝试的候选数，控制脚本调用次数。 */
const HIDDEN_MAX_TRACKS_PER_PLATFORM = 4;

/**
 * 候选内层探活超时。
 *
 * 内层只回答「这个地址是不是死的」，不做试听片段判定，因此可以比外层探活更短；
 * 真正决定音量/时长的完整判定仍由外层探活完成。
 */
const HIDDEN_INNER_PROBE_TIMEOUT_MS = 2_500;

/**
 * 判定候选地址是否必须丢弃；返回 `null` 表示可以交给外层继续判定。
 *
 * 为什么要在候选循环里探活：脚本「调用成功」不等于「地址可用」。LX 源常见返回
 * 过期签名、空串以外的占位地址、或已被平台下架的资源，此时若直接定稿，外层探活
 * 判死后整条隐藏兜底就放弃了——后面的候选（往往是同一首歌的更高码率或另一平台）
 * 根本没被尝试过。
 *
 * 只把 definitive（服务端明确 4xx）当作「换候选」的理由：超时 / 抖动 / 5xx
 * 下不了结论，误杀一个慢 CDN 上完全可用的地址，比多花一次探活更糟。
 */
async function rejectCandidate(url: string, deadlineAt: number): Promise<string | null> {
  const budget = Math.min(
    HIDDEN_INNER_PROBE_TIMEOUT_MS,
    deadlineAt - HIDDEN_PROBE_RESERVE_MS - Date.now(),
  );
  // 预算不足时不做内层判定：外层探活着有剩余预算，让它兜底。
  if (budget <= 0) return null;
  const probe = await probeStreamUrl(url, undefined, budget);
  if (probe.ok || !probe.definitive) return null;
  return probe.reason;
}

export interface HiddenCandidateGroup {
  platform: HiddenSourceId;
  tracks: HiddenSourceTrack[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


/**
 * 能解析指定平台的已启用脚本。
 *
 * 元数据缺失（从未测试/初始化）的源保持参与：与 customSourceBackend 同语义，
 * 运行时仍会按脚本声明的 sources 做最终校验，脚本不支持时直接失败并换下一个。
 */
function enabledResolvers(platform: HiddenSourceId): CustomSourceItem[] {
  const state = useCustomSourceStore.getState();
  if (!state.featureEnabled) return [];
  return state.sources.filter((source) => {
    if (!source.enabled) return false;
    const infos = source.sources;
    if (!infos) return true;
    return infos[platform]?.actions.includes("musicUrl") ?? false;
  });
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

  if (!useCustomSourceStore.getState().featureReady) await customSourcePersistence.ready;
  if (!useCustomSourceStore.getState().featureEnabled) return [];

  const keyword = buildVariantSearchKeyword(song);
  if (!keyword) return [];

  const remaining = deadlineAt - Date.now() - HIDDEN_PROBE_RESERVE_MS;
  if (remaining <= HIDDEN_MIN_ATTEMPT_MS) return [];
  const timeoutMs = Math.min(HIDDEN_SEARCH_TIMEOUT_MS, remaining);

  const groups = await Promise.all(
    hiddenSourceSearchers.map(async (searcher) => {
      if (enabledResolvers(searcher.id).length === 0) return null;
      try {
        const tracks = await withTimeout(searcher.search(keyword), timeoutMs, "隐藏音源搜索");
        const matched = matchHiddenCandidates(song, tracks);
        if (matched.length === 0) return null;
        debugLog(`[hidden] ${searcher.id} 匹配到 ${matched.length} 个候选: ${song.name}`);
        return { platform: searcher.id, tracks: matched } satisfies HiddenCandidateGroup;
      } catch (error) {
        debugLog(`[hidden] ${searcher.id} 搜索失败: ${errorMessage(error)}`);
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
 * 用已搜到的候选调 LX 脚本取链。
 *
 * 只应在常规链路确认失败后调用。`operation` 由调用方传入并在整个取链过程中复用，
 * 保证「取链用的令牌」与「结果校验用的令牌」是同一个。
 *
 * 返回 null 表示没有可用兜底（没有匹配候选、预算耗尽、令牌失效或全部失败）。
 * 成功时 `music` 仍是原曲：UI、歌词、媒体会话都保持用户点的歌，只有音频 URL 来自隐藏平台。
 */
export async function resolveHiddenFromGroups(
  groups: HiddenCandidateGroup[],
  song: MusicInfo,
  qualityPreference: string[],
  deadlineAt: number,
  operation?: CustomSourceOperation,
): Promise<PlaybackResolvedUrl | null> {
  if (groups.length === 0) return null;
  if (qualityPreference.length === 0) return null;
  if (!operation?.isActive()) return null;

  const trace: PlaybackAttempt[] = [];
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
            debugLog(`[hidden] 预算耗尽，停止兜底: ${song.name}`);
            return null;
          }
          if (!operation.isActive()) return null;

          try {
            const attemptBudget = Math.min(
              HIDDEN_ATTEMPT_TIMEOUT_MS,
              deadlineAt - HIDDEN_PROBE_RESERVE_MS - Date.now(),
            );
            if (attemptBudget <= 0) return null;
            const result = await withTimeout(
              requestCustomSourceMusicUrl(api, song, quality, operation, undefined, platformRequest),
              attemptBudget,
              "隐藏音源取链",
            );
            const resolvedQuality = normalizePlaybackQuality(result.quality || quality);
            const resolverName = `${group.platform}/${api.name}`;
            // 脚本调用成功不等于地址可用：先判死链，死了就换下一个候选/音质/平台，
            // 而不是把一个必然被外层探活否掉的结果定稿。
            const deadReason = await rejectCandidate(result.url, deadlineAt);
            if (!operation.isActive()) return null;
            if (deadReason) {
              trace.push({
                backend: "hiddenSource",
                resolverName,
                source: song.source,
                quality: resolvedQuality,
                status: "failed",
                error: `候选地址不可用（${deadReason}）`,
              });
              debugLog(`[hidden] ${song.name} ${resolverName} 返回的地址不可用（${deadReason}），换下一个候选`);
              continue;
            }
            trace.push({
              backend: "hiddenSource",
              resolverName,
              source: song.source,
              quality: resolvedQuality,
              status: "success",
            });
            debugLog(
              `[hidden] ${song.name} 由 ${resolverName} 兜底成功 (${resolvedQuality})`,
            );
            return {
              url: result.url,
              music: song,
              quality: resolvedQuality,
              backend: "hiddenSource",
              resolverName,
              trace,
            };
          } catch (error) {
            trace.push({
              backend: "hiddenSource",
              resolverName: `${group.platform}/${api.name}`,
              source: song.source,
              quality,
              status: "failed",
              error: errorMessage(error),
            });
          }
        }
      }
    }
  }

  if (trace.length > 0) {
    const detail = trace
      .map((item) => `${item.resolverName} ${item.quality}: ${item.error ?? item.status}`)
      .join("\n");
    debugLog(`[hidden] 全部兜底失败: ${song.name}\n${detail}`);
  }
  return null;
}
