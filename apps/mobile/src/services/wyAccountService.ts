import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchWithTimeout, isTimeoutError } from "@/utils/fetchWithTimeout";
import { weapi } from "@/services/weapi";
import { getSecureItem, removeSecureItem, setSecureItem } from "@/services/secureStorageService";
import { migrateLegacySecret } from "@/services/secureStorageMigrationModel";
import { extractWyCsrfToken, normalizeWyCookie } from "@/services/wyCookieModel";
import { WyAuthExpiredError } from "@/services/wyAuthError";

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

interface WyLoginStatus {
  isLoggedIn: boolean;
  user: WyUserInfo | null;
}

export type WyAccountRequest<T> = Promise<T> & {
  isCurrent: () => boolean;
};

type AccountOperation = WyAccountRequest<WyLoginStatus> & {
  kind: "check" | "login" | "logout";
  pending: boolean;
};

// 操作对象的身份就是唯一世代；store 只消费 isCurrent，不维护另一份序号。
let currentOperation: AccountOperation | null = null;
let storageQueue: Promise<void> = Promise.resolve();

class WyAccountSupersededError extends Error {
  constructor() {
    super("账号操作已被后续操作取代");
    this.name = "WyAccountSupersededError";
  }
}

function startAccountOperation(
  kind: AccountOperation["kind"],
  run: (assertCurrent: () => void) => Promise<WyLoginStatus>,
): AccountOperation {
  const isCurrent = () => currentOperation === operation;
  const assertCurrent = () => {
    if (!isCurrent()) throw new WyAccountSupersededError();
  };
  const result = Promise.resolve()
    .then(() => run(assertCurrent))
    .then((status) => {
      assertCurrent();
      return status;
    })
    .finally(() => { operation.pending = false; });
  const operation: AccountOperation = Object.assign(result, { kind, pending: true, isCurrent });
  currentOperation = operation;
  return operation;
}

function mapAccountRequest<T>(
  request: WyAccountRequest<WyLoginStatus>,
  select: (status: WyLoginStatus) => T,
): WyAccountRequest<T> {
  return Object.assign(request.then(select), { isCurrent: request.isCurrent });
}

function withAccountStorage<T>(action: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(action);
  // 失败仅释放队列；原始 result 仍将错误交给调用方，不能伪装为网络降级。
  storageQueue = result.then(() => undefined, () => undefined);
  return result;
}

function persistCurrentAccount(
  assertCurrent: () => void,
  write: () => Promise<void>,
): Promise<void> {
  return withAccountStorage(async () => {
    assertCurrent();
    // 已交给原生层的写入无法取消：整组完成后才允许下一组读写进入。
    await write();
    assertCurrent();
  });
}

async function saveWyCookie(cookie: string): Promise<void> {
  await setSecureItem(WY_SECURE_COOKIE_KEY, cookie);
  await AsyncStorage.removeItem(WY_COOKIE_KEY);
}

async function readWyCookie(): Promise<string | null> {
  return migrateLegacySecret({
    readSecure: () => getSecureItem(WY_SECURE_COOKIE_KEY),
    readLegacy: () => AsyncStorage.getItem(WY_COOKIE_KEY),
    writeSecure: (value) => setSecureItem(WY_SECURE_COOKIE_KEY, value),
    removeLegacy: () => AsyncStorage.removeItem(WY_COOKIE_KEY),
  });
}

/** 迁移也会写凭证，必须与退出和登录使用同一存储队列。 */
export function getWyCookie(): Promise<string | null> {
  return withAccountStorage(readWyCookie);
}

async function saveWyUser(user: WyUserInfo): Promise<void> {
  await AsyncStorage.setItem(WY_USER_KEY, JSON.stringify(user));
}

async function readWyUser(): Promise<WyUserInfo | null> {
  const data = await AsyncStorage.getItem(WY_USER_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data) as WyUserInfo;
  } catch {
    await AsyncStorage.removeItem(WY_USER_KEY);
    return null;
  }
}

export function getWyUser(): Promise<WyUserInfo | null> {
  return withAccountStorage(readWyUser);
}

async function removeWyAccount(): Promise<void> {
  await removeSecureItem(WY_SECURE_COOKIE_KEY);
  await AsyncStorage.multiRemove([WY_COOKIE_KEY, WY_USER_KEY]);
}

