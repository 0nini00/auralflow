import { describe, expect, it } from "vitest";
import { assertHttpsWebdavUrl } from "./webdavUrlModel";

describe("assertHttpsWebdavUrl", () => {
  it("接受公网 HTTPS 地址", () => {
    expect(assertHttpsWebdavUrl("https://dav.example.com/root").protocol).toBe("https:");
  });

  it("拒绝 HTTP 地址", () => {
    expect(() => assertHttpsWebdavUrl("http://dav.example.com/root")).toThrow("仅支持 HTTPS");
  });
});
