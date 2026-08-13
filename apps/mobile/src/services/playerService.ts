import type { MusicInfo, LyricLine } from "@lx/core";
import { parseUrl, getLyrics, buildStreamHeaders, STREAM_USER_AGENT } from "./musicApi";
import { resolveBiliSongUrl } from "./biliService";
import { usePlayerStore } from "../stores/playerStore";
import type { PlayMode } from "../stores/playerStore";
import { useHistoryStore } from "../stores/historyStore";
import { useCustomSourceStore } from "../stores/customSourceStore";
import { requestCustomSourceMusicUrl } from "./customSourceRuntime";
import { cacheCover, cacheLyrics, getCachedLyrics, cacheAudioFile, getCachedAudioFile, isLocalFilePlayable, CACHEABLE_AUDIO_SOURCES } from "./cacheService";
import { getCachedPlaybackUrl, saveCachedPlaybackUrl, invalidateCachedPlaybackUrl } from "./playbackUrlCache";
import { getPersonalFmSongs, trashPersonalFmSong } from "./wyPlaylistService";
import { getNextQueueNavigationState, getPreviousQueueNavigationState } from "@/services/queueNavigationModel";
import { dequeueTempPlayList, insertSongToPlayNext } from "@/services/songQueueActions";
import { getPlaybackQualityFallbacks, resolveEffectivePlaybackQuality } from "@/services/playbackQualityModel";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
// ─────────────────────────────────────────────────────────────
// 预读下一首：模块级缓存，解析后只缓存 URL（不播放）
// ─────────────────────────────────────────────────────────────
interface PrefetchedUrl {
  url: string;
  headers?: Record<string, string>;
  fetchedAt: number;
}
const PREFETCH_TTL_MS = 10 * 60 * 1000;
const prefetchCache = new Map<string, PrefetchedUrl>();
function getTrackKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

/** 在线音频流统一浏览器 UA / wy、tx CDN 防盗链头由 musicApi 共享（播放与下载共用）。 */

function getCachedPrefetch(song: MusicInfo): PrefetchedUrl | undefined {
  const key = getTrackKey(song);
  const entry = prefetchCache.get(key);
  if (entry && Date.now() - entry.fetchedAt < PREFETCH_TTL_MS) {
    return entry;
  }
  if (entry) {
    prefetchCache.delete(key);
  }
  return undefined;
}

export function clearPrefetchCache(): void {
  prefetchCache.clear();
}

/** 清掉某首歌的预读缓存（切换音质时必须失效旧 URL）。 */
export function invalidatePrefetchForSong(song: MusicInfo): void {
  prefetchCache.delete(getTrackKey(song));
}

/**
 * 自定义音源回退：内置 API 解析失败后，依次尝试已启用的自定义音源脚本解析播放 URL。
 * 任一音源成功即返回；全部失败则抛出最后一个错误。
 */
