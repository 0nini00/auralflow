import { describe, expect, it } from "vitest";
import { buildNeteasePcCookie, extractWyCsrfToken } from "./wy-cookie";
import {
  WY_WEB_USER_AGENT,
  WyAuthExpiredError,
  buildWyWeapiRequest,
  isWyAuthExpiredCode,
  parseWyResponseText,
} from "./wy-request";

describe("extractWyCsrfToken", () => {
  it.each([
    ["MUSIC_U=u; __csrf=abc", "abc"],
    ["__csrf=abc; MUSIC_U=u", "abc"],
    ["MUSIC_U=u; _csrf=abc", "abc"],
    ["MUSIC_U=u; __csrf_token=abc", "abc"],
    ["MUSIC_U=u;__csrf=abc;os=pc", "abc"],
  ])("%s -> %s", (cookie, expected) => {
    expect(extractWyCsrfToken(cookie)).toBe(expected);
  });

  it("不把其他键名的尾巴当成 csrf，取不到时返回空串", () => {
    expect(extractWyCsrfToken("x__csrf=abc; MUSIC_U=u")).toBe("");
    expect(extractWyCsrfToken("")).toBe("");
  });
});

describe("buildNeteasePcCookie", () => {
  it("替换已有的 os 并追加 os=pc", () => {
    expect(buildNeteasePcCookie("MUSIC_U=u; os=android; __csrf=c")).toBe("MUSIC_U=u; __csrf=c; os=pc");
    expect(buildNeteasePcCookie("MUSIC_U=u")).toBe("MUSIC_U=u; os=pc");
  });
});

describe("buildWyWeapiRequest", () => {
  it("表单体对 Base64 的 + / = 做百分号编码", () => {
    const request = buildWyWeapiRequest({ path: "/user/playlist", params: "a+b/c=", encSecKey: "00ff", cookie: "MUSIC_U=u" });
    expect(request.url).toBe("https://music.163.com/weapi/user/playlist");
    expect(request.method).toBe("POST");
    expect(request.body).toBe("params=a%2Bb%2Fc%3D&encSecKey=00ff");
    expect(request.headers).toMatchObject({
      "User-Agent": WY_WEB_USER_AGENT,
      Origin: "https://music.163.com",
      Referer: "https://music.163.com",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: "MUSIC_U=u",
    });
  });

  it("匿名请求不带 Cookie 头，路径不合法直接拒绝", () => {
    const request = buildWyWeapiRequest({ path: "/x", params: "p", encSecKey: "k", cookie: "" });
    expect("Cookie" in request.headers).toBe(false);
    expect(() => buildWyWeapiRequest({ path: "x", params: "p", encSecKey: "k", cookie: "" })).toThrow("必须以 / 开头");
  });
});

describe("parseWyResponseText", () => {
  const context = { path: "/user/playlist", status: 200 };

  it("返回对象", () => {
    expect(parseWyResponseText('{"code":200}', context)).toEqual({ code: 200 });
  });

  it("空响应、HTML、非对象都给出带路径与状态码的错误", () => {
    expect(() => parseWyResponseText("  ", context)).toThrow("空响应（/user/playlist，HTTP 200）");
    expect(() => parseWyResponseText("<html>blocked</html>", { path: "/x", status: 403 })).toThrow(
      "非 JSON 响应（/x，HTTP 403）: <html>blocked</html>",
    );
    expect(() => parseWyResponseText("[1]", context)).toThrow("不是对象");
  });
});

describe("登录失效判定", () => {
  it("301 / 401 / 403 表示会话无效，其余不是", () => {
    expect([301, 401, 403].every(isWyAuthExpiredCode)).toBe(true);
    expect([200, 400, 404, 500, "301", undefined].some(isWyAuthExpiredCode)).toBe(false);
  });

  it("错误类型可用 instanceof 识别", () => {
    const error = new WyAuthExpiredError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("WyAuthExpiredError");
    expect(error.message).toContain("登录已过期");
  });
});
