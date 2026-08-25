/**
 * 播放音质阶梯：双端共用的唯一真相源。
 *
 * 在此之前音质序关系散落三处且互相不一致：
 *  - desktop/src/services/playback/playbackResolver.ts  normalizeQualityPreference（320k 档漏掉 192k）
 *  - apps/mobile/src/services/playbackQualityModel.ts    getPlaybackQualityFallbacks
 *  - desktop/src/services/playback/customSourceBackend.ts getCustomSourceQualities（每档强行追加 128k）
 * 「不低于用户选定音质」的竞速语义要求一个统一的序关系，故收敛到这里。
 */

export type PlaybackQuality = "128k" | "192k" | "320k" | "flac" | "flac24bit";

export const DEFAULT_PLAYBACK_QUALITY: PlaybackQuality = "320k";

/** 音质从低到高。索引即等级，比较大小用 getPlaybackQualityRank。 */
export const PLAYBACK_QUALITY_LADDER: readonly PlaybackQuality[] = [
  "128k",
  "192k",
  "320k",
  "flac",
  "flac24bit",
];

const QUALITY_ALIASES: Record<string, PlaybackQuality> = {
  "128": "128k",
  "128k": "128k",
  low: "128k",
  "192": "192k",
  "192k": "192k",
  medium: "192k",
  "320": "320k",
  "320k": "320k",
  high: "320k",
  flac: "flac",
  "740": "flac",
  hires: "flac24bit",
  "hi-res": "flac24bit",
  flac24bit: "flac24bit",
  "999": "flac24bit",
};

export function normalizePlaybackQuality(value: unknown): PlaybackQuality {
  if (typeof value !== "string") return DEFAULT_PLAYBACK_QUALITY;
  return QUALITY_ALIASES[value.trim().toLowerCase()] ?? DEFAULT_PLAYBACK_QUALITY;
}

/** 音质等级，数值越大越好。用于「不低于门槛」判定和高音质优先裁决。 */
export function getPlaybackQualityRank(value: unknown): number {
  return PLAYBACK_QUALITY_LADDER.indexOf(normalizePlaybackQuality(value));
}

/** 不低于 floor 的所有音质，从高到低。 */
export function getQualitiesAtOrAbove(floor: unknown): PlaybackQuality[] {
  const rank = getPlaybackQualityRank(floor);
  return PLAYBACK_QUALITY_LADDER.slice(rank).reverse();
}

/**
 * 解析音质分轮次表。
 *
 * 首轮为「不低于用户选定音质」的全部档位（从高到低），它们同时参与竞速：
 * 用户选 320k 时某音源只有 flac 也应可用，不该因为档位不精确匹配就降级。
 * 首轮全败才逐档下调，后续每轮单档——更高档已在首轮试过，不重复请求。
 *
 * 例：320k -> [["flac24bit","flac","320k"], ["192k"], ["128k"]]
 *     128k -> [["flac24bit","flac","320k","192k","128k"]]
 */
export function buildPlaybackQualityTiers(floor: unknown): PlaybackQuality[][] {
  const rank = getPlaybackQualityRank(floor);
  const tiers: PlaybackQuality[][] = [getQualitiesAtOrAbove(floor)];
  for (let i = rank - 1; i >= 0; i -= 1) {
    tiers.push([PLAYBACK_QUALITY_LADDER[i]]);
  }
  return tiers;
}

/** 扁平化的降级链，从选定音质逐级降到最低，用于缓存查询等不需要分轮的场景。 */
export function getPlaybackQualityFallbacks(floor: unknown): PlaybackQuality[] {
  const rank = getPlaybackQualityRank(floor);
  return PLAYBACK_QUALITY_LADDER.slice(0, rank + 1).reverse();
}

/** 在候选里挑等级最高的一个，用于「优先高音质」裁决。 */
export function pickHighestQuality<T>(
  items: T[],
  getQuality: (item: T) => unknown,
): T | undefined {
  let best: T | undefined;
  let bestRank = -1;
  for (const item of items) {
    const rank = getPlaybackQualityRank(getQuality(item));
    if (rank > bestRank) {
      bestRank = rank;
      best = item;
    }
  }
  return best;
}

/**
 * 首个成功结果出现后，再给更高音质的追赶时间。
 *
 * 解析链有两层竞速（通道之间、单通道内的音源×音质之间），两层用同一个值：
 * 各层窗口独立计时不叠加，最坏额外等待仍是一个窗口。
 */
export const DEFAULT_QUALITY_UPGRADE_WINDOW_MS = 800;

export interface QualityRaceOptions<T> {  getQuality: (value: T) => unknown;
  /** 首个成功结果出现后，再给更高音质多少毫秒的追赶时间。 */
  upgradeWindowMs: number;
  /** 达到该音质即视为最优，直接返回不再等待。默认为阶梯顶端。 */
  ceiling?: unknown;
  /** 聚合失败时构造错误，便于各端给出带上下文的提示。 */
  formatError?: (errors: unknown[]) => Error;
}

/**
 * 竞速取最优音质：全部候选并发，先成功者暂存，并在有限窗口内等待更高音质翻盘。
 *
 * 纯竞速（谁快谁赢）会让同一首歌每次播放拿到的音质随机漂移；直接等全部返回
 * 又会被慢音源拖住。折中是首个成功结果开启一个升级窗口：窗口内有更高档就换，
 * 窗口到期或已达 ceiling 就立刻定稿。
 *
 * 失败的候选不影响其余候选；全部失败才抛错。
 */
export function raceForBestQuality<T>(
  attempts: Array<Promise<T>>,
  options: QualityRaceOptions<T>,
): Promise<T> {
  const formatError = options.formatError ?? defaultQualityRaceError;
  if (!attempts.length) return Promise.reject(formatError([]));

  const ceilingRank = options.ceiling == null
    ? PLAYBACK_QUALITY_LADDER.length - 1
    : getPlaybackQualityRank(options.ceiling);

  return new Promise<T>((resolve, reject) => {
    let pending = attempts.length;
    let best: T | undefined;
    let bestRank = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const errors: unknown[] = [];

    const settle = () => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      if (bestRank >= 0) resolve(best as T);
      else reject(formatError(errors));
    };

    for (const attempt of attempts) {
      attempt.then(
        (value) => {
          if (done) return;
          pending -= 1;
          const rank = getPlaybackQualityRank(options.getQuality(value));
          if (rank > bestRank) {
            best = value;
            bestRank = rank;
          }
          if (bestRank >= ceilingRank || pending === 0) {
            settle();
            return;
          }
          if (timer === null) timer = setTimeout(settle, options.upgradeWindowMs);
        },
        (error: unknown) => {
          if (done) return;
          pending -= 1;
          errors.push(error);
          if (pending === 0) settle();
        },
      );
    }
  });
}

function defaultQualityRaceError(errors: unknown[]): Error {
  if (!errors.length) return new Error("没有可用的解析候选");
  const detail = errors
    .map((error) => (error instanceof Error ? error.message : String(error)))
    .join(" | ");
  return new Error(detail);
}
