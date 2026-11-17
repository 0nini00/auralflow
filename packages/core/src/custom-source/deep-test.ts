import { matchHiddenCandidates, type HiddenSourceSearcher } from "../hidden-source";
import type { MusicInfo } from "../sources/types";
import type { CustomSourceSourceInfo, CustomSourceUpdateAlert } from "./model";
import type { CustomSourcePlatformRequest, CustomSourceRuntimeInitResult } from "./runtime-protocol";

/**
 * 自定义源深度测试：真实取链。
 *
 * 初始化通过不代表脚本真的能取到播放地址（假阳性），这里用内置固定测试曲对脚本
 * 声明的每个平台走一次真实 musicUrl 请求，验证端到端可用性。
 *
 * 脚本的启动、运行时缓存与取消属于两端宿主；本模块只编排第二阶段——测哪些平台、
 * 预算怎么分、结果怎么汇总——搜索、取链与超时守卫一律由调用方注入。
 */

const DEEP_TEST_TIMEOUT_MS = 20_000;
const DEEP_TEST_SEARCH_TIMEOUT_MS = 6_000;
const DEEP_TEST_PLATFORM_BUDGET_MS = 25_000;
const DEEP_TEST_MIN_PLATFORM_BUDGET_MS = 5_000;
const DEEP_TEST_TOTAL_BUDGET_MS = 60_000;
const DEEP_TEST_QUALITY = "128k";

/** 内置固定测试曲（id 均为公开常驻曲目，可按需替换）：
 *  - wy：2034742057 林俊杰-江南（备选 1492167768）
 *  - tx：songmid 0039MnYb0qxYhV
 *  - kw/kg：用隐藏音源搜索按名找同曲，不依赖固定 id
 */
const DEEP_TEST_TRACKS: Record<"wy" | "tx", { id: string; name: string; singer: string; albumName: string }> = {
  wy: { id: "2034742057", name: "江南", singer: "林俊杰", albumName: "第二天堂" },
  tx: { id: "0039MnYb0qxYhV", name: "江南", singer: "林俊杰", albumName: "第二天堂" },
};

/** 深度测试固定曲目：与固定 wy/tx 曲目同一首歌，用于按平台搜索。 */
const DEEP_TEST_SONG = { name: "江南", singer: "林俊杰", albumName: "第二天堂", interval: 267 };

/** 脚本声明了 musicUrl 的平台逐个测试；不在这里枚举的平台不参与。 */
export const CUSTOM_SOURCE_DEEP_TEST_PLATFORMS = ["wy", "tx", "kw", "kg"] as const;
export type CustomSourceDeepTestPlatform = (typeof CUSTOM_SOURCE_DEEP_TEST_PLATFORMS)[number];

export interface CustomSourceDeepTestTarget {
  platform: CustomSourceDeepTestPlatform;
  music: MusicInfo;
  platformRequest?: CustomSourcePlatformRequest;
}

/** 取链测试结果，结构兼容初始化测试的返回，ok 表示两阶段全部通过 */
export interface CustomSourceDeepTestResult {
  ok: boolean;
  message: string;
  sources?: Record<string, CustomSourceSourceInfo>;
  updateAlert?: CustomSourceUpdateAlert;
}

/**
 * 超时守卫：超时以 `${label}超时（Nms）` 拒绝，原任务的成败原样透传。
 * 定时器不属于 ECMAScript 标准库，由两端各自提供实现。
 */
export type CustomSourceTimeoutGuard = <T>(task: Promise<T>, timeoutMs: number, label: string) => Promise<T>;

