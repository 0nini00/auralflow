import { describe, expect, it } from "vitest";
import {
  compareCustomSourceVersions,
  isLikelyCustomSourceRemoteUrl,
  normalizeCustomSourceRemoteUrl,
  normalizeCustomSourceScript,
  normalizeCustomSourceVersion,
} from "./custom-source";

describe("custom source shared rules", () => {
  it("normalizes script line endings and surrounding whitespace", () => {
    expect(normalizeCustomSourceScript("  a\r\nb\r  ")).toBe("a\nb");
  });

  it("normalizes optional version prefixes", () => {
    expect(normalizeCustomSourceVersion(" v1.2.0 ")).toBe("1.2.0");
    expect(normalizeCustomSourceVersion()).toBe("");
  });

  it("compares different version lengths and treats invalid segments as zero", () => {
    expect(compareCustomSourceVersions("1.2.1", "1.2")).toBe(1);
    expect(compareCustomSourceVersions("1.x.0", "1.0.0")).toBe(0);
    expect(compareCustomSourceVersions("v2", "1.9.9")).toBe(1);
  });

  it("converts GitHub and Gitee blob links to raw script links", () => {
    expect(normalizeCustomSourceRemoteUrl("https://github.com/owner/repo/blob/main/source.js?raw=1"))
      .toBe("https://raw.githubusercontent.com/owner/repo/main/source.js?raw=1");
    expect(normalizeCustomSourceRemoteUrl("https://gitee.com/owner/repo/blob/main/source.txt"))
      .toBe("https://gitee.com/owner/repo/raw/main/source.txt");
  });

  it("accepts script resources but rejects ordinary repository pages", () => {
    expect(isLikelyCustomSourceRemoteUrl("https://raw.githubusercontent.com/owner/repo/main/source")).toBe(true);
    expect(isLikelyCustomSourceRemoteUrl("https://example.com/source.txt")).toBe(true);
    expect(isLikelyCustomSourceRemoteUrl("https://github.com/owner/repo")).toBe(false);
  });
});
