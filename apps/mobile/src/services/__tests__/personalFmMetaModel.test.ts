import { describe, expect, it } from "vitest";

import { buildPersonalFmMeta } from "@/services/personalFmMetaModel";

describe("personal FM meta model", () => {
  it("uses the account nickname in the logged-in subtitle", () => {
    expect(buildPersonalFmMeta(true, { nickname: "听歌的人" })).toEqual({
      title: "私人 FM",
      subtitle: "正在为 听歌的人 播放推荐曲目",
    });
  });

  it("keeps the existing login prompt when logged out", () => {
    expect(buildPersonalFmMeta(false, null)).toEqual({
      title: "私人 FM",
      subtitle: "登录网易云后即可开始私人 FM。",
    });
  });

  it("falls back to generic copy when the account nickname is missing", () => {
    expect(buildPersonalFmMeta(true, { nickname: "  " }).subtitle).toBe(
      "基于网易云登录态生成的连续电台。",
    );
  });
});
