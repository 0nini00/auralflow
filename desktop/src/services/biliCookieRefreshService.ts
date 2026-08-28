/**
 * B站 Web Cookie 自动续期服务。
 *
 * B站 2023 风控机制下，Web Cookie 会随敏感接口访问逐渐失效。通过 4 步刷新
 * 流程可换取新 Cookie + 新 refresh_token，延长有效期至约 6 个月。
 *
 * 前置条件：需要 refresh_token（即浏览器 localStorage 的 ac_time_value），
 * 它在登录（二维码/密码/短信）时返回，不在 cookie 里。当前"复制 cookie"登录
 * 方式拿不到它，因此本服务需要用户额外提供 refresh_token 才能工作。
 *
 * 详见 SocialSisterYi/bilibili-API-collect docs/login/cookie_refresh.md
 */

import { outboundRequest } from "@/services/outboundHttp";
import { loadSettings, patchSettings } from "@lx/tauri-bridge";

// ─── RSA 公钥（B站 CorrespondPath 加密用） ───────────────────

const BILI_REFRESH_PUBLIC_KEY_BASE64 =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg"
  + "Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71"
  + "nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40"
  + "JNrRuoEUXpabUzGB8QIDAQAB";

const BILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let importedPublicKey: CryptoKey | null = null;

async function getRefreshPublicKey(): Promise<CryptoKey> {
  if (importedPublicKey) return importedPublicKey;
  const derBytes = base64ToBytes(BILI_REFRESH_PUBLIC_KEY_BASE64);
  importedPublicKey = await crypto.subtle.importKey(
    "spki",
    derBytes,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  return importedPublicKey;
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bytesToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 生成 CorrespondPath：对 `refresh_{timestamp}` 做 RSA-OAEP(SHA-256) 加密后 hex 编码。
 */
async function generateCorrespondPath(timestamp: number): Promise<string> {
  const key = await getRefreshPublicKey();
  const plaintext = new TextEncoder().encode(`refresh_${timestamp}`);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, plaintext);
  return bytesToHex(encrypted);
}

// ─── Cookie 工具 ─────────────────────────────────────────────

export function extractCookieValue(cookieString: string, name: string): string {
  const regex = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`, "i");
  const match = cookieString.match(regex);
  return match ? match[1].trim() : "";
}

/** 从 Set-Cookie 响应头数组里提取指定 cookie 名的值 */
function extractSetCookieValue(setCookieHeader: string, name: string): string {
  const lines = setCookieHeader.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(`${name.toLowerCase()}=`)) {
      return trimmed.split(";")[0].split("=").slice(1).join("=").trim();
    }
  }
  return "";
}

function rebuildCookieWithField(oldCookie: string, name: string, value: string): string {
  if (!value) return oldCookie;
  const parts = oldCookie
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !p.toLowerCase().startsWith(`${name.toLowerCase()}=`));
  parts.push(`${name}=${value}`);
  return parts.join("; ");
}

// ─── 持久化 refresh_token ─────────────────────────────────────

export async function getBiliRefreshToken(): Promise<string> {
  try {
    const settings = await loadSettings();
    return settings.biliRefreshToken ?? "";
  } catch {
    return "";
  }
}

export async function saveBiliRefreshToken(token: string): Promise<void> {
  await patchSettings({ biliRefreshToken: token || null });
}

// ─── 刷新流程 ─────────────────────────────────────────────────

interface BiliCookieRefreshResult {
  refreshed: boolean;
  newCookie?: string;
  newRefreshToken?: string;
  reason?: string;
}

/**
 * 步骤 1：检查是否需要刷新。
 * GET https://passport.bilibili.com/x/passport-login/web/cookie/info
 */
async function checkRefreshNeeded(cookie: string): Promise<{ refresh: boolean; timestamp: number }> {
  const csrf = extractCookieValue(cookie, "bili_jct");
  const url = `https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=${encodeURIComponent(csrf)}`;
  const resp = await outboundRequest(url, {
    method: "GET",
    headers: { Cookie: cookie, "User-Agent": BILI_UA },
    timeoutMs: 10000,
  });
  if (!resp.ok) throw new Error(`检查刷新状态失败: HTTP ${resp.status}`);
  const body = JSON.parse(await resp.text()) as { code: number; message?: string; data?: { refresh: boolean; timestamp: number } };
  if (body.code !== 0) {
    if (body.code === -101) throw new Error("B站登录已过期，请重新填写 Cookie");
    throw new Error(`检查刷新状态失败: ${body.message ?? `code=${body.code}`}`);
  }
  return {
    refresh: body.data?.refresh ?? false,
    timestamp: body.data?.timestamp ?? Date.now(),
  };
}

/**
 * 步骤 2：生成 CorrespondPath + 获取 refresh_csrf。
 * GET https://www.bilibili.com/correspond/1/{correspondPath}
 */
async function getRefreshCsrf(cookie: string, timestamp: number): Promise<string> {
  const correspondPath = await generateCorrespondPath(timestamp);
  const url = `https://www.bilibili.com/correspond/1/${correspondPath}`;
  const resp = await outboundRequest(url, {
    method: "GET",
    headers: { Cookie: cookie, "User-Agent": BILI_UA },
    timeoutMs: 10000,
  });
  if (!resp.ok) throw new Error(`获取 refresh_csrf 失败: HTTP ${resp.status}`);
  const html = await resp.text();
  const match = html.match(/<div\s+id="1-name">(.*?)<\/div>/);
  if (!match || !match[1]) throw new Error("无法从响应中解析 refresh_csrf");
  return match[1].trim();
}

/**
 * 步骤 3：刷新 Cookie。
 * POST https://passport.bilibili.com/x/passport-login/web/cookie/refresh
 * 新 SESSDATA / bili_jct 在响应头的 Set-Cookie 中。
 */
async function refreshBiliCookie(
  cookie: string,
  refreshCsrf: string,
  refreshToken: string,
): Promise<{ newCookie: string; newRefreshToken: string }> {
  const csrf = extractCookieValue(cookie, "bili_jct");
  const url = "https://passport.bilibili.com/x/passport-login/web/cookie/refresh";
  const body = `csrf=${encodeURIComponent(csrf)}&refresh_csrf=${encodeURIComponent(refreshCsrf)}&source=main_web&refresh_token=${encodeURIComponent(refreshToken)}`;

  const resp = await outboundRequest(url, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "User-Agent": BILI_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://www.bilibili.com",
    },
    body,
    timeoutMs: 10000,
  });

  if (!resp.ok) throw new Error(`刷新 Cookie 失败: HTTP ${resp.status}`);
  const responseBody = JSON.parse(await resp.text()) as {
    code: number;
    message?: string;
    data?: { status: number; message: string; refresh_token: string };
  };

  if (responseBody.code !== 0) {
    if (responseBody.code === -101) throw new Error("B站登录已过期，请重新填写 Cookie");
    if (responseBody.code === 86095) throw new Error("refresh_token 与 Cookie 不匹配，请重新获取 refresh_token");
    throw new Error(`刷新 Cookie 失败: ${responseBody.message ?? `code=${responseBody.code}`}`);
  }

  const newRefreshToken = responseBody.data?.refresh_token ?? "";
  const setCookieHeader = resp.headers["set-cookie"] ?? resp.headers["Set-Cookie"] ?? "";
  const newSessdata = extractSetCookieValue(setCookieHeader, "SESSDATA");
  const newBiliJct = extractSetCookieValue(setCookieHeader, "bili_jct");

  if (!newSessdata) throw new Error("刷新成功但响应中未包含新 SESSDATA");

  let newCookie = cookie;
  newCookie = rebuildCookieWithField(newCookie, "SESSDATA", newSessdata);
  newCookie = rebuildCookieWithField(newCookie, "bili_jct", newBiliJct);

  const newDedeUserId = extractSetCookieValue(setCookieHeader, "DedeUserID");
  if (newDedeUserId) {
    newCookie = rebuildCookieWithField(newCookie, "DedeUserID", newDedeUserId);
  }

  return { newCookie, newRefreshToken };
}

