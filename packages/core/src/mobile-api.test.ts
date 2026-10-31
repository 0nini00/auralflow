import { describe, expect, it } from "vitest";
import { resolveBuiltinMusicApiQuality, toBuiltinMusicApiBr } from "./mobile-api";

/**
 * 网关的 `br` 是实际码率而不是请求档位。这里锁住三条最容易出错的语义：
 *  - 高码率无损不能被打回默认 320k（否则无损缓存永远命不中）；
 *  - 实际降档必须如实反映（请求 320 回 128 时不能继续标 320k）；
 *  - 异常 / 缺省响应沿用请求档位，不能凭空降级。
 */
describe("resolveBuiltinMusicApiQuality", () => {
  it("24bit 母带的实际码率沿用请求档位，而不是被归一化成 320k", () => {
    expect(resolveBuiltinMusicApiQuality(3229, toBuiltinMusicApiBr("flac24bit"))).toBe("flac24bit");
    expect(resolveBuiltinMusicApiQuality(3229, toBuiltinMusicApiBr("flac"))).toBe("flac");
  });

  it("请求无损却拿到有损码率时诚实降档", () => {
    expect(resolveBuiltinMusicApiQuality(320, toBuiltinMusicApiBr("flac"))).toBe("320k");
    expect(resolveBuiltinMusicApiQuality(128, toBuiltinMusicApiBr("flac24bit"))).toBe("128k");
    expect(resolveBuiltinMusicApiQuality(192, toBuiltinMusicApiBr("320k"))).toBe("192k");
  });

  it("兼容 bps 与字符串形式的码率", () => {
    expect(resolveBuiltinMusicApiQuality(320_000, "320")).toBe("320k");
    expect(resolveBuiltinMusicApiQuality("740", "740")).toBe("flac");
    expect(resolveBuiltinMusicApiQuality(1_411, "740")).toBe("flac");
  });

  it("无版权 / 缺省响应沿用请求档位", () => {
    expect(resolveBuiltinMusicApiQuality(-1, "999")).toBe("flac24bit");
    expect(resolveBuiltinMusicApiQuality(0, "320")).toBe("320k");
    expect(resolveBuiltinMusicApiQuality(undefined, "740")).toBe("flac");
    expect(resolveBuiltinMusicApiQuality("not-a-number", "128")).toBe("128k");
  });

  it("flac 的常见实际码率区间不被误判成 320k", () => {
    expect(resolveBuiltinMusicApiQuality(700, "740")).toBe("flac");
    expect(resolveBuiltinMusicApiQuality(899, "740")).toBe("flac");
  });
});
