import { describe, expect, it } from "vitest";
import {
  buildNeteasePcCookie,
  buildWyPlaylistSubscribeRequest,
} from "@/services/wyPlaylistSubscribeModel";

describe("wy playlist subscribe model", () => {
  it("builds subscribe and unsubscribe requests with pc cookie", () => {
    expect(buildWyPlaylistSubscribeRequest("123", true)).toEqual({
      path: "/playlist/subscribe",
      payload: { id: "123", t: 1 },
      pcCookie: true,
    });
    expect(buildWyPlaylistSubscribeRequest(456, false)).toEqual({
      path: "/playlist/subscribe",
      payload: { id: "456", t: 2 },
      pcCookie: true,
    });
  });

  it("forces the netease request cookie to pc os", () => {
    expect(buildNeteasePcCookie("MUSIC_U=abc; os=ios; __csrf=token")).toBe(
      "MUSIC_U=abc; __csrf=token; os=pc",
    );
  });
});