async function resolveUrlWithCustomSource(
  song: MusicInfo,
  quality = "320k",
): Promise<string> {
  const enabledSources = useCustomSourceStore
    .getState()
    .sources.filter((source) => source.enabled);
  if (enabledSources.length === 0) {
    throw new Error("无可用的自定义音源");
  }
  let lastError: unknown = null;
  for (const source of enabledSources) {
    try {
      const result = await requestCustomSourceMusicUrl(source, song, quality);
      return result.url;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("所有自定义音源均解析失败");
}

/**
 * 解析单首歌曲的播放地址（优先命中预读缓存）。
 * 解析成功后写入预读缓存，供 playNext/playPrevious 直接复用。
 */
async function resolveSongUrl(
  song: MusicInfo,
  qualityOverride?: string | null,
): Promise<{ url: string; headers?: Record<string, string> }> {
  // 计算音质降级链（显式指定音质时跳过预读/持久化缓存，避免旧码率命中）
  const quality = qualityOverride
    ? resolveEffectivePlaybackQuality(qualityOverride, qualityOverride)
    : resolveEffectivePlaybackQuality(song.quality, usePlaybackSettingsStore.getState().defaultQuality);
  const qualityCandidates = getPlaybackQualityFallbacks(quality);

  // 1. 命中预读缓存直接返回
  if (!qualityOverride) {
    const prefetched = getCachedPrefetch(song);
    if (prefetched) {
      return { url: prefetched.url, headers: prefetched.headers };
    }
    // 1.2 直接命中本地音频缓存文件（lx isCached 等价）：优先整曲落盘的 wy/tx 等可缓存音源，
    // 离线可播、省流量，不必依赖持久化 URL 缓存中的 file:// 条目（该条目可能被清理/过期）。
    // 按降级链逐个候选查（cacheAudioFile 写盘用的是实际解析成功的音质，可能低于有效音质），
    // 与持久化 URL 缓存的降级语义一致，避免降级播放后下次播放查不到本地文件。
    if (CACHEABLE_AUDIO_SOURCES.has(song.source)) {
      for (const candidate of qualityCandidates) {
        const cachedAudioPath = await getCachedAudioFile(song, candidate);
        if (!cachedAudioPath) continue;
        prefetchCache.set(getTrackKey(song), {
          url: cachedAudioPath,
          headers: undefined,
          fetchedAt: Date.now(),
        });
        return { url: cachedAudioPath, headers: undefined };
      }
    }
    // 1.5 命中持久化 URL 缓存：冷启动/重启后免重新解析网关，对齐桌面端 persistentCache
    const persisted = await getCachedPlaybackUrl(song, qualityCandidates);
    if (persisted) {
      // 持久化缓存可能存的是本地音频文件（#2 媒体缓存）：校验文件未被清理策略回收
      if (persisted.url.startsWith("file://")) {
        if (await isLocalFilePlayable(persisted.url)) {
          prefetchCache.set(getTrackKey(song), {
            url: persisted.url,
            headers: undefined,
            fetchedAt: Date.now(),
          });
          return { url: persisted.url, headers: undefined };
        }
        void invalidateCachedPlaybackUrl(song, persisted.quality).catch(() => undefined);
      } else {
        // 旧持久化条目可能没存 headers（修复前写入）：按音源补齐防盗链头，避免命中旧缓存仍 403
        const persistedHeaders = persisted.headers ?? buildStreamHeaders(song.source);
        prefetchCache.set(getTrackKey(song), {
          url: persisted.url,
          headers: persistedHeaders,
          fetchedAt: Date.now(),
        });
        return { url: persisted.url, headers: persistedHeaders };
      }
    }
  }

  // 2. 实际解析
  let url: string;
  let headers: Record<string, string> | undefined;
  let resolvedQuality: string | undefined;
  if (song.isLocal && song.url) {
    url = song.url;
  } else if (song.source === "bili") {
    const result = await resolveBiliSongUrl(song);
    url = result.url;
    headers = {
      Referer: result.referer,
      "User-Agent": STREAM_USER_AGENT,
    };
  } else {
    // 内置解析：从目标音质逐级降级重试，全部失败后再尝试自定义音源
    let resolvedUrl = "";
    let builtinError: unknown = null;
    for (const candidate of qualityCandidates) {
      try {
        resolvedUrl = await parseUrl(song, candidate);
        resolvedQuality = candidate;
        break;
      } catch (error) {
        builtinError = error;
      }
    }
    if (resolvedUrl) {
      url = resolvedUrl;
    } else {
      url = await resolveUrlWithCustomSource(song, quality);
    }
    // wy/tx 音源 CDN 防盗链：附 Referer/UA，避免 403（修复实机验证的播放失败）
    headers = buildStreamHeaders(song.source);
  }
  if (!url) {
    throw new Error("无法获取播放地址");
  }

  // 3. 写入预读缓存
  prefetchCache.set(getTrackKey(song), { url, headers, fetchedAt: Date.now() });

  // 3.5 写入持久化 URL 缓存（本地文件不缓存）
  if (!song.isLocal && song.source !== "local") {
    const cacheQuality = resolvedQuality ?? qualityOverride ?? song.quality ?? "320k";
    void saveCachedPlaybackUrl(song, { url, quality: cacheQuality, headers }).catch(() => {});

    // 3.6 后台缓存音频文件到本地（仅 wy/tx，对齐桌面端 CACHEABLE_AUDIO_SOURCES），
    // 下载完成后把本地 file:// 写回持久化缓存与预读缓存，下次播放离线即开。
    if (CACHEABLE_AUDIO_SOURCES.has(song.source) && /^https?:\/\//i.test(url)) {
      void cacheAudioFile(url, song, cacheQuality)
        .then((localPath) => {
          if (!localPath) return;
          prefetchCache.set(getTrackKey(song), {
            url: localPath,
            headers: undefined,
            fetchedAt: Date.now(),
          });
          void saveCachedPlaybackUrl(song, { url: localPath, quality: cacheQuality }).catch(() => undefined);
        })
        .catch(() => undefined);
    }
  }

  return { url, headers };
}

/**
 * 邻近歌曲预读窗口（对齐桌面端 PREFETCH_OFFSETS：上一首 + 下两首）。
 * 非随机模式按 [-1, 1, 2]；随机模式按 [1, 2, -1]。
 */
const PREFETCH_OFFSETS = [-1, 1, 2] as const;
const SHUFFLE_PREFETCH_OFFSETS = [1, 2, -1] as const;

function isQueueWrappingMode(playMode: PlayMode): boolean {
  return playMode === "list" || playMode === "shuffle";
}

/**
 * 计算当前曲周围需预读的候选索引（去重、排除当前曲、按播放模式处理越界环绕）。
 * single 单曲循环无邻近预读。
 */
export function getNearbyQueueIndexes(
  queueLength: number,
  currentIndex: number,
  playMode: PlayMode,
): number[] {
  if (queueLength <= 0 || currentIndex < 0 || currentIndex >= queueLength) return [];
  if (playMode === "single") return [];
  const wrap = isQueueWrappingMode(playMode);
  const offsets = playMode === "shuffle" ? SHUFFLE_PREFETCH_OFFSETS : PREFETCH_OFFSETS;
  const seen = new Set<number>([currentIndex]);
  const result: number[] = [];
  for (const offset of offsets) {
    const rawIndex = currentIndex + offset;
    let index: number | null = null;
    if (rawIndex >= 0 && rawIndex < queueLength) {
      index = rawIndex;
    } else if (wrap) {
      index = ((rawIndex % queueLength) + queueLength) % queueLength;
    }
    if (index == null || seen.has(index)) continue;
    seen.add(index);
    result.push(index);
  }
  return result;
}

/** 取当前曲邻近需预读的歌曲列表（仅 queue 上下文；私人 FM 由其独立缓冲处理）。 */
function getNearbySongs(): MusicInfo[] {
  const { playbackContext, queue, currentIndex, playMode } = usePlayerStore.getState();
  if (playbackContext.type === "personalFm") return [];
  return getNearbyQueueIndexes(queue.length, currentIndex, playMode)
    .map((index) => queue[index])
    .filter((song): song is MusicInfo => !!song);
}

/**
 * 预取单曲的歌词（缓存未命中时拉取并写入缓存），供切歌时秒开。
 * 已有缓存则直接跳过，不产生网络请求。
 */
function prefetchLyrics(song: MusicInfo): void {
  getCachedLyrics(song)
    .then((cached) => {
      if (cached && cached.length > 0) return;
      return getLyrics(song).then((lyrics) => {
        if (lyrics.length > 0) return cacheLyrics(song, lyrics);
      });
    })
    .catch(() => undefined);
}

/**
 * 预取单曲封面到本地缓存，供 CachedImage 直接命中。
 */
function prefetchCover(song: MusicInfo): void {
  const cover = song.picUrl || song.img;
  if (!cover) return;
  cacheCover(cover).catch(() => undefined);
}

/**
 * 异步预读邻近歌曲（上一首 + 下两首，对齐桌面端 prefetchNearbyTracks）：
 * 解析并缓存播放 URL、预取歌词与封面，使切歌时 URL/歌词/封面秒开。
 * 只做缓存预取，不写入 TrackPlayer 原生队列（原生始终保持单曲，切歌由 JS 调度）。
 */
function prefetchNearbySongs(): void {
  const nearby = getNearbySongs();

  for (const song of nearby) {
    // 歌词/封面无论 URL 是否已缓存都尝试预取（各自内部会跳过已命中项）
    prefetchLyrics(song);
    prefetchCover(song);
    // 已有新鲜 URL 缓存则跳过 URL 解析
    if (getCachedPrefetch(song)) continue;
    // 只解析并缓存播放 URL（prefetchCache 命中后 playNext/playPrevious 秒开），
    // 不再把下一首 add 进 TrackPlayer 原生队列——原生队列始终保持单曲，歌曲结束由
    // PlaybackQueueEnded 事件驱动 JS 切歌，避免原生自动切歌导致 currentSong/歌词/
    // 进度等 JS 状态不同步（对齐 lx-mobile：原生只播单曲，切歌一律由 JS 调度）。
    resolveSongUrl(song).catch(() => undefined);
  }
}

/**
 * 播放歌曲（完整流程）
 */
async function playSongCore(song: MusicInfo, startPosition?: number): Promise<void> {
  const { play, setLoading, setError } = usePlayerStore.getState();
  const { addToHistory } = useHistoryStore.getState();
  try {
    setLoading(true);
    setError(null);
    // 1. 解析播放 URL（命中预读缓存时无需等待网络）
    const { url, headers } = await resolveSongUrl(song);
    // 2. 播放（B站音源需要带 headers；startPosition 用于快照恢复续播）
    await play(song, url, headers, startPosition);
    // 3. 添加到历史
    await addToHistory(song);
    // 4. 异步加载歌词（优先缓存）
    loadLyrics(song);
    // 5. 异步缓存封面
    if (song.picUrl || song.img) {
      cacheCover(song.picUrl || song.img!).catch(() => undefined);
    }
    // 6. 异步预读邻近歌曲（上一首 + 下两首）：解析 URL/歌词/封面入缓存，下一首提前入队
    prefetchNearbySongs();
  } catch (error) {
    const message = error instanceof Error ? error.message : "播放失败";
    setError(message);
    throw error;
  } finally {
    setLoading(false);
  }
}

/**
 * 切换当前曲的播放音质：清缓存 → 按目标音质重解析 → 尽量从原进度续播。
 * 本地曲 / B站等不走音质阶梯的源会直接抛错。
 */
export async function switchCurrentPlaybackQuality(quality: string): Promise<void> {
  const store = usePlayerStore.getState();
  const currentSong = store.currentSong;
  if (!currentSong) {
    throw new Error("当前没有正在播放的歌曲");
  }
  if (currentSong.isLocal || currentSong.source === "local") {
    throw new Error("本地歌曲不支持切换在线音质");
  }
  if (currentSong.source === "bili") {
    throw new Error("B站音源暂不支持手动切换音质");
  }

  // 失效旧音质的持久化 URL 缓存，确保切换后按新音质重新解析（对齐桌面端）
  invalidateCachedPlaybackUrl(currentSong, currentSong.quality);

  const resumePosition = store.position;
  const wasPlaying = store.isPlaying;
  const nextSong: MusicInfo = {
    ...currentSong,
    quality: quality as MusicInfo["quality"],
  };

  // 队列里同步更新 quality，后续切回这首仍用新音质；不改设置页默认音质
  const nextQueue = store.queue.map((item) =>
    item.source === currentSong.source && String(item.id) === String(currentSong.id)
      ? { ...item, quality: nextSong.quality }
      : item,
  );
  usePlayerStore.setState({ queue: nextQueue, currentSong: nextSong });

  invalidatePrefetchForSong(currentSong);
  invalidatePrefetchForSong(nextSong);

  const { play, setLoading, setError } = usePlayerStore.getState();
  try {
    setLoading(true);
    setError(null);
    const { url, headers } = await resolveSongUrl(nextSong, quality);
    await play(nextSong, url, headers);
    if (resumePosition > 1) {
      try {
        await usePlayerStore.getState().seekTo(resumePosition);
      } catch {}
    }
    if (!wasPlaying) {
      await usePlayerStore.getState().pause();
    }
    prefetchNearbySongs();
  } catch (error) {
    setError(error instanceof Error ? error.message : "切换音质失败");
    throw error;
  } finally {
    setLoading(false);
  }
}

/**
 * 播放队列中的歌曲
 */
export async function playSong(song: MusicInfo): Promise<void> {
  usePlayerStore.getState().setQueuePlaybackContext();
  await playSongCore(song);
}

/**
 * 播放队列中的歌曲
 */
export async function playFromQueue(index: number, startPosition?: number): Promise<void> {
  const { playbackContext, queue } = usePlayerStore.getState();
  if (index < 0 || index >= queue.length) return;
  const song = queue[index];
  if (playbackContext.type === "personalFm") {
    usePlayerStore.getState().setPersonalFmBatchIndex(index);
  } else {
    usePlayerStore.setState({ currentIndex: index });
  }
  await playSongCore(song, startPosition);
}

/**
 * 批量添加到队列并播放
 */
export async function playQueue(songs: MusicInfo[], startIndex = 0): Promise<void> {
  const { setQueue } = usePlayerStore.getState();
  if (songs.length === 0) return;
  if (startIndex < 0 || startIndex >= songs.length) {
    startIndex = 0;
  }
  setQueue(songs, startIndex);
  await playSongCore(songs[startIndex]);
}

/**
 * 随机排序后批量添加到队列并播放
 */
export async function playShuffledQueue(songs: MusicInfo[]): Promise<void> {
  if (songs.length === 0) return;
  const shuffledSongs = [...songs];
  for (let i = shuffledSongs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledSongs[i], shuffledSongs[j]] = [shuffledSongs[j], shuffledSongs[i]];
  }
  await playQueue(shuffledSongs, 0);
}

/**
 * 播放下一首
 */
export async function playNext(): Promise<void> {
  const store = usePlayerStore.getState();
  const { playbackContext, queue, currentIndex, playMode, shuffleHistory, playedIndices, tempPlayList } = store;
  if (playbackContext.type === "personalFm") {
    await playNextPersonalFmSong();
    return;
  }

  // 稍后播放：优先消费 tempPlayList 首曲。取出后插入主队列 currentIndex+1，
  // 播完自然回到「原本的下一首」逻辑（因为主队列指针只前进了一步）。
  if (tempPlayList.length > 0) {
    const { nextSong, tempPlayList: nextTempList } = dequeueTempPlayList(tempPlayList);
    if (nextSong) {
      const inserted = insertSongToPlayNext({ queue, currentIndex, song: nextSong });
      usePlayerStore.setState({
        queue: inserted.queue,
        currentIndex: inserted.currentIndex,
        tempPlayList: nextTempList,
      });
      // 空队列场景：insertSongToPlayNext 返回 currentIndex=0 且 queue=[nextSong]，直接播这首。
      const targetIndex = queue.length === 0 || currentIndex < 0 ? 0 : currentIndex + 1;
      await playFromQueue(targetIndex);
      return;
    }
  }

  const next = getNextQueueNavigationState({
    queueLength: queue.length,
    currentIndex,
    playMode,
    shuffleHistory,
    playedIndices,
  });
  usePlayerStore.setState({ shuffleHistory: next.shuffleHistory, playedIndices: next.playedIndices });
  if (next.nextIndex == null) return;
  await playFromQueue(next.nextIndex);
}

/**
 * 播放上一首
 */
export async function playPrevious(): Promise<void> {
  const { playbackContext, queue, currentIndex, position, playMode, shuffleHistory } = usePlayerStore.getState();
  if (queue.length === 0) return;
  if (playbackContext.type === "personalFm") {
    if (position > 3) {
      await usePlayerStore.getState().seekTo(0);
      return;
    }
    const prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      await usePlayerStore.getState().seekTo(0);
      return;
    }
    usePlayerStore.getState().setPersonalFmBatchIndex(prevIndex);
    await playFromQueue(prevIndex);
    return;
  }
  const previous = getPreviousQueueNavigationState({
    queueLength: queue.length,
    currentIndex,
    position,
    playMode,
    shuffleHistory,
  });
  usePlayerStore.setState({ shuffleHistory: previous.shuffleHistory });
  if (previous.shouldRestartCurrent) {
    await usePlayerStore.getState().seekTo(0);
    return;
  }
  if (previous.previousIndex == null) return;
  await playFromQueue(previous.previousIndex);
}

