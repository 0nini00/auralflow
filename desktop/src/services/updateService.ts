import { fetch } from "@tauri-apps/plugin-http";
import { getVersion } from "@tauri-apps/api/app";

const UPDATE_CHECK_REPO = "chenle/auralflow";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
}

/** 简单 semver 比较：返回 a < b */
function semverLess(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return true;
    if (da > db) return false;
  }
  return false;
}

/**
 * 检查更新：读取应用自己的 GitHub Releases latest。
 * 返回 null 表示无更新或出错。
 */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  let currentVersion = "0.0.0";
  try {
    currentVersion = await getVersion();
  } catch {
    // getVersion 在某些环境失败，退回低版本号
  }

  try {
    const resp = await fetch(`https://api.github.com/repos/${UPDATE_CHECK_REPO}/releases/latest`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AuralFlow-UpdateCheck",
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      tag_name?: string;
      html_url?: string;
      name?: string;
    };
    const latest = (data.tag_name ?? "").replace(/^v/, "");
    if (!latest) return null;
    if (!semverLess(currentVersion, latest)) return null;

    return {
      currentVersion,
      latestVersion: latest,
      releaseUrl: data.html_url ?? `https://github.com/${UPDATE_CHECK_REPO}/releases/latest`,
      releaseName: data.name ?? latest,
    };
  } catch (err) {
    console.warn("[update] 检查失败", err);
    return null;
  }
}
