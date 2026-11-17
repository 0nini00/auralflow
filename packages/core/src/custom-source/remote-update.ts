import type { CustomSourceItem, CustomSourceUpdateAlert } from "./model";
import {
  compareCustomSourceVersions,
  isLikelyCustomSourceRemoteUrl,
  normalizeCustomSourceRemoteUrl,
  normalizeCustomSourceScript,
  normalizeCustomSourceVersion,
} from "./remote-script";
import { parseDesktopUserApiInfo } from "./script-header";

/**
 * 远端脚本更新检查：拿 homepage 指向的远端脚本与本地脚本比对版本与内容。
 *
 * 取脚本是 IO，由两端注入（桌面经 Rust 出站代理并带取消令牌，移动端走带超时的
 * RN fetch 与出站校验）；这里只负责「去哪取、取回来算不算有更新」。
 */

/** 拉取远端脚本时的 Accept 头：脚本托管站多以 text/plain 或 application/javascript 回包。 */
export const CUSTOM_SOURCE_REMOTE_SCRIPT_ACCEPT = "text/plain,application/javascript,*/*";

/** 两端 HTTP 响应对象的公共子集（Tauri 出站代理的响应与 RN 的 Response 都满足）。 */
export interface CustomSourceRemoteScriptResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

/** 远端脚本拉取函数：成功返回脚本正文，失败抛错。 */
export type FetchCustomSourceRemoteScript = (url: string) => Promise<string>;

/** homepage 是可直接下载的脚本地址时返回归一化后的地址，否则返回 null（不做远端检查）。 */
export function getCustomSourceRemoteScriptUrl(api: Pick<CustomSourceItem, "homepage">): string | null {
  const candidate = api.homepage?.trim();
  if (!candidate || !/^https?:\/\//.test(candidate)) return null;
  try {
    const normalized = normalizeCustomSourceRemoteUrl(candidate);
    return isLikelyCustomSourceRemoteUrl(normalized) ? normalized : null;
  } catch {
    // 无法解析成 URL 的 homepage 只是「没有远端地址」，不算更新检查失败。
    return null;
  }
}

/** 校验远端脚本响应并取出正文：非 2xx 与空正文都视为失败。 */
export async function readCustomSourceRemoteScript(
  response: CustomSourceRemoteScriptResponse,
): Promise<string> {
  if (!response.ok) {
    throw new Error(`远端音源请求失败：HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  if (!text.trim()) throw new Error("远端音源脚本为空");
  return text;
}

/**
 * 比对远端脚本，得出更新提示；没有远端地址或没有更新时返回 undefined。
 *
 * 两边都有版本号时只认版本号（远端更高才算更新）；任一边缺版本号时退回比对
 * 归一化后的脚本正文。
 */
export async function checkCustomSourceRemoteUpdate(
  api: Pick<CustomSourceItem, "homepage" | "script" | "version">,
  fetchRemoteScript: FetchCustomSourceRemoteScript,
): Promise<CustomSourceUpdateAlert | undefined> {
  const updateUrl = getCustomSourceRemoteScriptUrl(api);
  if (!updateUrl) return undefined;

  const remoteScript = await fetchRemoteScript(updateUrl);
  const localInfo = parseDesktopUserApiInfo(api.script);
  const remoteInfo = parseDesktopUserApiInfo(remoteScript);
  const localVersion = normalizeCustomSourceVersion(api.version || localInfo.version);
  const remoteVersion = normalizeCustomSourceVersion(remoteInfo.version);
  const hasScriptChanged = normalizeCustomSourceScript(remoteScript) !== normalizeCustomSourceScript(api.script);

  if (remoteVersion && localVersion) {
    if (compareCustomSourceVersions(remoteVersion, localVersion) <= 0) return undefined;
    return {
      log: `发现新版本：v${localVersion} -> v${remoteVersion}`,
      updateUrl,
    };
  }
  if (!remoteVersion && !hasScriptChanged) return undefined;
  if (hasScriptChanged) {
    return {
      log: remoteVersion
        ? `远端脚本内容已更新，当前版本 v${localVersion || "未知"}，远端版本 v${remoteVersion}`
        : "远端脚本内容已更新",
      updateUrl,
    };
  }
  return undefined;
}
