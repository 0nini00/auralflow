/** CDN 探活、播放和深度测试使用同一组防盗链请求头。 */
export const STREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function buildStreamHeaders(source: string | undefined): Record<string, string> | undefined {
  const referer = source === "wy" ? "https://music.163.com" : source === "tx" ? "https://y.qq.com" : undefined;
  return referer ? { Referer: referer, "User-Agent": STREAM_USER_AGENT } : undefined;
}
