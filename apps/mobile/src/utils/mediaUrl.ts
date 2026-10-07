const MAX_URL_PORT = 65535;

export function isHttpMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || /[\s\u0000-\u001f\u007f\\]/.test(value)) return false;
  // RN 的 URL 构造器不完整校验 authority，且凭证 getter 会误读路径里的 @。
  // 先限定原始 authority，禁止 userinfo；不限制主机，也不改写返回地址。
  const match = /^https?:\/\/(\[[0-9a-f:.]+\]|[^/?#:@[\]\\\s<>^|%]+)(?::(\d+))?(?:[/?#]|$)/i.exec(value);
  if (!match || (match[2] !== undefined && Number(match[2]) > MAX_URL_PORT)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

