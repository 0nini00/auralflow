import { describe, expect, it } from "vitest";
import { parseDesktopUserApiInfo } from "./script-header";

const header = (lines: string[]) => `/*!\n${lines.map((line) => ` * ${line}`).join("\n")}\n */\nlx.send('inited');`;

describe("parseDesktopUserApiInfo", () => {
  it("读取头部注释里的五个字段", () => {
    expect(
      parseDesktopUserApiInfo(
        header([
          "@name 测试源",
          "@description 一个描述",
          "@author someone",
          "@homepage https://example.com/source.js",
          "@version 1.2.3",
        ]),
      ),
    ).toEqual({
      name: "测试源",
      description: "一个描述",
      author: "someone",
      homepage: "https://example.com/source.js",
      version: "1.2.3",
    });
  });

  it("没有头部块注释时拒绝，而不是当成空信息", () => {
    expect(() => parseDesktopUserApiInfo("// @name 测试源\nlx.send('inited');")).toThrow("缺少 LX Music 头部注释");
    expect(() => parseDesktopUserApiInfo("lx.send('inited'); /* @name 不在开头 */")).toThrow();
  });

  it("超长字段按各自上限截断并加省略号", () => {
    const info = parseDesktopUserApiInfo(
      header([`@name ${"名".repeat(30)}`, `@description ${"述".repeat(40)}`, `@author ${"a".repeat(60)}`]),
    );
    expect(info.name).toBe(`${"名".repeat(24)}...`);
    expect(info.description).toBe(`${"述".repeat(36)}...`);
    expect(info.author).toBe(`${"a".repeat(56)}...`);
  });

  it("版本字段只取其中的版本号，取不到时退回普通截断", () => {
    expect(parseDesktopUserApiInfo(header(["@name a", "@version 版本 v2.10.0-beta.1 (2026)"])).version).toBe("v2.10.0-beta.1");
    expect(parseDesktopUserApiInfo(header(["@name a", "@version latest"])).version).toBe("latest");
  });

  it("忽略未知标签，CRLF 换行与 LF 等价", () => {
    const script = "/*\r\n * @name 源\r\n * @license MIT\r\n * @version 1.0\r\n */\r\n";
    expect(parseDesktopUserApiInfo(script)).toMatchObject({ name: "源", version: "1.0" });
    expect(parseDesktopUserApiInfo(script)).not.toHaveProperty("license");
  });

  it("缺少 @name 时生成 user_api_ 前缀的占位名", () => {
    expect(parseDesktopUserApiInfo(header(["@version 1.0.0"])).name).toMatch(/^user_api_/);
  });
});
