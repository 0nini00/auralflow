/**
 * 出站请求的主机判定规则 —— 双端共用的书面定义。
 *
 * 桌面端在 Rust 侧执行同一套规则（`desktop/src-tauri/src/outbound.rs`），
 * 因为请求由 Rust 发出；移动端请求在 JS 侧发出，直接用本模块。
 * 两份实现各自带测试，规则变更时必须同步。
 *
 * 边界（显式声明）：
 *   - 只允许 http / https；
 *   - 拒绝 localhost、`.localhost`、`.local` 域名；
 *   - 拒绝字面量的回环 / 私有 / 链路本地 / CGNAT / 未指定 / 多播 / 广播 /
 *     文档示例地址，IPv4-mapped IPv6 与纯数字 IPv4 会先还原再判定；
 *   - **不做** DNS 解析后校验，解析到内网的域名（DNS rebinding）不在拦截范围。
 */

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isBlockedIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 未指定
  if (a === 127) return true; // 回环
  if (a === 10) return true; // 私有
  if (a === 172 && b >= 16 && b <= 31) return true; // 私有
  if (a === 192 && b === 168) return true; // 私有
  if (a === 169 && b === 254) return true; // 链路本地（含云元数据 169.254.169.254）
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 文档示例
  if (a === 198 && (b === 18 || b === 19)) return true; // 基准测试网段
  if (a === 198 && b === 51) return true; // 198.51.100.0/24 文档示例
  if (a === 203 && b === 0) return true; // 203.0.113.0/24 文档示例
  if (a >= 224) return true; // 多播 224/4 与保留段 240/4（含广播 255.255.255.255）
  return false;
}

function parseIpv4(host: string): number[] | null {
  const match = IPV4_PATTERN.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map((part) => Number.parseInt(part, 10));
  return octets.every((value) => value >= 0 && value <= 255) ? octets : null;
}

/**
 * WHATWG URL 会把 `http://2130706433/` 规范化成 127.0.0.1，但 RN 的 URL polyfill
 * 不保证这么做，这里补上纯数字主机名的还原。
 */
function parseNumericIpv4(host: string): number[] | null {
  if (!/^\d+$/.test(host)) return null;
  const value = Number(host);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** 把 IPv6 字面量展开成 8 组 16 位；无法解析时返回 null。 */
function parseIpv6(host: string): number[] | null {
  let text = host;
  let tailV4: number[] | null = null;

  // `::ffff:127.0.0.1` 这类尾部带点分 IPv4 的写法
  const lastColon = text.lastIndexOf(":");
  const tail = lastColon >= 0 ? text.slice(lastColon + 1) : "";
  if (tail.includes(".")) {
    tailV4 = parseIpv4(tail);
    if (!tailV4) return null;
    text = text.slice(0, lastColon + 1);
    text += `${((tailV4[0] << 8) | tailV4[1]).toString(16)}:${((tailV4[2] << 8) | tailV4[3]).toString(16)}`;
  }

  const doubleColonCount = text.split("::").length - 1;
  if (doubleColonCount > 1) return null;

  let groups: string[];
  if (doubleColonCount === 1) {
    const [head, rest] = text.split("::");
    const headGroups = head ? head.split(":") : [];
    const tailGroups = rest ? rest.split(":") : [];
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 0) return null;
    groups = [...headGroups, ...Array(fill).fill("0"), ...tailGroups];
  } else {
    groups = text.split(":");
  }

  if (groups.length !== 8) return null;
  const parsed = groups.map((group) => Number.parseInt(group || "0", 16));
  return parsed.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff)
    ? parsed
    : null;
}

function isBlockedIpv6(groups: number[]): boolean {
  const isZeroPrefix = groups.slice(0, 7).every((value) => value === 0);
  if (isZeroPrefix && groups[7] === 1) return true; // ::1 回环
  if (groups.every((value) => value === 0)) return true; // :: 未指定
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 多播

  // IPv4-mapped（::ffff:a.b.c.d）与已废弃的 IPv4-compatible（::a.b.c.d）
  const isMapped = groups.slice(0, 5).every((value) => value === 0) && groups[5] === 0xffff;
  const isCompat = groups.slice(0, 6).every((value) => value === 0);
  if (isMapped || isCompat) {
    const octets = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
    return isBlockedIpv4(octets);
  }
  return false;
}

/** 判定主机名是否禁止出站。传入的是 URL.hostname（IPv6 不含方括号）。 */
export function isBlockedOutboundHost(host: string): boolean {
  const lowered = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!lowered) return true;
  if (lowered === "localhost" || lowered.endsWith(".localhost") || lowered.endsWith(".local")) {
    return true;
  }

  const v4 = parseIpv4(lowered) ?? parseNumericIpv4(lowered);
  if (v4) return isBlockedIpv4(v4);

  if (lowered.includes(":")) {
    const v6 = parseIpv6(lowered);
    // 形如 IPv6 却解析失败时按拒绝处理，避免绕过。
    return v6 ? isBlockedIpv6(v6) : true;
  }

  return false;
}

/** 校验出站地址，返回解析后的 URL；不允许时抛错。 */
export function assertPublicOutboundUrl(rawUrl: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label}地址无效：${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label}只支持 HTTP/HTTPS 地址`);
  }
  if (isBlockedOutboundHost(parsed.hostname)) {
    throw new Error(`${label}不允许访问本地或内网地址：${parsed.hostname}`);
  }
  return parsed;
}
