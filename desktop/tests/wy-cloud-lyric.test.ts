import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

/**
 * 云盘曲取歌词的回归测试。
 *
 * 背景：云盘条目的数字 id 是「云盘条目 id」，歌词接口对它只回占位词
 * `{ lrc: { lyric: "[00:00.00]暂无歌词" }, uncollected: true }`；真正的歌词挂在
 * 线上曲目那条记录上（用户反馈「网易云客户端有词，AuralFlow 没有」）。
 *
 * 这里把 eapi 的 fetch 拦下来换成立即返回的假响应，覆盖三件事：
 * 1. 占位词时按元数据去 cloudsearch 找同一份录音，并取它的歌词；
 * 2. 翻唱排在搜索结果前面时不误取（宁可没词也不给错词）；
 * 3. 占位词本身绝不能被当成歌词返回。
 */

const EAPI_KEY = "e82ckenh8dichen8";

const state = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; data: Record<string, unknown> }>,
  handlers: new Map<string, (data: Record<string, unknown>) => unknown>(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async (_url: string, init: { body?: string }) => {
    const CryptoJS = (await import("crypto-js")).default;
    const params = decodeURIComponent(String(init.body ?? "").replace(/^params=/, ""));
    const plain = CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Hex.parse(params) }),
      CryptoJS.enc.Utf8.parse(EAPI_KEY),
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
    ).toString(CryptoJS.enc.Utf8);
    // 明文形状：`${url}-36cd479b6b5-${json}-36cd479b6b5-${md5}`
    const [path, json] = plain.split("-36cd479b6b5-");
    const data = JSON.parse(json) as Record<string, unknown>;
    state.requests.push({ path, data });
    const handler = state.handlers.get(path);
    const payload = handler ? handler(data) : { code: 200 };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  },
}));

vi.mock("@/services/wyAccountService", () => ({
  getWyCookie: async () => "MUSIC_U=test",
}));

vi.mock("@lx/tauri-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lx/tauri-bridge")>()),
  debugLog: () => undefined,
}));

const { wyProvider } = await import("../src/services/sources/wyProvider");

const LYRIC_PATH = "/api/song/lyric/v1";
const SEARCH_PATH = "/api/cloudsearch/pc";
/** 云盘条目：id 是云盘条目 id，服务端对它只回占位词。 */
function cloudSong(patch: Partial<MusicInfo> = {}): MusicInfo {
  return {
    id: "2117337923",
    name: "雨下一整晚",
    singer: "周杰伦",
    albumName: "跨时代",
    source: "wy",
    interval: 256,
    wyCloud: true,
    ...patch,
  };
}

function onlineSong(id: string, patch: Partial<Record<string, unknown>> = {}) {
  return { id, name: "雨下一整晚", ar: [{ name: "周杰伦" }], al: { name: "跨时代" }, dt: 256000, ...patch };
}

const PLACEHOLDER = { lrc: { lyric: "[00:00.00]暂无歌词" }, uncollected: true };

beforeEach(() => {
  state.requests.length = 0;
  state.handlers.clear();
});

describe("wyProvider.getLyric（云盘曲）", () => {
  it("占位词时按元数据命中线上曲目并取它的歌词", async () => {
    state.handlers.set(LYRIC_PATH, (data) =>
      data.id === 2117337923
        ? PLACEHOLDER
        : { lrc: { lyric: "[00:01.00]街灯下的橱窗" }, tlyric: { lyric: "[00:01.00]Under the streetlight" } },
    );
    state.handlers.set(SEARCH_PATH, () => ({
      code: 200,
      result: { songs: [onlineSong("2160518331")] },
    }));

    const result = await wyProvider.getLyric(cloudSong());

    expect(result.lyric).toContain("街灯下的橱窗");
    expect(result.tlyric).toContain("Under the streetlight");
    // 第一次歌词请求打的是云盘条目 id，第二次打的是线上曲目 id。
    const lyricIds = state.requests.filter((r) => r.path === LYRIC_PATH).map((r) => r.data.id);
    expect(lyricIds).toEqual([2117337923, 2160518331]);
    expect(state.requests.some((r) => r.path === SEARCH_PATH)).toBe(true);
  });

  it("翻唱排在搜索结果前面时跳过，只认同一份录音", async () => {
    state.handlers.set(LYRIC_PATH, (data) =>
      data.id === 2117337923 ? PLACEHOLDER : { lrc: { lyric: "[00:01.00]街灯下的橱窗" } },
    );
    state.handlers.set(SEARCH_PATH, () => ({
      code: 200,
      result: {
        songs: [
          onlineSong("901", { ar: [{ name: "叶湘伦" }] }), // 同歌名不同歌手
          onlineSong("902", { ar: [{ name: "周杰伦" }], dt: 300000 }), // 时长差 44s，不是同一份录音
          onlineSong("2160518331"),
        ],
      },
    }));

    const result = await wyProvider.getLyric(cloudSong());

    expect(result.lyric).toContain("街灯下的橱窗");
    const lyricIds = state.requests.filter((r) => r.path === LYRIC_PATH).map((r) => r.data.id);
    expect(lyricIds).toEqual([2117337923, 2160518331]);
  });

  it("严格匹配无果时返回空歌词，绝不把占位词当歌词", async () => {
    state.handlers.set(LYRIC_PATH, () => PLACEHOLDER);
    state.handlers.set(SEARCH_PATH, () => ({
      code: 200,
      result: { songs: [onlineSong("901", { ar: [{ name: "别人" }] })] },
    }));

    const result = await wyProvider.getLyric(cloudSong());

    expect(result).toEqual({});
  });

  it("普通在线曲的占位词不做元数据匹配（不去搜别人的歌）", async () => {
    state.handlers.set(LYRIC_PATH, () => PLACEHOLDER);

    const result = await wyProvider.getLyric(cloudSong({ wyCloud: false }));

    expect(result).toEqual({});
    expect(state.requests.every((r) => r.path === LYRIC_PATH)).toBe(true);
  });
});
