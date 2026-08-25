import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./fetchWithTimeout";

/**
 * 锁定 credentials 默认值。
 *
 * 改回 "include" 会让 RN Android 保留 OkHttp 的 ReactCookieJarContainer，
 * BridgeInterceptor 随后用系统 CookieJar 里的匿名 cookie 整体替换掉调用方手动
 * 设置的 Cookie 头，网易云/B站 cookie 登录会静默退化成匿名会话。
 */
describe("fetchWithTimeout credentials", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("defaults to omit so manual Cookie headers survive", async () => {
    const spy = stubFetch();
    await fetchWithTimeout("https://music.163.com/weapi/w/nuser/account/get", {
      method: "POST",
      headers: { Cookie: "MUSIC_U=abc" },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: "omit" });
  });

  it("keeps the caller's explicit credentials override", async () => {
    const spy = stubFetch();
    await fetchWithTimeout("https://example.com", { credentials: "include" });

    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });

  it("passes through method, headers and body untouched", async () => {
    const spy = stubFetch();
    await fetchWithTimeout("https://example.com", {
      method: "POST",
      headers: { Cookie: "MUSIC_U=abc", "Content-Type": "application/x-www-form-urlencoded" },
      body: "params=1",
    });

    expect(spy.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { Cookie: "MUSIC_U=abc", "Content-Type": "application/x-www-form-urlencoded" },
      body: "params=1",
    });
  });
});
