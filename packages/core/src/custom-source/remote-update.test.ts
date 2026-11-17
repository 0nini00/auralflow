import { describe, expect, it, vi } from "vitest";
import {
  checkCustomSourceRemoteUpdate,
  getCustomSourceRemoteScriptUrl,
  readCustomSourceRemoteScript,
} from "./remote-update";

const script = (version: string | null, body = "lx.send('inited');") =>
  `/*\n * @name 测试源\n${version ? ` * @version ${version}\n` : ""} */\n${body}`;
const HOMEPAGE = "https://example.com/source.js";

describe("getCustomSourceRemoteScriptUrl", () => {
  it("只有指向脚本文件的 http(s) 主页才算远端地址", () => {
    expect(getCustomSourceRemoteScriptUrl({ homepage: ` ${HOMEPAGE} ` })).toBe(HOMEPAGE);
    expect(getCustomSourceRemoteScriptUrl({ homepage: "https://example.com/about" })).toBeNull();
    expect(getCustomSourceRemoteScriptUrl({ homepage: "ftp://example.com/source.js" })).toBeNull();
    expect(getCustomSourceRemoteScriptUrl({ homepage: undefined })).toBeNull();
    expect(getCustomSourceRemoteScriptUrl({ homepage: "" })).toBeNull();
  });

  it("GitHub blob 页面改写成 raw 直链", () => {
    expect(getCustomSourceRemoteScriptUrl({ homepage: "https://github.com/owner/repo/blob/main/dist/source.js" })).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/dist/source.js",
    );
  });

  it("无法解析成 URL 的主页视为没有远端地址", () => {
    expect(getCustomSourceRemoteScriptUrl({ homepage: "https://" })).toBeNull();
  });
});

describe("readCustomSourceRemoteScript", () => {
  const response = (status: number, body: string) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    text: vi.fn(async () => body),
  });

  it("2xx 且非空时返回正文", async () => {
    await expect(readCustomSourceRemoteScript(response(200, "/* a */"))).resolves.toBe("/* a */");
  });

  // 漂移收敛：桌面端曾用半角冒号、移动端用全角冒号，统一为全角（与同模块其他中文错误文案一致）。
  it("非 2xx 时带状态码拒绝，且不读取正文", async () => {
    const failed = response(404, "not found page");
    await expect(readCustomSourceRemoteScript(failed)).rejects.toThrow("远端音源请求失败：HTTP 404 Not Found");
    expect(failed.text).not.toHaveBeenCalled();
  });

  it("正文只有空白时拒绝", async () => {
    await expect(readCustomSourceRemoteScript(response(200, " \n "))).rejects.toThrow("远端音源脚本为空");
  });
});

describe("checkCustomSourceRemoteUpdate", () => {
  const local = (version: string | null, overrides: { version?: string; homepage?: string } = {}) => ({
    homepage: HOMEPAGE,
    script: script(version),
    ...overrides,
  });

  it("没有远端地址时不发请求", async () => {
    const fetchRemoteScript = vi.fn();
    await expect(checkCustomSourceRemoteUpdate(local("1.0.0", { homepage: "https://example.com/about" }), fetchRemoteScript)).resolves.toBeUndefined();
    expect(fetchRemoteScript).not.toHaveBeenCalled();
  });

  it("向归一化后的地址取脚本，远端版本更高时提示新版本", async () => {
    const fetchRemoteScript = vi.fn(async () => script("1.2.0"));
    await expect(
      checkCustomSourceRemoteUpdate(
        local("v1.1.0", { homepage: "https://github.com/owner/repo/blob/main/source.js" }),
        fetchRemoteScript,
      ),
    ).resolves.toEqual({
      log: "发现新版本：v1.1.0 -> v1.2.0",
      updateUrl: "https://raw.githubusercontent.com/owner/repo/main/source.js",
    });
    expect(fetchRemoteScript).toHaveBeenCalledWith("https://raw.githubusercontent.com/owner/repo/main/source.js");
  });

  it("两边都有版本号时只认版本号：同版本或更低版本即使正文不同也不提示", async () => {
    await expect(checkCustomSourceRemoteUpdate(local("1.2.0"), async () => script("1.2.0", "changed();"))).resolves.toBeUndefined();
    await expect(checkCustomSourceRemoteUpdate(local("1.10.0"), async () => script("1.9.9", "changed();"))).resolves.toBeUndefined();
  });

  it("条目上记录的版本优先于本地脚本头部的版本", async () => {
    await expect(
      checkCustomSourceRemoteUpdate(local("1.0.0", { version: "2.0.0" }), async () => script("1.5.0")),
    ).resolves.toBeUndefined();
  });

  it("远端没有版本号时退回比对正文，换行差异不算变更", async () => {
    const api = local(null);
    await expect(checkCustomSourceRemoteUpdate(api, async () => `${api.script.replace(/\n/g, "\r\n")}\r\n`)).resolves.toBeUndefined();
    await expect(checkCustomSourceRemoteUpdate(api, async () => script(null, "changed();"))).resolves.toEqual({
      log: "远端脚本内容已更新",
      updateUrl: HOMEPAGE,
    });
  });

  it("本地没有版本号而远端有：正文变了才提示，并注明本地版本未知", async () => {
    await expect(checkCustomSourceRemoteUpdate(local(null), async () => script("1.0.0", "changed();"))).resolves.toEqual({
      log: "远端脚本内容已更新，当前版本 v未知，远端版本 v1.0.0",
      updateUrl: HOMEPAGE,
    });
  });

  it("取脚本失败与远端脚本缺少头部都原样抛出，不当成「无更新」", async () => {
    await expect(
      checkCustomSourceRemoteUpdate(local("1.0.0"), async () => {
        throw new Error("远端音源脚本为空");
      }),
    ).rejects.toThrow("远端音源脚本为空");
    await expect(checkCustomSourceRemoteUpdate(local("1.0.0"), async () => "<html>404</html>")).rejects.toThrow("缺少 LX Music 头部注释");
  });
});
