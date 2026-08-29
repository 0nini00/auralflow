/**
 * 移动端应用更新检查服务。
 *
 * 检查 GitHub Releases 是否有新版本，供 UpdateModal 展示。
 */

import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import { CURRENT_VERSION } from "./mobileVersion";

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  changelog: string;
  /** Release 里的 APK 安装包资产（已过滤 exe/msi 等桌面端产物） */
  apkAssets: ApkAsset[];
}

export interface ApkAsset {
  name: string;
  url: string;
  /** 字节数 */
  size: number;
}

const REPO_API = "https://api.github.com/repos/0nini00/auralflow/releases/latest";
export { CURRENT_VERSION } from "./mobileVersion";

interface GithubAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

/** 从 Release 资产里挑出与设备 ABI 匹配的 APK（abis 按系统偏好顺序） */
export function pickApkAssetForDevice(assets: ApkAsset[], abis: string[]): ApkAsset | null {
  if (assets.length === 0) return null;
  for (const abi of abis) {
    const match = assets.find((asset) => asset.name.toLowerCase().includes(abi.toLowerCase()));
    if (match) return match;
  }
  return assets[0] ?? null;
}

function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/^v/, "").split(".").map((seg) => parseInt(seg, 10) || 0);
  const partsB = b.replace(/^v/, "").split(".").map((seg) => parseInt(seg, 10) || 0);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const resp = await fetchWithTimeout(REPO_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "AuralFlowMobile/0.1",
    },
  });
  if (!resp.ok) throw new Error(`检查更新失败，请稍后重试`);
  const data = await resp.json() as Record<string, unknown>;
  const tagName = String(data.tag_name ?? "");
  const htmlUrl = String(data.html_url ?? `https://github.com/0nini00/auralflow/releases/latest`);
  const releaseName = String(data.name ?? tagName);
  const body = String(data.body ?? "");
  if (!tagName) throw new Error("检查更新失败: GitHub Releases 缺少版本号");
  const rawAssets = Array.isArray(data.assets) ? (data.assets as GithubAsset[]) : [];
  const apkAssets: ApkAsset[] = rawAssets
    .map((asset) => ({
      name: String(asset.name ?? ""),
      url: String(asset.browser_download_url ?? ""),
      size: typeof asset.size === "number" ? asset.size : 0,
    }))
    .filter((asset) => asset.name.toLowerCase().endsWith(".apk") && asset.url);
  const hasUpdate = compareVersions(tagName, CURRENT_VERSION) > 0;
  return {
    hasUpdate,
    currentVersion: CURRENT_VERSION,
    latestVersion: tagName,
    releaseUrl: htmlUrl,
    releaseName,
    changelog: body.slice(0, 500),
    apkAssets,
  };
}
