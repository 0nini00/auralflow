import { describe, expect, it } from "vitest";
import { getCustomSourcePlaybackQualities } from "./model";

const requested = ["flac24bit", "flac", "320k", "128k"];
describe("自定义源候选能力筛选", () => {
  it("还没有能力元数据的脚本仍可初始化并尝试", () => {
    expect(getCustomSourcePlaybackQualities({}, "wy", requested)).toEqual(requested);
  });
  it("已声明能力但不包含当前平台时不占用取链名额", () => {
    expect(getCustomSourcePlaybackQualities({ sources: { kw: { type: "music", actions: ["musicUrl"], qualitys: ["flac"] } } }, "wy", requested)).toEqual([]);
    expect(getCustomSourcePlaybackQualities({ sources: {} }, "wy", requested)).toEqual([]);
  });
  it("只支持歌词的源不参与播放解析", () => {
    expect(getCustomSourcePlaybackQualities({ sources: { wy: { type: "music", actions: ["lyric"], qualitys: [] } } }, "wy", requested)).toEqual([]);
  });
  it("仅发声明支持的音质，保留用户请求顺序且不修改输入", () => {
    const input = [...requested];
    expect(getCustomSourcePlaybackQualities({ sources: { wy: { type: "music", actions: ["musicUrl"], qualitys: ["128k", "flac"] } } }, "wy", input)).toEqual(["flac", "128k"]);
    expect(input).toEqual(requested);
  });
  it("支持取链但未限制音质的脚本保留请求音质", () => {
    expect(getCustomSourcePlaybackQualities({ sources: { wy: { type: "music", actions: ["musicUrl"], qualitys: [] } } }, "wy", requested)).toEqual(requested);
  });
});
