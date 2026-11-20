import { parseDesktopUserApiInfo, type DesktopUserApiHeaderInfo } from "./script-header";

/**
 * 自定义源的数据模型与纯状态变换。
 *
 * 两端 store 的持久化方式不同（桌面走 library 命名空间，移动端走 AsyncStorage），
 * 但条目形状、读盘归一化与「瞬态不落盘」是同一套规则：WebDAV 在两端之间同步的
 * 正是这些条目，规则分叉会让一端写出的数据在另一端被解释成别的状态。
 */
export type CustomSourceTestStatus = "idle" | "testing" | "ok" | "failed";
export type CustomSourceUpdateStatus = "idle" | "checking" | "latest" | "available" | "failed";

export interface CustomSourceSourceInfo {
  type: "music";
  actions: string[];
  qualitys: string[];
}

export interface CustomSourceItem {
  id: string;
  name: string;
  description: string;
  script: string;
  enabled: boolean;
  allowShowUpdateAlert: boolean;
  author?: string;
  homepage?: string;
  version?: string;
  sources?: Record<string, CustomSourceSourceInfo>;
  testStatus: CustomSourceTestStatus;
  testMessage?: string;
  updateStatus?: CustomSourceUpdateStatus;
  updateMessage?: string;
  updateLog?: string;
  updateUrl?: string;
  updateCheckedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** 未初始化的能力保持待定；已有声明时只调度当前平台真正支持的取链档位。 */
export function getCustomSourcePlaybackQualities(
  source: Pick<CustomSourceItem, "sources">,
  platform: string,
  requested: readonly string[],
): string[] {
  if (source.sources === undefined) return [...requested];
  const capability = source.sources[platform];
  if (!capability?.actions.includes("musicUrl")) return [];
  return capability.qualitys.length
    ? requested.filter(quality => capability.qualitys.includes(quality))
    : [...requested];
}

/** 脚本经 `updateAlert` 事件或远端比对得出的更新提示。 */
export interface CustomSourceUpdateAlert {
  log: string;
  updateUrl?: string;
}

/** 远端更新检查节流间隔：同一源距上次远端检查不足 24 小时不再重复拉取。 */
export const CUSTOM_SOURCE_REMOTE_CHECK_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 新导入条目的 id：`user_api_<随机段>_<毫秒时间戳>`。
 * id 同时是运行时缓存与更新检查去重的键，随机段取 8 位 base36，足以区分同一毫秒内的多次导入。
 */
export function createCustomSourceId(random: () => number = Math.random): string {
  return `user_api_${random().toString(36).slice(2, 10)}_${Date.now()}`;
}

/** 按 id 打补丁并刷新 `updatedAt`；返回新数组，不修改入参。 */
export function patchCustomSource(
  sources: CustomSourceItem[],
  id: string,
  patch: Partial<CustomSourceItem>,
): CustomSourceItem[] {
  return sources.map((source) =>
    source.id === id ? { ...source, ...patch, updatedAt: Date.now() } : source,
  );
}

/** 一次更新检查的结果补丁：无提示即「已是最新」，并清掉上一次留下的提示字段。 */
export function buildCustomSourceUpdatePatch(
  updateAlert?: CustomSourceUpdateAlert,
): Partial<CustomSourceItem> {
  const updateCheckedAt = Date.now();
  if (!updateAlert) {
    return {
      updateStatus: "latest",
      updateMessage: undefined,
      updateLog: undefined,
      updateUrl: undefined,
      updateCheckedAt,
    };
  }
  return {
    updateStatus: "available",
    updateMessage: "发现更新",
    updateLog: updateAlert.log,
    updateUrl: updateAlert.updateUrl,
    updateCheckedAt,
  };
}

function mergeHeaderInfo(source: CustomSourceItem): CustomSourceItem {
  let info: DesktopUserApiHeaderInfo;
  try {
    info = parseDesktopUserApiInfo(source.script);
  } catch {
    // 头部无法解析的历史条目保留原字段：读盘归一化不能因为一条坏脚本丢掉整份列表。
    return source;
  }

  return {
    ...source,
    name: info.name || source.name,
    description: info.description || source.description,
    author: info.author || undefined,
    homepage: info.homepage || undefined,
    version: info.version || undefined,
  };
}

/**
 * 读盘 / 云端替换时的归一化：以脚本头部为准重算展示字段，
 * 并把上次进程遗留的进行中状态（testing / checking）复位成 idle。
 */
export function normalizeCustomSourceForStore(source: CustomSourceItem): CustomSourceItem {
  const normalized = mergeHeaderInfo(source);
  return {
    ...normalized,
    testStatus:
      normalized.testStatus === "testing" ? "idle" : normalized.testStatus ?? "idle",
    testMessage: normalized.testStatus === "testing" ? undefined : normalized.testMessage,
    updateStatus:
      normalized.updateStatus === "checking" ? "idle" : normalized.updateStatus ?? "idle",
    updateMessage: normalized.updateStatus === "checking" ? undefined : normalized.updateMessage,
    allowShowUpdateAlert: normalized.allowShowUpdateAlert ?? true,
  };
}

/**
 * 写盘前剔除瞬态：测试结果不落盘，进行中的更新检查落盘为 idle。
 * 已得出结论的更新状态（latest / available / failed）保留，供下次启动节流判断。
 */
export function stripCustomSourceTransientState(sources: CustomSourceItem[]): CustomSourceItem[] {
  return sources.map((source) => ({
    ...source,
    testStatus: "idle",
    testMessage: undefined,
    updateStatus: source.updateStatus === "checking" ? "idle" : source.updateStatus,
    updateMessage: source.updateStatus === "checking" ? undefined : source.updateMessage,
  }));
}
