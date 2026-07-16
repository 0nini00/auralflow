import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSearchSuggestions } from "@/services/searchSuggestionService";

function jsonResponse(body: unknown): Response {
  return {
    json: () => Promise.resolve(body),
  } as Response;
}

describe("search suggestion service", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes playlist suggestions from the Netease suggest response", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
      code: 200,
      result: {
        playlists: [
          { name: "适合夜晚听的歌", creator: { nickname: "creator" } },
        ],
      },
    }))));

    await expect(getSearchSuggestions("夜晚")).resolves.toContainEqual({
      keyword: "适合夜晚听的歌",
      type: "playlist",
    });
  });
});
