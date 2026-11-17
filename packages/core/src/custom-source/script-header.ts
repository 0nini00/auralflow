/**
 * LX Music 自定义源脚本的头部注释解析。
 *
 * 脚本以一段块注释开头，逐行 `@name` / `@description` / `@author` / `@homepage` / `@version`。
 * 两端导入、读盘归一化、WebDAV 同步与远端更新检查都依赖同一份解析结果，
 * 因此截断长度与版本号提取规则只在这里定义。
 */
export interface DesktopUserApiHeaderInfo {
  name: string;
  description: string;
  author: string;
  homepage: string;
  version: string;
}

const INFO_LIMITS: Record<keyof DesktopUserApiHeaderInfo, number> = {
  name: 24,
  description: 36,
  author: 56,
  homepage: 1024,
  version: 36,
};

function normalizeHeaderValue(key: keyof DesktopUserApiHeaderInfo, value: string): string {
  const trimmed = value.trim();
  if (key === "version") {
    const version = trimmed.match(/v?\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?/)?.[0];
    if (version) return version;
  }
  const limit = INFO_LIMITS[key];
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

export function parseDesktopUserApiInfo(script: string): DesktopUserApiHeaderInfo {
  const block = /^\/\*[\s\S]+?\*\//.exec(script)?.[0];
  if (!block) throw new Error("无效的自定义源文件：缺少 LX Music 头部注释");

  const result: DesktopUserApiHeaderInfo = {
    name: "",
    description: "",
    author: "",
    homepage: "",
    version: "",
  };
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/;
  for (const line of block.split(/\r?\n/)) {
    const match = rxp.exec(line);
    if (!match) continue;
    const key = match[1] as keyof DesktopUserApiHeaderInfo;
    if (!(key in INFO_LIMITS)) continue;
    result[key] = normalizeHeaderValue(key, match[2]);
  }
  result.name ||= `user_api_${new Date().toLocaleString()}`;
  return result;
}
