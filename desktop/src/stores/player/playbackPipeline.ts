/**
 * 播放管线：把一首曲目解析成可播地址并交给播放引擎。
 *
 * play 动作整体放在这里（createPlay），内部的 await 顺序与请求代次检查点保持原样、不再细拆；
 * 请求代次本身由 playRequestState 持有。
 */
import { buildSongKey, orderPlaybackCandidates, type MusicInfo } from "@lx/core";
import { debugLog } from "@lx/tauri-bridge";
import { requireCustomSourceOperation, usesCustomSourceRuntime, type CustomSourceOperation } from "@/services/customSourceAccess";
import { openCustomSourceAccess } from "@/services/customSourceGate";
import { createLocalPlaybackLookup } from "@/services/localPlaybackMetadata";
import { cacheResolvedPlaybackMedia } from "@/services/mediaCache";
import { invalidateCachedPlaybackUrl, isLocalCachedPlaybackUrl } from "@/services/persistentCache";
import { findTxVariants, describeCrossSourceFailure } from "@/services/playback/crossSourceFallbackService";
import { resolvePlaybackUrl, type PlaybackBackendId } from "@/services/playback/playbackResolver";
import { selectCachedPlaybackTarget } from "@/services/playback/prefetchModel";
import { prefetchNearbyTracks, prefetchTracks, getPrefetchedTrack, consumePrefetchedTrack, invalidatePrefetchedTrack } from "@/services/playback/prefetchService";
import { playerEngine } from "@/services/playerEngine";
import { customSourceAccess } from "@/stores/customSourceStore";
import { useDiscoveryStore } from "@/stores/discoveryStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { takeResumeProgress } from "@/stores/playerResumeTarget";
import { useVariantPinStore } from "@/stores/variantPinStore";
import {
  beginPlayRequest,
  buildPlayRequestKey,
  getInflightPlayRequest,
  getPlayRequestSignal,
  isActivePlayRequest,
  registerInflightPlayRequest,
  releaseInflightPlayRequest,
  setEngineTargetKey,
} from "./playRequestState";
import type { PlayerGet, PlayerSet, PlayerStore } from "./types";

/** 本地曲目按曲库最新资料取用；引擎同步与曲库订阅共用这一份查找。 */
export const getLocalPlaybackMusic = createLocalPlaybackLookup(() => useLibraryStore.getState().localSongs);

function didPlayFailForTarget(state: Pick<PlayerStore, "current" | "status">, music: MusicInfo): boolean {
  return (
    state.status === "error" &&
    state.current != null &&
    buildPlayRequestKey(state.current) === buildPlayRequestKey(music)
  );
}

/** 播放一首并回报它是否以 error 收场；切歌用它决定要不要回滚下标。 */
export async function playAndDidFail(get: PlayerGet, music: MusicInfo): Promise<boolean> {
  await get().play(music);
  return didPlayFailForTarget(get(), music);
}

/**
 * 交给播放器引擎播放，并把该曲目登记为“引擎应当接管的目标”。
 * 登记后引擎推上一首的状态会被丢弃，直到它真的加载了这首曲目。
 */
async function playThroughEngine(music: MusicInfo, url: string, assertPlaybackAllowed?: () => void): Promise<void> {
  setEngineTargetKey(buildPlayRequestKey(music));
  // 恢复上次播放位置（跨重启）：在装载音频**之前**把秒数交给引擎，
  // 浏览器会把它记成「默认起播位置」，不会出现「先从头播一下再跳」。
  // takeResumeProgress 取一次即消费，且只对同一首歌生效 ——
  // 恢复语义是「按播放继续听」，不是「启动就自动播放」。
  const startAt = takeResumeProgress(music) ?? undefined;
  await playerEngine.play(music, url, assertPlaybackAllowed, startAt);
}

/**
 * 预取条目在预取阶段刻意跳过了媒体缓存（cacheMedia:false，不为可能永远不播的
 * 邻曲下载整曲）。真正播到它时必须补上正规解析链的落盘步骤：命中磁盘直接放
 * 本地文件，未命中先播远端并后台落盘 —— 否则顺序播放永远只消费预取快路径，
 * 磁盘音频缓存与离线列表再也不会被填充。
 *
 * 生命周期失效必须上抛（本曲已无权再用该地址）；媒体缓存自身的失败只记日志、
 * 继续用原地址（与 playbackResolver 里 prepareResolvedPlaybackMedia 的语义一致）。
 */
async function prepareConsumedPrefetch(
  target: { music: MusicInfo; url: string; quality?: string; backend?: PlaybackBackendId },
  operation?: CustomSourceOperation,
): Promise<{ music: MusicInfo; url: string; quality?: string; backend?: PlaybackBackendId }> {
  if (!target.backend || !target.quality || isLocalCachedPlaybackUrl(target.url)) return target;
  try {
    const cached = await cacheResolvedPlaybackMedia(
      target.music,
      {
        url: target.url,
        music: target.music,
        quality: target.quality,
        backend: target.backend,
        resolverName: target.backend,
        trace: [],
      },
      operation,
    );
    return { ...target, url: cached.url, music: cached.music };
  } catch (error) {
    operation?.assertActive();
    debugLog(`[prefetch] 预取条目的媒体缓存处理失败，改用原地址: ${error instanceof Error ? error.message : String(error)}`);
    return target;
  }
}

