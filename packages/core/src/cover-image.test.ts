import { describe, expect, it } from "vitest";

import {
  COVER_TIER_CARD,
  COVER_TIER_FULLSCREEN,
  COVER_TIER_IMMERSIVE,
  COVER_TIER_MAX,
  COVER_TIER_PLAYER,
  COVER_TIER_ROW,
  devicePixelSize,
  coverTierFor,
  coverTierForDisplay,
  resizeCoverUrl,
} from "./cover-image";

/**
 * 锚定「按目标显示尺寸 + DPR 取档」这套分级的边界。
 *
 * 要钉死的两点：
 * - 量化后的边长绝不会小于目标（小于目标就是拿模糊图换带宽，等于降级观感）；
 * - 已知图床的尺寸标记必须真的被改写 —— 网易云走 `?param=`，腾讯图床走文件名里的
 *   `R{W}x{H}`，漏掉任何一边都会退化成「原图直解再缩」，正是这套分级要消灭的情况。
 */
describe("coverTierFor", () => {
  it("取不小于目标的第一个档位", () => {
    expect(coverTierFor(1)).toBe(COVER_TIER_ROW);
    expect(coverTierFor(96)).toBe(96);
    expect(coverTierFor(97)).toBe(COVER_TIER_CARD);
    expect(coverTierFor(150)).toBe(COVER_TIER_CARD);
    expect(coverTierFor(151)).toBe(COVER_TIER_PLAYER);
    expect(coverTierFor(450)).toBe(450);
    expect(coverTierFor(451)).toBe(COVER_TIER_IMMERSIVE);
    expect(coverTierFor(600)).toBe(COVER_TIER_IMMERSIVE);
  });

  it("两端封口：不超过最小档位以下，也不超过整屏上限", () => {
    expect(coverTierFor(0)).toBe(COVER_TIER_ROW);
    expect(coverTierFor(-10)).toBe(COVER_TIER_ROW);
    expect(coverTierFor(Number.NaN)).toBe(COVER_TIER_ROW);
    expect(coverTierFor(1000)).toBe(COVER_TIER_MAX);
    expect(coverTierFor(4000)).toBe(COVER_TIER_FULLSCREEN);
  });
});

describe("coverTierForDisplay", () => {
  it("按 DPR 放大后再取档", () => {
    expect(coverTierForDisplay(56, 1)).toBe(COVER_TIER_ROW);
    expect(coverTierForDisplay(56, 2)).toBe(COVER_TIER_CARD);
    expect(coverTierForDisplay(150, 2)).toBe(COVER_TIER_PLAYER);
    expect(coverTierForDisplay(240, 2)).toBe(COVER_TIER_IMMERSIVE);
    expect(coverTierForDisplay(240, 1)).toBe(COVER_TIER_PLAYER);
    expect(coverTierForDisplay(600, 3)).toBe(COVER_TIER_MAX);
  });

  it("DPR 缺失或异常时按 1 处理，且缩放系数封顶", () => {
    expect(devicePixelSize(56, 0)).toBe(56);
    expect(devicePixelSize(56, Number.NaN)).toBe(56);
    expect(devicePixelSize(100, 8)).toBe(300);
  });
});

describe("resizeCoverUrl", () => {
  it("网易云图床改写 ?param=WxH（已有 param 时替换而不是保留）", () => {
    expect(resizeCoverUrl("https://p1.music.126.net/x.jpg", 150)).toBe(
      "https://p1.music.126.net/x.jpg?param=150y150",
    );
    expect(resizeCoverUrl("https://p1.music.126.net/x.jpg?param=1000y1000", 150)).toBe(
      "https://p1.music.126.net/x.jpg?param=150y150",
    );
    expect(resizeCoverUrl("https://p1.music.126.net/x.jpg?auth=ab&param=1000y1000", 150)).toBe(
      "https://p1.music.126.net/x.jpg?auth=ab&param=150y150",
    );
    expect(resizeCoverUrl("https://p1.music.126.net/x.jpg?param=1000y1000#frag", 150)).toBe(
      "https://p1.music.126.net/x.jpg?param=150y150#frag",
    );
    expect(resizeCoverUrl("https://music.126.net/x.jpg", 300)).toBe(
      "https://music.126.net/x.jpg?param=300y300",
    );
  });

  it("腾讯图床改写文件名里的 R{W}x{H}", () => {
    expect(
      resizeCoverUrl("https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg", 600),
    ).toBe("https://y.gtimg.cn/music/photo_new/T002R800x800M000abc.jpg");
    expect(
      resizeCoverUrl("https://y.gtimg.cn/music/photo_new/T001R800x800M000singer.jpg", 150),
    ).toBe("https://y.gtimg.cn/music/photo_new/T001R150x150M000singer.jpg");
    // 没有尺寸标记时原样返回，不猜
    expect(resizeCoverUrl("https://y.gtimg.cn/music/photo_new/T002abc.jpg", 150)).toBe(
      "https://y.gtimg.cn/music/photo_new/T002abc.jpg",
    );
    // R 标记在 query 里（`?param=R300x300` 这类写法）同样能命中
    expect(resizeCoverUrl("https://y.gtimg.cn/music/photo_new/T002abc.jpg?param=R300x300", 150)).toBe(
      "https://y.gtimg.cn/music/photo_new/T002abc.jpg?param=R150x150",
    );
    expect(resizeCoverUrl("https://c.y.qq.com/x.jpg", 150)).toBe("https://c.y.qq.com/x.jpg");
  });

  it("未知图床、本地路径、data URL 一律不动", () => {
    for (const value of [
      "https://img1.example.com/cover.jpg",
      "http://127.0.0.1:8080/x.jpg",
      "asset://localhost/x.jpg",
      "file:///C:/music/cover.jpg",
      "data:image/jpeg;base64,AAAA",
      "//p1.music.126.net/x.jpg",
      "",
    ]) {
      expect(resizeCoverUrl(value, 150)).toBe(value);
    }
    expect(resizeCoverUrl(null, 150)).toBe("");
    expect(resizeCoverUrl(undefined, 150)).toBe("");
    expect(resizeCoverUrl("https://p1.music.126.net/x.jpg", 0)).toBe(
      "https://p1.music.126.net/x.jpg",
    );
  });

  it("同一目标尺寸反复改写结果稳定（缓存 key 不能漂）", () => {
    const once = resizeCoverUrl("https://p1.music.126.net/x.jpg", 450);
    expect(resizeCoverUrl(once, 450)).toBe(once);
    const tencentOnce = resizeCoverUrl(
      "https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg",
      300,
    );
    expect(resizeCoverUrl(tencentOnce, 300)).toBe(tencentOnce);
  });
});


describe("腾讯图床支持的尺寸", () => {
  it.each([[96, 150], [150, 150], [300, 300], [450, 500], [600, 800], [800, 800]])(
    "将应用档位 %i 映射为受支持的 %i，避免真实图床404", (requested, supported) => {
      const original = "https://y.gtimg.cn/music/photo_new/T002R300x300M0000041WVfh2vtlJE.jpg";
      expect(resizeCoverUrl(original, requested)).toBe(original.replace("R300x300", `R${supported}x${supported}`));
    },
  );
});
