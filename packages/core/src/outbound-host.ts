/**
 * 出站请求的主机判定规则 —— 双端共用的书面定义。
 *
 * 桌面端在 Rust 侧执行同一套规则（`desktop/src-tauri/src/outbound.rs`），
 * 因为请求由 Rust 发出；移动端请求在 JS 侧发出，直接用本模块。
 * 两份实现必须手工同步，无自动化校验，规则变更时需人工逐条比对。
 *
 * 边界（显式声明）：
 *   - 只允许 http / https；
 *   - 拒绝 localhost、`.localhost`、`.local` 域名；
 *   - 拒绝字面量的回环 / 私有 / 链路本地 / CGNAT / 未指定 / 多播 / 广播 /
 *     文档示例地址，IPv4-mapped IPv6 与纯数字 IPv4 会先还原再判定；
 *   - **不做** DNS 解析后校验，解析到内网的域名（DNS rebinding）不在拦截范围。
 */

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** host 里出现即非法的字符：解码后冒出来说明原串在藏分隔符，一律拒绝。 */
const FORBIDDEN_HOST_CHARS = /[\0\t\n\r #/:<>?@[\]\\^|%]/;

/** IDNA 会折成 ASCII `.` 的句点变体：表意句点、全角句点、半角表意句点。 */
const DOT_VARIANTS = /[。．｡]/g;

/**
 * 把 host 归一化成 HTTP 客户端实际用于连接的形式，再交给黑名单比对。
 *
 * 这一步是判定的前提而非优化：黑名单里写的是归一化形式（`localhost`、
 * `127.0.0.1`），拿未归一化的原始串去比就会漏。OkHttp / WHATWG 会做
 * 百分号解码与 IDNA 映射，`http://%6c%6f%63%61%6c%68%6f%73%74/` 和
 * `http://127。0。0。1/` 实际连的是 localhost 与 127.0.0.1。
 *
 * 尾点一并剥掉：`localhost.` 是等价的 FQDN 写法，DNS 照样解析到回环，
 * 但既躲过 `=== "localhost"` 也躲过 `.endsWith(".local")`。
 *
 * 解码只做一次（与 WHATWG 一致，`%2531` 解出 `%31` 就该是 `%31`）；
 * 解码失败或解出分隔符时返回 `null`，由调用方按拒绝处理。
 */
function normalizeHost(host: string): string | null {
  let decoded = host;
  if (host.includes("%")) {
    try {
      decoded = decodeURIComponent(host);
    } catch {
      return null; // 畸形百分号序列，不猜
    }
    if (FORBIDDEN_HOST_CHARS.test(decoded)) return null;
  }
  return decoded
    .replace(DOT_VARIANTS, ".")
    .toLowerCase()
    .replace(/\.+$/, "");
}

/**
 * 从原始 URL 字符串按 RFC 3986 提取 host，不经过任何 `URL` 实现。
 *
 * 必须这样做：移动端没有符合规范的 `URL`，RN 自带的 polyfill 用正则取
 * `hostname`，其 userinfo 分组 `(?:[^@]+@)?` 不排除 `/` `?` `#`，于是
 * `http://127.0.0.1/@evil.com` 的 `hostname` 会返回 `evil.com`——校验看到的
 * host 与 OkHttp 实际请求的 host 不是同一个，判定直接失效。
 * 依赖入口处 import 一个全局 polyfill 也不行：漏掉 import 就静默失去防护。
 *
 * authority 终止于第一个 `/` `?` `#`（RFC 3986 3.2）或 `\`：WHATWG 在 special
 * scheme 下把 `\` 规范化为 `/`，OkHttp 同样如此。漏掉反斜杠会让
 * `http://127.0.0.1\@evil.com` 被读成 host=evil.com 而实际请求打到 127.0.0.1,
 * 与本模块要堵的 `@` 绕过是同一类问题、方向相反。
 * userinfo 是 authority 内最后一个 `@` 之前的部分，二者顺序不能颠倒。
 *
 * 返回值已过 `normalizeHost`，是客户端真正会连接的形式。
 */
function extractHostFromRawUrl(rawUrl: string): string | null {
  const schemeEnd = rawUrl.indexOf("://");
  if (schemeEnd < 0) return null;
  const afterScheme = rawUrl.slice(schemeEnd + 3);
  const authorityEnd = afterScheme.search(/[/?#\\]/);
  const authority = authorityEnd < 0 ? afterScheme : afterScheme.slice(0, authorityEnd);
  if (!authority) return null;

  const atIndex = authority.lastIndexOf("@");
  const hostPort = atIndex < 0 ? authority : authority.slice(atIndex + 1);
  if (!hostPort) return null;

  // IPv6 字面量的冒号属于地址本身，只有方括号之后的冒号才是端口分隔符
  if (hostPort.startsWith("[")) {
    const closing = hostPort.indexOf("]");
    return closing > 0 ? finalizeHost(hostPort.slice(1, closing)) : null;
  }
  const colonIndex = hostPort.indexOf(":");
  return finalizeHost(colonIndex < 0 ? hostPort : hostPort.slice(0, colonIndex));
}

/** 归一化并拒绝空结果（`...` 剥完尾点就是空串）。 */
function finalizeHost(host: string): string | null {
  const normalized = normalizeHost(host);
  return normalized ? normalized : null;
}

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

/** 单段数字，按 C 风格前缀判进制：`0x` 十六进制，前导 `0` 八进制，否则十进制。 */
function parseIpv4Part(part: string): number | null {
  if (!part) return null;
  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
    value = Number.parseInt(part.slice(2), 16);
  } else if (/^0[0-7]+$/.test(part)) {
    value = Number.parseInt(part.slice(1), 8);
  } else if (/^\d+$/.test(part)) {
    value = Number.parseInt(part, 10);
  } else {
    return null;
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * 还原 inet_aton 风格的 IPv4 写法：`2130706433`、`0177.0.0.1`、`0x7f.0.0.1`、
 * `127.1`、`127.0.1` 全部指向 127.0.0.1。
 *
 * WHATWG URL 会做这个规范化，但移动端拿到的是未规范化的原始 host，
 * 必须在这里补齐——漏掉任何一种写法都等于放行回环地址。
 * 越界或解析失败时返回 `null`，由调用方按「形似 IPv4」拒绝，不能 fail-open。
 */
function parseNumericIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length > 4) return null;

  const values: number[] = [];
  for (const part of parts) {
    const value = parseIpv4Part(part);
    if (value == null) return null;
    values.push(value);
  }

  // 最后一段承载剩余的所有字节（inet_aton 语义），其余每段必须是单字节
  const lastMax = 256 ** (4 - values.length + 1) - 1;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] > 0xff) return null;
  }
  const last = values[values.length - 1];
  if (last > lastMax) return null;

  let numeric = last;
  for (let i = 0; i < values.length - 1; i++) {
    numeric += values[i] * 256 ** (3 - i);
  }
  if (numeric > 0xffffffff) return null;
  return [(numeric >>> 24) & 0xff, (numeric >>> 16) & 0xff, (numeric >>> 8) & 0xff, numeric & 0xff];
}

