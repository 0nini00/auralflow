/** wy/tx 音源 CDN 防盗链请求头：缺 Referer 时 CDN 直接返回 403。 */
const STREAM_REFERERS: Record<string, string> = {
  wy: 'https://music.163.com',
  tx: 'https://y.qq.com',
};

/**
 * 与移动端 buildStreamHeaders 同语义。
 *
 * 独立成模块是因为竞速层（customSourceBackend）与编排层（playbackResolver）
 * 都需要在探活时带上同一组头；放在 playbackResolver 里会让 backend 反向依赖
 * 编排层，形成循环。
 */
export function buildStreamHeaders(source: string | undefined): Record<string, string> | undefined {
  const referer = source ? STREAM_REFERERS[source] : undefined;
  if (!referer) return undefined;
  return { Referer: referer };
}
