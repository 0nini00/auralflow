export function normalizeCustomSourceScript(script: string): string {
  return script.replace(/\r\n?/g, "\n").trim();
}

export function normalizeCustomSourceVersion(value?: string): string {
  return (value ?? "").trim().replace(/^v/i, "");
}

export function compareCustomSourceVersions(left?: string, right?: string): number {
  const leftParts = normalizeCustomSourceVersion(left)
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const rightParts = normalizeCustomSourceVersion(right)
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const size = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < size; index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

export function normalizeCustomSourceRemoteUrl(url: string): string {
  const parsed = new URL(url);

  if (parsed.hostname === "github.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const markerIndex = parts.findIndex((part) => part === "blob" || part === "raw");
    if (parts.length >= 5 && markerIndex === 2) {
      const [owner, repo, , branch, ...filePath] = parts;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath.join("/")}${parsed.search}`;
    }
  }

  if (parsed.hostname === "gitee.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const markerIndex = parts.findIndex((part) => part === "blob");
    if (parts.length >= 5 && markerIndex === 2) {
      const [owner, repo, , branch, ...filePath] = parts;
      return `https://gitee.com/${owner}/${repo}/raw/${branch}/${filePath.join("/")}${parsed.search}${parsed.hash}`;
    }
  }

  return parsed.toString();
}

export function isLikelyCustomSourceRemoteUrl(url: string): boolean {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  if (/\.(?:js|txt)(?:$|[?#])/.test(`${pathname}${parsed.search}${parsed.hash}`)) return true;
  if (parsed.hostname === "raw.githubusercontent.com") return true;
  if (parsed.hostname === "github.com" || parsed.hostname === "gitee.com") {
    return pathname.includes("/raw/") || pathname.includes("/blob/");
  }
  return false;
}
