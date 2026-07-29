const BILI_IMAGE_HOSTS = ["biliimg.com", "hdslb.com"];

function isBiliImageHost(host: string): boolean {
  return BILI_IMAGE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function normalizeImageUrl(src?: string | null): string {
  const value = src?.trim() ?? "";
  if (!value) return "";

  const normalized = value.startsWith("//") ? `https:${value}` : value;
  try {
    const url = new URL(normalized);
    if (isBiliImageHost(url.hostname) && url.protocol === "http:") {
      url.protocol = "https:";
    }
    return url.toString();
  } catch {
    return normalized;
  }
}

export function getImageReferrerPolicy(src?: string | null): ReferrerPolicy | undefined {
  if (!src) return undefined;
  try {
    const host = new URL(normalizeImageUrl(src), "https://placeholder.local").hostname;
    return isBiliImageHost(host) ? "no-referrer" : undefined;
  } catch {
    return undefined;
  }
}
