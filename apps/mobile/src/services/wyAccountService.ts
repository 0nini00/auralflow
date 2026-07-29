import AsyncStorage from "@react-native-async-storage/async-storage";

const WY_COOKIE_KEY = "auralflow.mobile.wy.cookie";
const WY_USER_KEY = "auralflow.mobile.wy.user";
const NETEASE_API_BASE = "https://music.163.com";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

type JsonRecord = Record<string, any>;

export interface WyUserInfo {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  vipType?: number;
}

export interface WyQrKeyResult {
  unikey: string;
}

export interface WyQrCodeResult {
  qrUrl: string;
  qrImageUrl: string;
}

export interface WyQrStatusResult {
  code: number;
  message: string;
  cookie?: string;
  user?: WyUserInfo;
  rawCookie?: string;
}

/**
 * 保存网易云 Cookie
 */
export async function saveWyCookie(cookie: string): Promise<void> {
  await AsyncStorage.setItem(WY_COOKIE_KEY, cookie);
}

/**
 * 获取网易云 Cookie
 */
export async function getWyCookie(): Promise<string | null> {
  return await AsyncStorage.getItem(WY_COOKIE_KEY);
}

/**
 * 保存用户信息
 */
export async function saveWyUser(user: WyUserInfo): Promise<void> {
  await AsyncStorage.setItem(WY_USER_KEY, JSON.stringify(user));
}

/**
 * 获取用户信息
 */
export async function getWyUser(): Promise<WyUserInfo | null> {
  const data = await AsyncStorage.getItem(WY_USER_KEY);
  return data ? JSON.parse(data) : null;
}

/**
 * 清除登录信息
 */
export async function clearWyAccount(): Promise<void> {
  await AsyncStorage.removeItem(WY_COOKIE_KEY);
  await AsyncStorage.removeItem(WY_USER_KEY);
}

function parseWyUserFromAccountResponse(data: any): WyUserInfo | null {
  if (data.code !== 200 || !data.account) {
    return null;
  }

  const profile = data.profile || data.account;
  return {
    userId: String(profile.userId || profile.id),
    nickname: profile.nickname || profile.userName || "未知用户",
    avatarUrl: profile.avatarUrl,
    vipType: profile.vipType,
  };
}

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

async function requestWyJson(path: string, options?: RequestInit): Promise<any> {
  const response = await fetch(`${NETEASE_API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": DEFAULT_USER_AGENT,
      ...(options?.headers ?? {}),
    },
  });

  const data = (await response.json()) as JsonRecord;
  if (!response.ok) {
    throw new Error(data?.message || `请求失败 HTTP ${response.status}`);
  }

  return data;
}

/**
 * 验证 Cookie 是否有效
 */
export async function validateWyCookie(cookie: string): Promise<WyUserInfo | null> {
  try {
    const data = await requestWyJson("/api/nuser/account/get", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
      },
    });

    return parseWyUserFromAccountResponse(data);
  } catch (error) {
    console.error("Validate wy cookie error:", error);
    return null;
  }
}

/**
 * Cookie 登录
 */
export async function loginWithCookie(cookie: string): Promise<WyUserInfo> {
  const user = await validateWyCookie(cookie);
  if (!user) {
    throw new Error("Cookie 无效或已过期");
  }

  await saveWyCookie(cookie);
  await saveWyUser(user);

  return user;
}

/**
 * 获取二维码登录 unikey
 */
export async function createWyQrUnikey(): Promise<WyQrKeyResult> {
  const data = await requestWyJson("/api/login/qrcode/unikey?type=1");
  const unikey = data?.unikey || data?.data?.unikey;

  if (!unikey) {
    throw new Error("获取二维码登录密钥失败");
  }

  return { unikey: String(unikey) };
}

/**
 * 生成二维码 URL
 */
export async function createWyQrCode(unikey: string): Promise<WyQrCodeResult> {
  const encodedKey = encodeURIComponent(unikey);
  const data = await requestWyJson(`/api/login/qrcode/create?key=${encodedKey}&qrimg=false`);
  const qrUrl = data?.qrurl || data?.data?.qrurl;

  if (!qrUrl) {
    throw new Error("生成二维码失败");
  }

  return {
    qrUrl,
    qrImageUrl: `${NETEASE_API_BASE}/login?codekey=${encodedKey}`,
  };
}

/**
 * 轮询二维码登录状态；成功时复用现有 Cookie 登录流程。
 */
export async function pollWyQrLoginStatus(unikey: string): Promise<WyQrStatusResult> {
  const encodedKey = encodeURIComponent(unikey);
  const response = await fetch(`${NETEASE_API_BASE}/api/login/qrcode/client/login?key=${encodedKey}&type=1`, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": DEFAULT_USER_AGENT,
    },
  });

  const data = (await response.json()) as JsonRecord;
  const code = Number(data?.code ?? -1);
  const message = String(data?.message || data?.msg || "");

  if (!response.ok) {
    throw new Error(message || `轮询二维码状态失败 HTTP ${response.status}`);
  }

  if (code !== 803) {
    return { code, message };
  }

  const rawCookieHeader = response.headers.get("set-cookie") || response.headers.get("Set-Cookie");
  const cookie = parseCookieFromHeaders(rawCookieHeader);

  if (!cookie) {
    throw new Error("二维码登录成功，但未获取到 Cookie");
  }

  const user = await loginWithCookie(cookie);
  return {
    code,
    message: message || "授权成功",
    cookie,
    rawCookie: rawCookieHeader || undefined,
    user,
  };
}

/**
 * 检查登录状态
 */
export async function checkLoginStatus(): Promise<{
  isLoggedIn: boolean;
  user: WyUserInfo | null;
}> {
  const cookie = await getWyCookie();
  const user = await getWyUser();

  if (!cookie || !user) {
    return { isLoggedIn: false, user: null };
  }

  // 可选：验证 Cookie 是否仍然有效
  // const validUser = await validateWyCookie(cookie);
  // if (!validUser) {
  //   await clearWyAccount();
  //   return { isLoggedIn: false, user: null };
  // }

  return { isLoggedIn: true, user };
}