/**
 * 加载歌词
 */
export async function startPersonalFm(): Promise<MusicInfo[]> {
  const { songs, hasMore } = await getPersonalFmSongs();
  if (songs.length === 0) {
    throw new Error("暂无可播放的私人 FM");
  }
  const [currentSong, ...restSongs] = songs;
  usePlayerStore.getState().setPersonalFmContext({
    currentBatch: [currentSong],
    currentBatchIndex: 0,
    buffer: restSongs,
    hasMore,
  });
  await playSongCore(currentSong);
  return songs;
}

export async function playNextPersonalFmSong(): Promise<void> {
  const store = usePlayerStore.getState();
  const context = store.playbackContext;
  if (context.type !== "personalFm") {
    return;
  }
  const nextInBatchIndex = context.currentBatchIndex + 1;
  if (nextInBatchIndex < context.currentBatch.length) {
    usePlayerStore.setState({ currentIndex: nextInBatchIndex });
    usePlayerStore.getState().setPersonalFmContext({
      currentBatch: context.currentBatch,
      currentBatchIndex: nextInBatchIndex,
      buffer: context.buffer,
      hasMore: context.hasMore,
    });
    await playSongCore(context.currentBatch[nextInBatchIndex]);
    return;
  }
  let nextSong = store.shiftPersonalFmBuffer();
  if (!nextSong) {
    const result = await getPersonalFmSongs();
    if (result.songs.length === 0) {
      throw new Error("暂无更多私人 FM");
    }
    const [firstSong, ...restSongs] = result.songs;
    usePlayerStore.getState().setPersonalFmContext({
      currentBatch: result.songs,
      currentBatchIndex: 0,
      buffer: restSongs,
      hasMore: result.hasMore,
    });
    await playSongCore(firstSong);
    return;
  }
  const nextBatch = [...context.currentBatch, nextSong];
  const refreshedContext = usePlayerStore.getState().playbackContext;
  const nextBuffer = refreshedContext.type === "personalFm" ? refreshedContext.buffer : [];
  usePlayerStore.getState().setPersonalFmContext({
    currentBatch: nextBatch,
    currentBatchIndex: nextBatch.length - 1,
    buffer: nextBuffer,
    hasMore: context.hasMore,
  });
  await playSongCore(nextSong);
  const latestContext = usePlayerStore.getState().playbackContext;
  if (latestContext.type === "personalFm" && latestContext.buffer.length < 2 && latestContext.hasMore) {
    try {
      const refill = await getPersonalFmSongs();
      usePlayerStore.getState().appendPersonalFmBuffer(refill.songs, refill.hasMore);
    } catch {}
  }
}