export interface CustomSourceDeepTestDeps {
  /** kw/kg 的原生搜索实现；wy/tx 用固定曲目，不经过搜索。 */
  searchers: readonly HiddenSourceSearcher[];
  withTimeout: CustomSourceTimeoutGuard;
  /** 用被测脚本对一首测试曲取链；失败抛错。 */
  requestMusicUrl: (
    target: CustomSourceDeepTestTarget,
    quality: string,
  ) => Promise<{ url: string; quality: string }>;
  /**
   * 生命周期闸门：调用方的操作已被取消时抛错。每个异步步骤之后都会调用，
   * 让取消原样抛出，而不是被记成某个平台「测试失败」。没有取消语义的一端不传。
   */
  assertActive?: () => void;
}

/** 无需取链即可下结论时给出 verdict；否则 platforms 是待测平台（按固定顺序）。 */
export interface CustomSourceDeepTestPlan {
  platforms: CustomSourceDeepTestPlatform[];
  verdict: CustomSourceDeepTestResult | null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compactTestDetail(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}...` : trimmed;
}

/** 第一阶段（脚本初始化）失败时的测试结果。 */
export function buildCustomSourceDeepTestInitFailure(error: unknown): CustomSourceDeepTestResult {
  return {
    ok: false,
    message: `初始化失败：${describeError(error)}`,
    sources: undefined,
    updateAlert: undefined,
  };
}

/**
 * 根据初始化结果决定第二阶段测什么：脚本声明了哪些平台就逐个测哪些（wy/tx/kw/kg）。
 * 没有声明 musicUrl 只验证初始化；声明的平台都不在覆盖范围内则判为未通过。
 */
export function planCustomSourceDeepTest(initResult: CustomSourceRuntimeInitResult): CustomSourceDeepTestPlan {
  const sources = initResult.sources ?? {};
  const declaredPlatforms = Object.keys(sources).filter((id) => sources[id]?.actions.includes("musicUrl"));
  if (declaredPlatforms.length === 0) {
    return {
      platforms: [],
      verdict: {
        ok: true,
        message: "初始化正常；未声明 musicUrl，仅验证初始化",
        sources,
        updateAlert: initResult.updateAlert,
      },
    };
  }
  const platforms = CUSTOM_SOURCE_DEEP_TEST_PLATFORMS.filter((name) => declaredPlatforms.includes(name));
  if (platforms.length === 0) {
    return {
      platforms: [],
      verdict: {
        ok: false,
        message: `初始化正常；脚本只声明了 ${declaredPlatforms.join("/")}，当前深度测试仅覆盖 wy/tx/kw/kg`,
        sources,
        updateAlert: initResult.updateAlert,
      },
    };
  }
  return { platforms, verdict: null };
}

/** 为平台准备测试曲：wy/tx 用固定 id；kw/kg 先原生搜索同曲，再取平台元数据。 */
export async function buildCustomSourceDeepTestTarget(
  platform: CustomSourceDeepTestPlatform,
  deps: Pick<CustomSourceDeepTestDeps, "searchers" | "withTimeout">,
  searchTimeoutMs = DEEP_TEST_SEARCH_TIMEOUT_MS,
): Promise<CustomSourceDeepTestTarget> {
  if (platform === "wy" || platform === "tx") {
    const track = DEEP_TEST_TRACKS[platform];
    return {
      platform,
      music: {
        id: track.id,
        name: track.name,
        singer: track.singer,
        albumName: track.albumName,
        source: platform,
      },
    };
  }

  const searcher = deps.searchers.find((item) => item.id === platform);
  if (!searcher) throw new Error("该平台没有可用的搜索实现");
  const tracks = await deps.withTimeout(
    searcher.search(`${DEEP_TEST_SONG.name} ${DEEP_TEST_SONG.singer}`),
    searchTimeoutMs,
    "搜索测试曲目",
  );
  const track = matchHiddenCandidates(DEEP_TEST_SONG, tracks)[0];
  if (!track) throw new Error("未在平台搜到匹配的测试曲目");

  return {
    platform,
    // MusicInfo.source 是 UI 来源，这里只是占位；真正的平台来源由 platformRequest 透传。
    music: {
      id: track.id,
      name: track.name,
      singer: track.singer,
      albumName: track.albumName ?? DEEP_TEST_SONG.albumName,
      source: "tx",
      interval: track.interval,
      picUrl: track.picUrl,
    },
    platformRequest: {
      source: platform,
      songmid: track.id,
      interval: track.interval,
      albumName: track.albumName,
      picUrl: track.picUrl,
      extra: track.extra,
    },
  };
}

/**
 * 第二阶段：对 platforms 逐个取链并汇总。
 *
 * `passed` 单独返回，供调用方决定运行时去留（全部失败才丢弃，有任一平台通过就
 * 保留，避免下次播放重新初始化）。
 */
export async function runCustomSourceDeepTestPlatforms(
  initResult: CustomSourceRuntimeInitResult,
  platforms: readonly CustomSourceDeepTestPlatform[],
  deps: CustomSourceDeepTestDeps,
): Promise<{ passed: number; result: CustomSourceDeepTestResult }> {
  const sources = initResult.sources ?? {};
  const startedAt = Date.now();
  const results: Array<{ platform: CustomSourceDeepTestPlatform; ok: boolean; detail: string }> = [];

  for (let index = 0; index < platforms.length; index += 1) {
    const platform = platforms[index];
    const remaining = DEEP_TEST_TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 0) {
      results.push({ platform, ok: false, detail: "未测试（总预算耗尽）" });
      continue;
    }

    // 总预算按剩余平台均摊：慢平台不能吃掉后面所有平台的测试机会。
    const platformsLeft = platforms.length - index;
    const platformBudget = Math.min(
      remaining,
      Math.max(
        DEEP_TEST_MIN_PLATFORM_BUDGET_MS,
        Math.min(DEEP_TEST_PLATFORM_BUDGET_MS, Math.floor(remaining / platformsLeft)),
      ),
    );
    const platformStartedAt = Date.now();

    // quality 兼容：128k 不在脚本声明白名单时退回声明的最低音质
    const declared = sources[platform]?.qualitys ?? [];
    const quality = declared.includes(DEEP_TEST_QUALITY) ? DEEP_TEST_QUALITY : declared[0] ?? DEEP_TEST_QUALITY;

    let target: CustomSourceDeepTestTarget;
    try {
      target = await buildCustomSourceDeepTestTarget(
        platform,
        deps,
        Math.min(DEEP_TEST_SEARCH_TIMEOUT_MS, platformBudget),
      );
      deps.assertActive?.();
    } catch (error) {
      deps.assertActive?.();
      results.push({
        platform,
        ok: false,
        detail: `搜索测试曲目失败：${compactTestDetail(describeError(error))}`,
      });
      continue;
    }

    try {
      const chainBudget = Math.min(
        DEEP_TEST_TIMEOUT_MS,
        platformBudget - (Date.now() - platformStartedAt),
      );
      if (chainBudget <= 0) throw new Error("总预算耗尽");
      const result = await deps.withTimeout(deps.requestMusicUrl(target, quality), chainBudget, "取链测试");
      deps.assertActive?.();
      if (!/^https?:\/\//.test(result.url)) throw new Error(`未返回可播放 URL：${result.url.slice(0, 128)}`);
      results.push({ platform, ok: true, detail: `${result.quality || quality}` });
    } catch (error) {
      // 生命周期失效要抛出，而不是伪装成「测试失败」。
      deps.assertActive?.();
      results.push({
        platform,
        ok: false,
        detail: `取链失败：${compactTestDetail(describeError(error))}`,
      });
    }
  }

  deps.assertActive?.();
  const passed = results.filter((item) => item.ok).length;
  const summary = results
    .map((item) => `${item.platform} ${item.ok ? "通过" : "失败"}:${item.detail}`)
    .join("；");
  return {
    passed,
    result: {
      ok: passed === results.length,
      message: `初始化正常；取链测试 ${passed}/${results.length} 通过（${summary}）`,
      sources,
      updateAlert: initResult.updateAlert,
    },
  };
}