export async function invalidatePersistentPlaybackCache(
  original: MusicInfo,
  target: MusicInfo,
  quality?: string,
): Promise<void> {
  try {
    await invalidateCachedPlaybackUrl(original, quality);
    if (target.source !== original.source || target.id !== original.id) {
      await invalidateCachedPlaybackUrl(target, quality);
    }
  } catch (error) {
    debugLog(`[cache] invalidatePersistentPlaybackCache failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 预热当前曲目附近的 URL、歌词和封面，切歌与看歌词时更快可用。 */
async function preloadNext(get: PlayerGet): Promise<void> {
  const { queue, currentIndex, repeatMode, isShuffle, fmMode } = get();
  if (fmMode) {
    // FM 模式：预取 discoveryStore 队列中接下来的 1-2 首（URL/歌词/封面），
    // 否则每次「下一首」都实时走完整解析链，正是 FM 切歌慢的根因。
    const { fmQueue, fmIndex } = useDiscoveryStore.getState();
    const upcoming = [fmQueue[fmIndex], fmQueue[fmIndex + 1]].filter(
      (track): track is MusicInfo => !!track,
    );
    if (upcoming.length > 0) await prefetchTracks(upcoming);
    return;
  }
  await prefetchNearbyTracks({ queue, currentIndex, repeatMode, isShuffle, fmMode });
}

export function createPlay(set: PlayerSet, get: PlayerGet): PlayerStore["play"] {
  return async (music) => {
    const requestKey = buildPlayRequestKey(music);
    const inflight = getInflightPlayRequest();
    if (get().status === "loading" && inflight?.key === requestKey) {
      return inflight.promise;
    }

    /**
     * 播放全链失败的统一收尾。
     *
     * 失败时引擎里仍装着上一首：若不停止，界面会停在「新歌 + 报错」而声音继续播
     * 上一首，且 syncEngineToStore 因 engineTargetKey 仍指向新歌而丢弃旧曲的状态
     * 推送，进度条一并冻住 —— 用户必须再切一次歌才能恢复一致。
     *
     * 顺序是刻意的：先解除目标登记，stop() 推来的 idle 才不会被当成「上一首的推送」
     * 丢弃（否则它会覆盖掉刚写入的 error）；最后由本次 set 落定 error 状态。
     */
    const failPlayback = (message: string) => {
      if (!isActivePlayRequest(requestId)) return;
      setEngineTargetKey(null);
      playerEngine.stop();
      set({ status: "error", error: message });
    };

    const requestId = beginPlayRequest(requestKey);
    const signal = getPlayRequestSignal(requestId);
    set({ current: music, status: "loading", error: null, progress: 0, duration: 0 });

    const run = (async () => {
      let operation: CustomSourceOperation | undefined;
      const playResolved = (resolved: { music: MusicInfo; url: string; backend?: PlaybackBackendId }) => {
        // 同一原始令牌同时覆盖解析返回和引擎内部淡出、起播的异步边界。
        const assertPlaybackAllowed = usesCustomSourceRuntime(resolved.backend) ? () => {
          requireCustomSourceOperation(resolved.backend, operation);
        } : undefined;
        assertPlaybackAllowed?.();
        return playThroughEngine(resolved.music, resolved.url, assertPlaybackAllowed);
      };
      try {
        let playedMusic = music;
        // 检查是否为本地音乐
        if ('isLocal' in music && music.isLocal && 'url' in music && music.url) {
          const localMusic = getLocalPlaybackMusic(music);
          await playThroughEngine(localMusic, music.url as string);
          if (!isActivePlayRequest(requestId)) return;
          useHistoryStore.getState().add(music);
          void preloadNext(get).catch(() => undefined);
          return;
        }

        operation = await openCustomSourceAccess();
        if (!isActivePlayRequest(requestId)) return;

        // 优先使用预加载缓存，命中则跳过网络解析

        // 搜索变体（pin 首选置顶）进入解析候选链：主版本全链失败时同链尝试其它版本；
        // 「宁可降音质也不换版本」由 backend 内候选×音质双层循环保证（对齐移动端）。
        const variants = orderPlaybackCandidates(
          music,
          useVariantPinStore.getState().getPinnedVariantKey(buildSongKey(music)),
        );
        let cachedTarget = selectCachedPlaybackTarget(music, getPrefetchedTrack(music) ?? await consumePrefetchedTrack(music, signal));
        if (cachedTarget && usesCustomSourceRuntime(cachedTarget.backend) && (
          !operation?.isActive() || cachedTarget.customSourceVersion !== customSourceAccess.version
        )) {
          cachedTarget = null;
        }

        if (cachedTarget) {

          if (!isActivePlayRequest(requestId)) return;

          try {
            playedMusic = cachedTarget.music;
            const prepared = await prepareConsumedPrefetch(cachedTarget, operation);
            if (!isActivePlayRequest(requestId)) return;
            playedMusic = prepared.music;
            await playResolved(prepared);
          } catch (cachedError) {
            // 引擎以「已被更新的操作取消」失败说明本请求已被取代：不能再作废
            // 缓存或重跑一次全链解析——那些动作只对被取代前的请求有意义。
            if (!isActivePlayRequest(requestId)) return;
            invalidatePrefetchedTrack(music);
            if (cachedTarget.music.source !== music.source || cachedTarget.music.id !== music.id) {
              invalidatePrefetchedTrack(cachedTarget.music);
            }
            if (cachedTarget.fromPersistentCache) {
              await invalidatePersistentPlaybackCache(music, cachedTarget.music, cachedTarget.quality);
            }

            const resolved = await resolvePlaybackUrl(music, variants, undefined, { bypassCache: true, signal });
            if (!isActivePlayRequest(requestId)) return;

            if (!resolved?.url) {
              throw cachedError;
            }

            playedMusic = resolved.music;
            await playResolved(resolved);
          }

        } else {

          // 在线音乐交给播放解析器：先内置网易云，失败后再走备用播放方式。

          const resolved = await resolvePlaybackUrl(music, variants, undefined, { signal });

          if (!isActivePlayRequest(requestId)) return;

          if (!resolved?.url) {
            throw new Error("当前播放方式没有返回可播放地址");
          }

          try {
            playedMusic = resolved.music;
            await playResolved(resolved);
          } catch (playbackError) {
            if (!resolved.fromCache) throw playbackError;

            await invalidatePersistentPlaybackCache(music, resolved.music, resolved.quality);
            const refreshed = await resolvePlaybackUrl(music, variants, undefined, { bypassCache: true, signal });
            if (!isActivePlayRequest(requestId)) return;
            playedMusic = refreshed.music;
            await playResolved(refreshed);
          }

        }
        if (!isActivePlayRequest(requestId)) return;
        useHistoryStore.getState().add(playedMusic);
        void preloadNext(get).catch(() => undefined);
      } catch (e) {
        if (!isActivePlayRequest(requestId)) return;

        // 网易云曲目常规解析失败时，自动直连 QQ 音乐检索并严格校验同名曲接管播放
        // 云盘曲（wyCloud）明确排除：那是账号私有的上传文件，QQ 侧的同名曲是另一份录音，
        // 替过去等于播错歌；未匹配到在线曲目的上传（实测占 75%）靠歌名/歌手匹配尤其不可靠。
        // 解析失败就如实报错（通常是登录过期或文件不可用），不悄悄换一首歌。
        // 与移动端 playerService.resolveCrossSourceSubstitute 的判定保持一致。
        if (music.source === "wy" && music.wyCloud !== true) {
          try {
            debugLog(`[fallback] 网易云曲目解析失败，尝试自动跨源降级 QQ 音乐: ${music.name}`);
            const candidates = await findTxVariants(music, signal);
            if (!isActivePlayRequest(requestId)) return;

            for (const candidate of candidates) {
              if (!isActivePlayRequest(requestId)) return;
              try {
                const fallbackResolved = await resolvePlaybackUrl(candidate, undefined, undefined, { signal });
                if (!isActivePlayRequest(requestId)) return;
                if (fallbackResolved?.url) {
                  await playResolved(fallbackResolved);
                  if (!isActivePlayRequest(requestId)) return;
                  set({ current: fallbackResolved.music });
                  get().notifyPlaybackNotice("已切换 QQ 音乐源");
                  useHistoryStore.getState().add(fallbackResolved.music);
                  void preloadNext(get).catch(() => undefined);
                  debugLog(`[fallback] 跨源降级成功: ${music.name} -> QQ音乐: ${candidate.name} (${candidate.id})`);
                  return;
                }
              } catch {
                // 当前候选获取链接失败，尝试下一条候选
              }
            }

            const reason = describeCrossSourceFailure(candidates);
            failPlayback(`${e instanceof Error ? e.message : String(e)}（${reason}）`);
            return;
          } catch (fallbackErr) {
            // 降级自身出错（典型：QQ 搜索请求失败）要和原始错误一起给用户，
            // 否则只剩一句网易云的报错，看不出自动换源其实没跑成。
            const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            debugLog(`[fallback] 跨源降级过程异常: ${fallbackMessage}`);
            failPlayback(`${e instanceof Error ? e.message : String(e)}（自动切换 QQ 音乐失败：${fallbackMessage}）`);
            return;
          }
        }

        failPlayback(e instanceof Error ? e.message : String(e));
      } finally {
        releaseInflightPlayRequest(requestId);
      }
    })();

    registerInflightPlayRequest({ id: requestId, key: requestKey, promise: run });
    return run;
  };
}
