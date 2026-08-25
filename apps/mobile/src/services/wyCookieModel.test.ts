import { describe, expect, it } from "vitest";

import { normalizeWyCookie } from "./wyCookieModel";

describe("normalizeWyCookie", () => {
  it("剥离 Cookie: 请求头前缀", () => {
    const input = "Cookie: MUSIC_U=abc123; __csrf=xyz";
    expect(normalizeWyCookie(input)).toBe("MUSIC_U=abc123; __csrf=xyz");
  });

  it("多行 name=value 合并为分号分隔", () => {
    const input = "MUSIC_U=abc123\n__csrf=xyz\nos=pc";
    expect(normalizeWyCookie(input)).toBe("MUSIC_U=abc123; __csrf=xyz; os=pc");
  });

  it("制表符表格（DevTools 复制）转 name=value", () => {
    const input = "MUSIC_U\tabc123";
    expect(normalizeWyCookie(input)).toBe("MUSIC_U=abc123");
  });

  it("过滤 DevTools 表头行 name value", () => {
    const input = "name\tvalue\nMUSIC_U=abc123";
    const result = normalizeWyCookie(input);
    expect(result).toContain("MUSIC_U=abc123");
    expect(result).not.toContain("name");
  });

  it("压缩多余分号与空白", () => {
    expect(normalizeWyCookie("MUSIC_U=abc123;;__csrf=xyz")).toBe("MUSIC_U=abc123; __csrf=xyz");
  });

  it("已是规范格式则原样返回", () => {
    const input = "MUSIC_U=abc123; __csrf=xyz";
    expect(normalizeWyCookie(input)).toBe(input);
  });

  it("空串与纯前缀返回空串", () => {
    expect(normalizeWyCookie("")).toBe("");
    expect(normalizeWyCookie("Cookie: ")).toBe("");
  });
});
