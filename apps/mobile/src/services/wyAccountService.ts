import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchWithTimeout, isTimeoutError } from "@/utils/fetchWithTimeout";
import { weapi } from "@/services/weapi";
import { getSecureItem, removeSecureItem, setSecureItem } from "@/services/secureStorageService";
import { migrateLegacySecret } from "@/services/secureStorageMigrationModel";
import { normalizeWyCookie } from "@/services/wyCookieModel";

const WY_COOKIE_KEY = "auralflow.mobile.wy.cookie";
const WY_SECURE_COOKIE_KEY = "auralflow.mobile.wy.cookie.v1";
const WY_USER_KEY = "auralflow.mobile.wy.user";
const NETEASE_API_BASE = "https://music.163.com";
// 与桌面端 UA 完全一致（desktop/src/services/wyAccountService.ts:59）：
// 残缺 UA（仅 AppleWebKit/537.36）曾被网易风控拒绝，返回 301。
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.54";

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
  await setSecureItem(WY_SECURE_COOKIE_KEY, cookie);
  await AsyncStorage.removeItem(WY_COOKIE_KEY);
}

/**
 * 获取网易云 Cookie，并在首次升级时从旧明文存储迁移。
 */
export async function getWyCookie(): Promise<string | null> {
  return migrateLegacySecret({
    readSecure: () => getSecureItem(WY_SECURE_COOKIE_KEY),
    readLegacy: () => AsyncStorage.getItem(WY_COOKIE_KEY),
    writeSecure: (value) => setSecureItem(WY_SECURE_COOKIE_KEY, value),
    removeLegacy: () => AsyncStorage.removeItem(WY_COOKIE_KEY),
  });
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
  await removeSecureItem(WY_SECURE_COOKIE_KEY);
  await AsyncStorage.multiRemove([WY_COOKIE_KEY, WY_USER_KEY]);
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

function extractCsrfToken(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)__?csrf(?:_token)?=([^;]+)/);
  return match?.[1] ?? "";
}

/**
 * 验证 Cookie 是否有效
 *
 * 对齐桌面端 weapiCall/postWeapi（desktop/src/services/wyAccountService.ts:186-230）:
 * POST https://music.163.com/weapi/w/nuser/account/get，body 为 params/encSecKey 表单。
 * 明文直连 /api/nuser/account/get 拿不到账号数据，导致 Cookie/扫码登录全部失败。
 */
export async function validateWyCookie(rawCookie: string): Promise<WyUserInfo | null> {
  const trimmedCookie = normalizeWyCookie(rawCookie);
  if (!/MUSIC_U=/.test(trimmedCookie)) {
    throw new Error("Cookie 中缺少 MUSIC_U，请复制登录后请求的完整 Cookie");
  }

  const { params, encSecKey } = await weapi({
    csrf_token: extractCsrfToken(trimmedCookie),
  });

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${NETEASE_API_BASE}/weapi/w/nuser/account/get`,
      {
        method: "POST",
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Origin: NETEASE_API_BASE,
          Referer: NETEASE_API_BASE,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: trimmedCookie,
        },
        body: `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`,
      }
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error("网络请求超时，请检查网络后重试");
    }
    throw new Error("网络请求失败，请检查网络后重试");
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`网易返回空响应 HTTP ${response.status}`);
  }

  let data: JsonRecord;
  try {
    data = JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`网易返回异常响应 HTTP ${response.status}`);
  }

  if (data.code === 301 || data.code === 401 || data.code === 403) {
    throw new Error("Cookie 无效或已过期");
  }
  if (data.code !== 200) {
    throw new Error(String(data.message || `网易接口返回 code=${data.code}`));
  }

  const user = parseWyUserFromAccountResponse(data);
  if (!user) {
    // code=200 但 account/profile 全空：服务器未认出这份 cookie（视为匿名请求）。
    // 常见原因：复制时漏了 MUSIC_U 之外的必备字段（如 __csrf），或 Cookie 头未随请求送达。
    throw new Error(
      "Cookie 未生效：服务器返回了匿名会话。请重新复制完整的 Cookie（包含 MUSIC_U 与 __csrf）后重试",
    );
  }
  return user;
}

/**
 * Cookie 登录
 */
export async function loginWithCookie(rawCookie: string): Promise<WyUserInfo> {
  const cookie = normalizeWyCookie(rawCookie);
  const user = await validateWyCookie(cookie);
  if (!user) {
    throw new Error("Cookie 无效或已过期");
  }

  await saveWyCookie(cookie);
  await saveWyUser(user);

  return user;
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
