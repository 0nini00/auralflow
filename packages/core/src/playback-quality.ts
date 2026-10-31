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

/**
 * 别名表：把各音源/网关实际会吐出的标签折算成阶梯上的标准档位。
 *
 * 收录标准是「真实出现过」，不是「可能有人这么写」：
 *  - 数字档位 128/192/320/740/999 来自网关的档位编码；
 *  - `hires` / `hi-res` 来自 gdstudio；
 *  - `sq`（无损）/ `hq`（320k）来自 QQ 音乐与酷我系的命名；
 *  - `lossless` / `flac` / `flac24` / `24bit` 来自自定义 LX 脚本的常见写法。
 *
 * 每增加一个别名都应该同时补一条 `playback-quality.test.ts` 用例——
 * 这张表是「不低于用户选定音质」裁决的输入，错了只会表现为「莫名其妙降级」。
 */
const QUALITY_ALIASES: Record<string, PlaybackQuality> = {
  "128": "128k",
  "128k": "128k",
  low: "128k",
  standard: "128k",
  std: "128k",
  "192": "192k",
  "192k": "192k",
  medium: "192k",
  "320": "320k",
  "320k": "320k",
  high: "320k",
  hq: "320k",
  flac: "flac",
  lossless: "flac",
  sq: "flac",
  "740": "flac",
  hires: "flac24bit",
  "hi-res": "flac24bit",
  "hi_res": "flac24bit",
  flac24: "flac24bit",
  flac24bit: "flac24bit",
  "24bit": "flac24bit",
  "999": "flac24bit",
};

/**
 * 归一化并把「是否认识这个标签」一并交出。
 *
 * `normalizePlaybackQuality` 对未知值回落到 320k 是为了让调用方永远拿到一个
 * 可用档位（所有历史调用点都按这个契约写）；但**静默**回落会让未知标签在
 * 「不低于门槛」的竞速里冒充 320k：一个实际是 128k 的源只要标签写成 `AAC`，
 * 就会被当成 320k 参与裁决并被选中，用户听到的是降级音频且没有任何线索。
 *
 * 因此需要判断的地方用本函数拿 `known`，需要「先有个档位」的地方继续用
 * `normalizePlaybackQuality`。核心包不写日志（无 IO 约束），观测由调用方决定。
 */
export function classifyPlaybackQuality(value: unknown): {
  quality: PlaybackQuality;
  known: boolean;
} {
  if (typeof value !== "string") return { quality: DEFAULT_PLAYBACK_QUALITY, known: false };
  const key = value.trim().toLowerCase();
  if (!key) return { quality: DEFAULT_PLAYBACK_QUALITY, known: false };
  const matched = QUALITY_ALIASES[key];
  return matched
    ? { quality: matched, known: true }
    : { quality: DEFAULT_PLAYBACK_QUALITY, known: false };
}

export function normalizePlaybackQuality(value: unknown): PlaybackQuality {
  return classifyPlaybackQuality(value).quality;
}

/**
 * 音源/脚本自报的音质标签 → 标准档位。
 *
 * 认识的别名声明的就是事实，直接采信；**不认识时退回「本次请求的档位」而不是
 * 320k**：既然我们按 `requested` 去要的链，源又没给出可识别的档位，
 * 最合理的估计是它给了我们要的东西，而不是凭空声称 320k。
 *
 * 这个规则必须双端一致——否则同一个脚本在两端会被判成不同音质，
 * 直接导致「桌面能升到无损、移动端一直停在 320k」这类不对称行为。
 */