/**
 * 形似 IPv4 但解析失败时不能放行（越界写法不能 fail-open）。
 *
 * 判定锚在最后一段：合法 TLD 至少含一个字母且不是 `0x` 前缀，而 inet_aton
 * 的末段必然是纯数字或十六进制字面量。只按字符集判会误伤大量真实域名
 * （`b2b.cc` / `a1.de` / `x5.be` 全落在 `[0-9a-fx.]` 里），把它们当成解析
 * 失败的 IPv4 拦掉。
 */
function looksLikeIpv4(host: string): boolean {
  const lastPart = host.slice(host.lastIndexOf(".") + 1);
  return /^\d+$/.test(lastPart) || /^0[xX][0-9a-fA-F]*$/.test(lastPart);
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

/**
 * 判定主机名是否禁止出站。
 *
 * 入参可以是原始 host（含百分号编码、句点变体、尾点、IPv6 方括号）：内部先过
 * `normalizeHost` 归一化到客户端实际连接的形式，再比对黑名单。归一化失败按
 * 拒绝处理，不 fail-open。
 */
export function isBlockedOutboundHost(host: string): boolean {
  const stripped = host.trim().replace(/^\[/, "").replace(/\]$/, "");
  const lowered = normalizeHost(stripped);
  if (!lowered) return true;
  if (lowered === "localhost" || lowered.endsWith(".localhost") || lowered.endsWith(".local")) {
    return true;
  }

  if (lowered.includes(":")) {
    const v6 = parseIpv6(lowered);
    // 形如 IPv6 却解析失败时按拒绝处理，避免绕过。
    return v6 ? isBlockedIpv6(v6) : true;
  }

  const v4 = parseIpv4(lowered) ?? parseNumericIpv4(lowered);
  if (v4) return isBlockedIpv4(v4);
  // 形似 IPv4 却解析失败时按拒绝处理，避免越界写法 fail-open。
  if (looksLikeIpv4(lowered)) return true;

  return false;
}

/**
 * 校验出站地址，返回解析后的 URL；不允许时抛错。
 *
 * 协议与 host 都从原始字符串判定，不读 `parsed.protocol` / `parsed.hostname`：
 * 移动端的 `URL` polyfill 对二者都不可信（构造函数从不抛错，`protocol` 可能为
 * 空串，`hostname` 会被 path 里的 `@` 骗过）。返回的 `URL` 仅供调用方读取
 * path/query 等非安全关键字段，发请求必须继续用原始字符串。
 */
export function assertPublicOutboundUrl(rawUrl: string, label: string): URL {
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`${label}只支持 HTTP/HTTPS 地址`);
  }
  const host = extractHostFromRawUrl(trimmed);
  if (!host) {
    throw new Error(`${label}地址无效：${rawUrl}`);
  }
  if (isBlockedOutboundHost(host)) {
    throw new Error(`${label}不允许访问本地或内网地址：${host}`);
  }
  try {
    return new URL(trimmed);
  } catch {
    throw new Error(`${label}地址无效：${rawUrl}`);
  }
}
