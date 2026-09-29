/**
 * 桌面端应用更新：检查 + 应用内安装。
 *
 * 走 Tauri 官方 updater 插件（Rust 侧）：检查与下载都读 GitHub Releases 上的静态
 * 清单 `latest.json`（地址见 `tauri.conf.json` 的 `plugins.updater.endpoints`），
 * 安装包签名由插件强制校验，**无法关闭**。
 *
 * 与旧实现的差别：旧版只拿 `api.github.com/repos/.../releases/latest` 比版本号，
 * 然后把用户丢到浏览器手动下载；且任何失败都 `return null`，与「已是最新」不可
 * 区分。现在结果分三态，失败就是失败。
 */

import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";

/** 兜底跳转用：发布页 tag 地址 */
const RELEASE_TAG_BASE = "https://github.com/0nini00/auralflow/releases/tag/v";

export interface UpdateAvailable {
  kind: "available";
  currentVersion: string;
  latestVersion: string;
  /** 发布说明（latest.json 的 notes），可能是空串 */
  notes: string;
  /** 发布日期（RFC 3339），可能缺失 */
  date: string | null;
  /** 更新器不可用时的兜底入口 */
  releaseUrl: string;
}

export interface UpdateUpToDate {
  kind: "latest";
  currentVersion: string;
}

export interface UpdateCheckFailed {
  kind: "failed";
  currentVersion: string;
  reason: string;
}

export type UpdateCheckResult = UpdateAvailable | UpdateUpToDate | UpdateCheckFailed;

export interface UpdateProgress {
  downloaded: number;
  /** null 表示服务端没给 Content-Length */
  total: number | null;
  /** 下载与验签已完成，接下来把控制权交给安装器 */
  readyToInstall: boolean;
}

/** 已检出、等待用户确认安装的更新；`installPendingUpdate` 消费它 */
let pendingUpdate: Update | null = null;

async function readCurrentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    // 拿不到版本不当作致命：插件自己会把 current_version 报给清单
    return "";
  }
}

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (!raw) return "未知错误";
  // 清单缺失 / 签名不通过时插件抛的是原文，原样透出比吞成「检查失败」有用
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}

/**
 * 检查更新。永不抛错——失败作为 `kind: "failed"` 返回，由调用方决定怎么显示。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = await readCurrentVersion();
  try {
    const update = await check();
    if (!update) {
      pendingUpdate = null;
      return { kind: "latest", currentVersion };
    }
    pendingUpdate = update;
    return {
      kind: "available",
      currentVersion: currentVersion || update.currentVersion,
      latestVersion: update.version,
      notes: (update.body ?? "").trim(),
      date: update.date ?? null,
      releaseUrl: `${RELEASE_TAG_BASE}${update.version}`,
    };
  } catch (error) {
    pendingUpdate = null;
    return { kind: "failed", currentVersion, reason: describeError(error) };
  }
}

/**
 * 下载并安装已检出的更新（进度经回调上报）。
 *
 * ⚠️ Windows 上这个 Promise **通常不会正常返回**：插件调起安装器后立即
 * `std::process::exit(0)`（见 tauri-plugin-updater 的 updater.rs），随后 NSIS
 * 安装器以 passive 模式静默装完，并把应用重新拉起来。所以调用方必须先把
 * 「安装中」当成终态画出来，不要指望拿到返回值再更新界面。
 *
 * 调用前请先落盘未保存的持久化数据（Rust 侧 exit(0) 不会走 JS 的 pagehide）。
 */
export async function installPendingUpdate(
  onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
  if (!pendingUpdate) throw new Error("没有待安装的更新，请先检查更新");
  let downloaded = 0;
  let total: number | null = null;
  await pendingUpdate.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress({ downloaded: 0, total, readyToInstall: false });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({ downloaded, total, readyToInstall: false });
        break;
      case "Finished":
        onProgress({ downloaded, total, readyToInstall: true });
        break;
      default:
        break;
    }
  });
}