export function normalizeSourceQualityLabel(label: unknown, requested: unknown): PlaybackQuality {
  const decided = classifyPlaybackQuality(label);
  return decided.known ? decided.quality : normalizePlaybackQuality(requested);
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

/** 交错启动的默认间隔：上一个候选尚未结算时，最多等这么久就并行启动下一个。 */
export const DEFAULT_SOURCE_STAGGER_MS = 800;

export interface StaggeredPriorityRaceOptions<T> {
  getQuality: (value: T) => unknown;
  /** 本轮可接受的最高档：命中且没有更靠前的候选在途时立即定稿。 */
  ceiling?: unknown;
  /** 本轮可接受的最低档：低于它的结果不参与裁决。 */
  floor?: unknown;
  /** 上一个候选未结算时，最多等多久就启动下一个（默认 DEFAULT_SOURCE_STAGGER_MS）。 */
  staggerMs?: number;
  /**
   * 交错启动的总展开上限：候选数多时按比例压缩有效间隔（保持相对顺序），
   * 保证队尾候选不被优先权排序拖到预算尾巴（如 7 个音源 × 800ms = 4.8s，
   * 实测唯一可用的源恰在队尾时，展开时间直接吃掉大半预算）。
   */
  maxSpreadMs?: number;
  /** 首个可接受结果后，等待更高档或更靠前候选的窗口（默认 DEFAULT_QUALITY_UPGRADE_WINDOW_MS）。 */
  upgradeWindowMs?: number;
  /** 本轮总预算（自调用起算）：到期停止启动新候选，用已得结果定稿，没有则拒绝。 */
  deadlineMs?: number;
  /** 聚合失败时构造错误，便于各端给出带上下文的提示。 */
  formatError?: (errors: unknown[]) => Error;
}

/**
 * 按序交错竞速：候选按数组顺序启动，前一个结算立即启动下一个，
 * 未结算则最多等 staggerMs 并行启动下一个（maxSpreadMs 可压缩总展开时间）——
 * 用户的顺序意图是「优先权」而非「独占权」，慢候选不再阻塞后续候选，也不会被固定预算击杀。
 *
 * 裁决规则（重复结果按等级→顺序取优）：
 *  - 等级不低于 ceiling 且更靠前的候选都已结算 → 立即定稿；
 *  - 首个可接受结果开启升级窗口，窗口内更高等级、或同等级更靠前的候选可翻盘；
 *    窗口到期即使更靠前候选仍在途也直接定稿（stagger 启动的慢源不无限拖住定稿，
 *    这是「及时出结果」与「等最优」之间刻意的取舍）；
 *  - 低于 floor 的结果不参与裁决；
 *  - 全部候选结算仍无结果才拒绝；deadline 到期时以已有结果定稿或拒绝。
 *
 * 与 raceForBestQuality 的区别：候选是惰性按序启动的（来源优先级 = 用户排序），
 * 而不是全部并发；这是「按序 + 预算」串行方案的替代——固定预算会击杀
 * 响应较慢但可用的候选（例如走第三方代理的 LX 脚本，正常耗时 3s+）。
 */
export function raceStaggeredPriority<T>(
  launchers: Array<() => Promise<T>>,
  options: StaggeredPriorityRaceOptions<T>,
): Promise<T> {
  const formatError = options.formatError ?? defaultQualityRaceError;
  if (!launchers.length) return Promise.reject(formatError([]));

  const floorRank = options.floor == null ? 0 : getPlaybackQualityRank(options.floor);
  const ceilingRank = options.ceiling == null
    ? PLAYBACK_QUALITY_LADDER.length - 1
    : getPlaybackQualityRank(options.ceiling);
  const staggerMs = options.staggerMs ?? DEFAULT_SOURCE_STAGGER_MS;
  const launchSpan = Math.max(launchers.length - 1, 0);
  const effectiveStaggerMs = options.maxSpreadMs != null && launchSpan > 0
    ? Math.min(staggerMs, options.maxSpreadMs / launchSpan)
    : staggerMs;
  const upgradeWindowMs = options.upgradeWindowMs ?? DEFAULT_QUALITY_UPGRADE_WINDOW_MS;

  const errors: unknown[] = [];
  const settled: boolean[] = launchers.map(() => false);
  let launchedCount = 0;
  let pending = 0;
  let done = false;
  let best: T | undefined;
  let bestRank = -1;
  let bestIndex = Number.POSITIVE_INFINITY;
  let windowTimer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<T>((resolve, reject) => {
    const finish = () => {
      if (done) return;
      done = true;
      if (windowTimer !== null) clearTimeout(windowTimer);
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      if (bestRank >= 0) resolve(best as T);
      else reject(formatError(errors));
    };

    const isBetter = (rank: number, index: number) =>
      rank > bestRank || (rank === bestRank && index < bestIndex);

    const noEarlierPending = (index: number) => {
      for (let i = 0; i < index; i += 1) {
        if (!settled[i]) return false;
      }
      return true;
    };

    const maybeLaunchNext = (index: number) => {
      if (!done && index === launchedCount - 1) launchNext();
    };

    const onValue = (index: number, value: T) => {
      if (done) return;
      pending -= 1;
      settled[index] = true;
      const rank = getPlaybackQualityRank(options.getQuality(value));
      if (rank < floorRank) {
        errors.push(
          new Error(
            `第 ${index + 1} 个候选音质不足(${normalizePlaybackQuality(options.getQuality(value))} < ${normalizePlaybackQuality(options.floor)})`,
          ),
        );
      } else if (isBetter(rank, index)) {
        best = value;
        bestRank = rank;
        bestIndex = index;
      }
      if (bestRank >= ceilingRank && noEarlierPending(bestIndex)) {
        finish();
        return;
      }
      if (bestRank >= floorRank && windowTimer === null) {
        windowTimer = setTimeout(finish, upgradeWindowMs);
      }
      if (pending === 0 && launchedCount === launchers.length) {
        finish();
        return;
      }
      maybeLaunchNext(index);
    };

    const onError = (index: number, error: unknown) => {
      if (done) return;
      pending -= 1;
      settled[index] = true;
      errors.push(error);
      if (pending === 0 && launchedCount === launchers.length) {
        finish();
        return;
      }
      maybeLaunchNext(index);
    };

    const launchNext = () => {
      if (done || launchedCount >= launchers.length) return;
      const index = launchedCount;
      launchedCount += 1;
      pending += 1;
      let task: Promise<T>;
      try {
        task = launchers[index]();
      } catch (error) {
        task = Promise.reject(error);
      }
      task.then(
        (value) => onValue(index, value),
        (error) => onError(index, error),
      );
      if (index + 1 < launchers.length) {
        setTimeout(() => maybeLaunchNext(index), effectiveStaggerMs);
      }
    };

    const deadlineTimer = options.deadlineMs == null
      ? null
      : setTimeout(() => {
          if (done) return;
          errors.push(new Error(`等待候选超出本轮时间预算(${options.deadlineMs}ms)`));
          finish();
        }, options.deadlineMs);

    launchNext();
  });
}