/** 退出立刻更换世代；已排队的清除先于后续登录提交完成。 */
export function clearWyAccount(): WyAccountRequest<void> {
  const request = startAccountOperation("logout", async () => {
    await withAccountStorage(removeWyAccount);
    return { isLoggedIn: false, user: null };
  });
  return mapAccountRequest(request, () => undefined);
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

/**
 * 验证 Cookie 是否有效
 *
 * 对齐桌面端 weapiCall/postWeapi（desktop/src/services/wyAccountService.ts:186-230）:
 * POST https://music.163.com/weapi/w/nuser/account/get，body 为 params/encSecKey 表单。
 * 明文直连 /api/nuser/account/get 拿不到账号数据，导致 Cookie/扫码登录全部失败。
 */
export async function validateWyCookie(rawCookie: string): Promise<WyUserInfo> {
  const trimmedCookie = normalizeWyCookie(rawCookie);
  if (!/MUSIC_U=/.test(trimmedCookie)) {
    throw new Error("Cookie 中缺少 MUSIC_U，请复制登录后请求的完整 Cookie");
  }

  const { params, encSecKey } = await weapi({
    csrf_token: extractWyCsrfToken(trimmedCookie),
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
    throw new Error(`网易服务器返回空响应，请稍后重试`);
  }

  let data: JsonRecord;
  try {
    data = JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`网易服务器返回异常响应，请稍后重试`);
  }

  if (data.code === 301 || data.code === 401 || data.code === 403) {
    throw new WyAuthExpiredError("Cookie 无效或已过期");
  }
  if (data.code !== 200) {
    throw new Error(String(data.message || `网易接口返回 code=${data.code}`));
  }

  const user = parseWyUserFromAccountResponse(data);
  if (!user) {
    // code=200 但 account/profile 全空：服务器未认出这份 cookie（视为匿名请求）。
    // 常见原因：复制时漏了 MUSIC_U 之外的必备字段（如 __csrf），或 Cookie 头未随请求送达。
    throw new WyAuthExpiredError(
      "Cookie 未生效：服务器返回了匿名会话。请重新复制完整的 Cookie（包含 MUSIC_U 与 __csrf）后重试",
    );
  }
  return user;
}

/** Cookie 登录：网络校验可并行，凭证和资料必须作为一组提交。 */
export function loginWithCookie(rawCookie: string): WyAccountRequest<WyUserInfo> {
  const request = startAccountOperation("login", async (assertCurrent) => {
    const cookie = normalizeWyCookie(rawCookie);
    const user = await validateWyCookie(cookie);
    await persistCurrentAccount(assertCurrent, async () => {
      await saveWyCookie(cookie);
      await saveWyUser(user);
    });
    return { isLoggedIn: true, user };
  });
  return mapAccountRequest(request, (status) => status.user!);
}

/**
 * 同一世代仅接受最新校验；登录/退出期间的校验共用该操作结果，
 * 不校验正在被替换的旧凭证，也不使显式账号操作失效。
 */
export function checkLoginStatus(): WyAccountRequest<WyLoginStatus> {
  if (currentOperation?.pending && currentOperation.kind !== "check") {
    return currentOperation;
  }
  return startAccountOperation("check", async (assertCurrent) => {
    const { cookie, user } = await withAccountStorage(async () => {
      assertCurrent();
      return { cookie: await readWyCookie(), user: await readWyUser() };
    });
    assertCurrent();
    if (!cookie || !user) return { isLoggedIn: false, user: null };

    let validUser: WyUserInfo;
    try {
      validUser = await validateWyCookie(cookie);
    } catch (error) {
      assertCurrent();
      if (error instanceof WyAuthExpiredError) {
        await persistCurrentAccount(assertCurrent, removeWyAccount);
        return { isLoggedIn: false, user: null };
      }
      // 仅当前账号的网络校验失败时保留本地登录态；存储错误不走此分支。
      return { isLoggedIn: true, user };
    }
    assertCurrent();
    if (validUser.userId !== user.userId || validUser.nickname !== user.nickname) {
      await persistCurrentAccount(assertCurrent, () => saveWyUser(validUser));
      return { isLoggedIn: true, user: validUser };
    }
    return { isLoggedIn: true, user };
  });
}
