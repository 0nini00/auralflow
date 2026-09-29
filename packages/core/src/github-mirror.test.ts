import { describe, expect, it } from "vitest";

import {
  GITHUB_MIRROR_PREFIX,
  isMirrorableGithubUrl,
  toMirroredGithubUrl,
} from "./github-mirror";

/**
 * 这套用例锚定一个实测问题：直连 GitHub release 资产在国内可能一个字节都下不来，
 * 而加速镜像能到 7.6 MB/s。改写错了的后果是「更新彻底不可用」，所以要钉死边界：
 * 只改 GitHub 的下载域名、前缀为空时不动、已改写的不重复套。
 */
describe("isMirrorableGithubUrl", () => {
  it("认 GitHub 的下载类域名（含 release 资产 302 后的两个 hosts）", () => {
    expect(isMirrorableGithubUrl("https://github.com/o/r/releases/download/v1/a.apk")).toBe(true);
    expect(isMirrorableGithubUrl("https://objects.githubusercontent.com/x/y")).toBe(true);
    expect(isMirrorableGithubUrl("https://release-assets.githubusercontent.com/x")).toBe(true);
    expect(isMirrorableGithubUrl("http://github.com/o/r")).toBe(true);
  });

  it("不碰其它域名与非 http(s) 地址", () => {
    for (const url of [
      "https://raw.githubusercontent.com/o/r/main/x.js",
      "https://p1.music.126.net/x.jpg",
      "https://dav.jianguoyun.com/dav/x",
      "file:///C:/x.apk",
      "data:text/plain,hi",
      "",
      "   ",
    ]) {
      expect(isMirrorableGithubUrl(url), url).toBe(false);
    }
  });

  it("带端口的主机名也认得", () => {
    expect(isMirrorableGithubUrl("https://github.com:443/o/r/releases/download/v1/a")).toBe(true);
  });
});

describe("toMirroredGithubUrl", () => {
  const assetUrl = "https://github.com/0nini00/auralflow/releases/download/v0.5.1/a.apk";

  it("给 GitHub 下载直链加前缀", () => {
    expect(toMirroredGithubUrl(assetUrl)).toBe(`${GITHUB_MIRROR_PREFIX}${assetUrl}`);
    expect(toMirroredGithubUrl(assetUrl, "https://gh-proxy.com")).toBe(
      `https://gh-proxy.com/${assetUrl}`,
    );
  });

  it("前缀为空时原样返回（宁可慢，也不要拼出坏地址）", () => {
    expect(toMirroredGithubUrl(assetUrl, "")).toBe(assetUrl);
    expect(toMirroredGithubUrl(assetUrl, "   ")).toBe(assetUrl);
  });

  it("已经是镜像地址时不套两层", () => {
    const once = toMirroredGithubUrl(assetUrl);
    expect(toMirroredGithubUrl(once)).toBe(once);
  });

  it("非 GitHub 域名原样返回", () => {
    const other = "https://p1.music.126.net/x.jpg";
    expect(toMirroredGithubUrl(other)).toBe(other);
  });

  it("空 / null 输入不崩且返回可用的空串", () => {
    expect(toMirroredGithubUrl("")).toBe("");
    expect(toMirroredGithubUrl(null as unknown as string)).toBe("");
    expect(toMirroredGithubUrl(undefined as unknown as string)).toBe("");
  });
});
