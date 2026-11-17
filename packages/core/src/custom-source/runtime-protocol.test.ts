import { describe, expect, it } from "vitest";
import type { MusicInfo } from "../sources/types";
import {
  buildCustomSourceMusicUrlRequest,
  normalizeCustomSourceInitSources,
  normalizeCustomSourceUpdateAlert,
  readCustomSourceMusicUrlResult,
  toCustomSourceRuntimeRequestResult,
  toLxMusicInfo,
  type CustomSourceRuntimeRequestPayload,
} from "./runtime-protocol";

const song: MusicInfo = { id: "1", source: "wy", name: "测试曲", singer: "歌手", albumName: "专辑", interval: 200 };

describe("normalizeCustomSourceInitSources", () => {
  it("只保留白名单里的平台、动作与音质，并按白名单顺序输出", () => {
    expect(
      normalizeCustomSourceInitSources({
        sources: {
          wy: { type: "music", actions: ["lyric", "musicUrl"], qualitys: ["flac", "128k", "master"] },
          mg: { type: "music", actions: ["musicUrl"], qualitys: ["128k"] },
          local: { type: "music", actions: ["pic", "lyric", "musicUrl"], qualitys: ["128k"] },
        },
      }),
    ).toEqual({
      wy: { type: "music", actions: ["musicUrl"], qualitys: ["128k", "flac"] },
      local: { type: "music", actions: ["musicUrl", "lyric", "pic"], qualitys: [] },
    });
  });

  it("类型不是 music 或缺少声明的平台被丢弃，空输入得到空清单", () => {
    expect(normalizeCustomSourceInitSources({ sources: { tx: { type: "video", actions: ["musicUrl"], qualitys: [] } } })).toEqual({});
    expect(normalizeCustomSourceInitSources({ sources: { tx: { type: "music" } } })).toEqual({
      tx: { type: "music", actions: [], qualitys: [] },
    });
    expect(normalizeCustomSourceInitSources(null)).toEqual({});
    expect(normalizeCustomSourceInitSources(undefined)).toEqual({});
  });
});

describe("normalizeCustomSourceUpdateAlert", () => {
  it("日志必须是非空字符串", () => {
    expect(normalizeCustomSourceUpdateAlert(null)).toBeUndefined();
    expect(normalizeCustomSourceUpdateAlert("有更新")).toBeUndefined();
    expect(normalizeCustomSourceUpdateAlert({ log: "   " })).toBeUndefined();
    expect(normalizeCustomSourceUpdateAlert({ log: 1 })).toBeUndefined();
  });

  it("更新地址只接受不超长的 http(s)，否则丢弃地址但保留日志", () => {
    expect(normalizeCustomSourceUpdateAlert({ log: "新版本", updateUrl: "https://example.com/a.js" })).toEqual({
      log: "新版本",
      updateUrl: "https://example.com/a.js",
    });
    expect(normalizeCustomSourceUpdateAlert({ log: "新版本", updateUrl: "javascript:alert(1)" })).toEqual({ log: "新版本", updateUrl: undefined });
    expect(normalizeCustomSourceUpdateAlert({ log: "新版本", updateUrl: `https://example.com/${"a".repeat(1024)}` })?.updateUrl).toBeUndefined();
  });

  it("超长日志截断到 1024 字符并加省略号", () => {
    expect(normalizeCustomSourceUpdateAlert({ log: "x".repeat(2000) })?.log).toBe(`${"x".repeat(1024)}...`);
  });
});

describe("toLxMusicInfo", () => {
  it("普通曲目：songmid 与 songId 都取曲目 id", () => {
    expect(toLxMusicInfo(song)).toEqual({
      name: "测试曲",
      singer: "歌手",
      source: "wy",
      songmid: "1",
      songId: "1",
      interval: 200,
      albumName: "专辑",
      albumId: "",
      albumMid: "",
      strMediaMid: "",
      img: "",
      types: [],
      _types: {},
      typeUrl: {},
    });
  });

  it("tx 曲目带上 strMediaMid / 专辑 mid，songId 与 songmid 是两个值", () => {
    const tx: MusicInfo = {
      ...song,
      id: "0039MnYb0qxYhV",
      source: "tx",
      picUrl: "https://example.com/cover.jpg",
      txMeta: { songId: "97773", strMediaMid: "media-mid", albumMid: "album-mid" },
    };
    expect(toLxMusicInfo(tx)).toMatchObject({
      songmid: "0039MnYb0qxYhV",
      songId: "97773",
      albumId: "album-mid",
      albumMid: "album-mid",
      strMediaMid: "media-mid",
      img: "https://example.com/cover.jpg",
    });
  });

  it("隐藏平台请求覆盖来源与曲目元数据，extra 不能盖掉协议字段", () => {
    const info = toLxMusicInfo(
      { ...song, source: "tx", txMeta: { albumMid: "tx-album" } },
      {
        source: "kg",
        songmid: "kg-audio-id",
        interval: 267,
        albumName: "平台专辑",
        picUrl: "https://example.com/kg.jpg",
        extra: { hash: "ABCDEF", albumId: 123, name: "平台返回的名字", songmid: "should-not-win" },
      },
    );
    expect(info).toMatchObject({
      hash: "ABCDEF",
      name: "测试曲",
      source: "kg",
      songmid: "kg-audio-id",
      songId: "kg-audio-id",
      interval: 267,
      albumName: "平台专辑",
      img: "https://example.com/kg.jpg",
      // 专辑 id 例外：平台值优先于 tx 的专辑 mid
      albumId: 123,
      albumMid: 123,
    });
  });
});