export async function dislikeCurrentPersonalFmSong(): Promise<void> {
  const store = usePlayerStore.getState();
  const { currentSong, playbackContext } = store;
  if (!currentSong || playbackContext.type !== "personalFm") {
    throw new Error("当前不是私人 FM 播放");
  }
  await trashPersonalFmSong(currentSong.id);
  store.markCurrentPersonalFmSongSkipped();
  await playNextPersonalFmSong();
}

async function loadLyrics(song: MusicInfo): Promise<void> {
  try {
    const { setLyrics } = usePlayerStore.getState();
    // 1. 尝试从缓存加载
    const cachedLyrics = await getCachedLyrics(song);
    if (cachedLyrics && cachedLyrics.length > 0) {
      setLyrics(cachedLyrics);
      return;
    }
    // 2. 从网络获取
    const lyrics = await getLyrics(song);
    setLyrics(lyrics);
    // 3. 缓存歌词
    if (lyrics.length > 0) {
      await cacheLyrics(song, lyrics);
    }
  } catch (error) {
    usePlayerStore.getState().setLyrics([]);
  }
}

/**
 * 格式化时间（秒 -> mm:ss）
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * 获取当前歌词行索引
 */
export function getCurrentLyricIndex(
  lyrics: Array<{ time: number; text: string }>,
  position: number
): number {
  if (lyrics.length === 0) return -1;
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (position >= lyrics[i].time) {
      return i;
    }
  }
  return -1;
}
