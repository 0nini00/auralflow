/**
 * 网易云二维码登录服务
 *
 * 流程：
 * 1. getQrCodeKey()        -> 调用 /api/login/qrcode/unikey 获取 key
 * 2. getQrCodeUrl(key)     -> 用 key 拼出二维码图片 URL（https://music.163.com/login?codekey=key）
 * 3. checkQrLoginStatus(key) -> 轮询 /api/login/qrcode/client/login?key=key 检查扫码状态
 * 4. 扫码成功后从响应 set-cookie 头拿到 cookie
 *
 * 对外暴露的状态码（已归一化，屏蔽网易云原始码的差异）：
 * - 501 等待扫码
 * - 502 已扫码，待确认授权
 * - 200 登录成功（附带 cookie）
 * - 500 二维码已过期
 */

const NETEASE_API_BASE = "https://music.163.com";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

type JsonRecord = Record<string, any>;

/** 网易云原始状态码 -> 归一化状态码 */
const QR_CODE_MAP: Record<number, number> = {
  801: 501, // 等待扫码
  802: 502, // 已扫码待确认
  803: 200, // 登录成功
  800: 500, // 二维码已过期
};

export interface QrLoginStatus {
  /** 归一化状态码：501/502/200/500 */
  code: number;
  message: string;
  /** 仅当 code === 200 时存在 */
  cookie?: string;
}

/**
 * 获取二维码登录 key（unikey）
 */
export async function getQrCodeKey(): Promise<string> {
  const response = await fetch(
    `${NETEASE_API_BASE}/api/login/qrcode/unikey?type=1`,
    {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    }
  );

  const data = (await response.json()) as JsonRecord;
  if (!response.ok) {
    throw new Error(
      data?.message || data?.msg || `获取二维码 key 失败 HTTP ${response.status}`
    );
  }

  const unikey = data?.unikey || data?.data?.unikey;
  if (!unikey) {
    throw new Error("获取二维码 key 失败：响应缺少 unikey");
  }

  return String(unikey);
}

/**
 * 根据 key 生成二维码图片 URL。
 * 该 URL 可直接用 <Image source={{ uri }} /> 渲染。
 */
export function getQrCodeUrl(key: string): string {
  return `${NETEASE_API_BASE}/login?codekey=${encodeURIComponent(key)}`;
}

/**
 * 从 set-cookie 响应头解析出可用的 Cookie 字符串。
 */
function parseCookieFromHeaders(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) {
    return null;
  }

  const cookieParts = setCookieHeader
    .split(/,(?=[^;]+?=)/)
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean);

  return cookieParts.length > 0 ? cookieParts.join("; ") : null;
}

/**
 * 轮询扫码状态。
 * 成功时返回归一化 code=200 并附带 cookie。
 */
export async function checkQrLoginStatus(key: string): Promise<QrLoginStatus> {
  const encodedKey = encodeURIComponent(key);
  const response = await fetch(
    `${NETEASE_API_BASE}/api/login/qrcode/client/login?key=${encodedKey}&type=1`,
    {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    }
  );

  const data = (await response.json()) as JsonRecord;
  const rawCode = Number(data?.code ?? -1);
  const rawMessage = String(data?.message || data?.msg || "");

  if (!response.ok) {
    throw new Error(
      rawMessage || `轮询二维码状态失败 HTTP ${response.status}`
    );
  }

  const code = QR_CODE_MAP[rawCode] ?? rawCode;
  const message = rawMessage || defaultQrMessage(code);

  // 登录成功：解析 cookie
  if (code === 200) {
    const rawCookieHeader =
      response.headers.get("set-cookie") || response.headers.get("Set-Cookie");
    const cookie = parseCookieFromHeaders(rawCookieHeader);

    if (!cookie) {
      throw new Error("二维码登录成功，但未获取到 Cookie");
    }

    return { code, message: message || "授权成功", cookie };
  }

  return { code, message };
}

function defaultQrMessage(code: number): string {
  switch (code) {
    case 501:
      return "等待扫码";
    case 502:
      return "已扫码，请在网易云音乐中确认授权";
    case 200:
      return "登录成功";
    case 500:
      return "二维码已过期，请刷新后重试";
    default:
      return "等待授权";
  }
}