/**
 * 步骤 4：确认更新，使旧 refresh_token 对应的 cookie 失效。
 * POST https://passport.bilibili.com/x/passport-login/web/confirm/refresh
 */
async function confirmRefresh(newCookie: string, oldRefreshToken: string): Promise<void> {
  const csrf = extractCookieValue(newCookie, "bili_jct");
  const url = "https://passport.bilibili.com/x/passport-login/web/confirm/refresh";
  const body = `csrf=${encodeURIComponent(csrf)}&refresh_token=${encodeURIComponent(oldRefreshToken)}`;

  const resp = await outboundRequest(url, {
    method: "POST",
    headers: {
      Cookie: newCookie,
      "User-Agent": BILI_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://www.bilibili.com",
    },
    body,
    timeoutMs: 10000,
  });

  if (!resp.ok) return;
  const responseBody = JSON.parse(await resp.text()) as { code: number; message?: string };
  if (responseBody.code !== 0 && responseBody.code !== -101) {
    // 确认失败不致命：新 cookie 已有效，只是旧 refresh_token 未作废
    console.warn("B站 refresh 确认失败:", responseBody.message ?? `code=${responseBody.code}`);
  }
}

// ─── 对外入口 ─────────────────────────────────────────────────

/**
 * 检查并尝试续期 B站 Cookie。
 *
 * 在 biliAccountStore.load() 成功后调用。若服务端判定需要刷新且本地有
 * refresh_token，则执行完整 4 步流程，更新 cookie 和 refresh_token。
 *
 * @param currentCookie 当前生效的完整 B站 cookie 字符串
 * @returns 续期结果
 */
export async function checkAndRefreshBiliCookie(currentCookie: string): Promise<BiliCookieRefreshResult> {
  if (!currentCookie) return { refreshed: false, reason: "无 cookie" };

  const refreshToken = await getBiliRefreshToken();
  if (!refreshToken) {
    return { refreshed: false, reason: "未配置 refresh_token" };
  }

  try {
    const { refresh, timestamp } = await checkRefreshNeeded(currentCookie);
    if (!refresh) return { refreshed: false, reason: "无需刷新" };

    const refreshCsrf = await getRefreshCsrf(currentCookie, timestamp);
    const { newCookie, newRefreshToken } = await refreshBiliCookie(currentCookie, refreshCsrf, refreshToken);
    await confirmRefresh(newCookie, refreshToken);

    if (newRefreshToken) {
      await saveBiliRefreshToken(newRefreshToken);
    }

    return { refreshed: true, newCookie, newRefreshToken };
  } catch (error) {
    return {
      refreshed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