describe("buildCustomSourceMusicUrlRequest", () => {
  const sources = { wy: { type: "music" as const, actions: ["musicUrl"], qualitys: ["128k", "320k"] } };

  it("构造 musicUrl 请求，音质放进 info.type", () => {
    expect(buildCustomSourceMusicUrlRequest(sources, song, "320k")).toEqual({
      source: "wy",
      action: "musicUrl",
      info: { type: "320k", musicInfo: toLxMusicInfo(song) },
    });
  });

  it("平台来源以 platformRequest 为准，而不是曲目的 UI 来源", () => {
    const kw = { kw: { type: "music" as const, actions: ["musicUrl"], qualitys: [] } };
    expect(buildCustomSourceMusicUrlRequest(kw, song, "flac", { source: "kw", songmid: "9" })).toMatchObject({
      source: "kw",
      info: { type: "flac", musicInfo: { source: "kw", songmid: "9" } },
    });
    expect(() => buildCustomSourceMusicUrlRequest(kw, song, "128k")).toThrow("音源不支持 wy 的播放链接解析");
  });

  it("未声明该平台、未声明 musicUrl 或音质不在声明内时拒绝", () => {
    expect(() => buildCustomSourceMusicUrlRequest(undefined, song, "128k")).toThrow("音源不支持 wy 的播放链接解析");
    expect(() =>
      buildCustomSourceMusicUrlRequest({ wy: { type: "music", actions: [], qualitys: ["128k"] } }, song, "128k"),
    ).toThrow("音源不支持 wy 的播放链接解析");
    expect(() => buildCustomSourceMusicUrlRequest(sources, song, "flac")).toThrow("音源不支持 flac 音质");
  });
});

describe("toCustomSourceRuntimeRequestResult", () => {
  const payload: CustomSourceRuntimeRequestPayload = { source: "wy", action: "musicUrl", info: { type: "128k" } };

  it("musicUrl 只接受长度受限的 http(s) 字符串", () => {
    expect(toCustomSourceRuntimeRequestResult(payload, "https://example.com/song.mp3")).toEqual({
      source: "wy",
      action: "musicUrl",
      data: { type: "128k", url: "https://example.com/song.mp3" },
    });
    for (const bad of [undefined, null, 42, { url: "https://example.com" }, "ftp://example.com/a.mp3", `https://example.com/${"a".repeat(2048)}`]) {
      expect(() => toCustomSourceRuntimeRequestResult(payload, bad)).toThrow("自定义音源没有返回可播放 URL");
    }
  });

  it("其余动作原样透传脚本返回值", () => {
    expect(toCustomSourceRuntimeRequestResult({ ...payload, action: "lyric" }, "[00:00.00]歌词")).toEqual({
      source: "wy",
      action: "lyric",
      data: "[00:00.00]歌词",
    });
  });
});

describe("readCustomSourceMusicUrlResult", () => {
  it("脚本回报了实际音质就用它，否则沿用请求的音质", () => {
    expect(readCustomSourceMusicUrlResult({ source: "wy", action: "musicUrl", data: { url: "https://a/b", type: "320k" } }, "128k")).toEqual({
      url: "https://a/b",
      quality: "320k",
    });
    expect(readCustomSourceMusicUrlResult({ source: "wy", action: "musicUrl", data: { url: "https://a/b" } }, "128k").quality).toBe("128k");
  });

  it("应答里没有地址时拒绝", () => {
    expect(() => readCustomSourceMusicUrlResult({ source: "wy", action: "musicUrl", data: {} }, "128k")).toThrow("自定义音源没有返回可播放 URL");
    expect(() => readCustomSourceMusicUrlResult({ source: "wy", action: "musicUrl", data: "https://a/b" }, "128k")).toThrow();
  });
});
