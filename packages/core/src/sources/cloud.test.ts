import { describe, expect, it } from "vitest";

import { cloudFileExtension, cloudQualityLabel, toCloudMusicInfo, toCloudMusicInfos } from "./cloud";

/**
 * 这套用例锚定 `toCloudMusicInfo` 的映射契约——两端播放与列表都吃它的输出，
 * 任何一处字段取错都会表现为「云盘里有一首点不动的歌」或「时长/封面丢失」。
 *
 * 样本直接取自 2026-10 实测的真实响应（账号内 161 条）截断后的形状。
 */

const MATCHED_ITEM = {
  privateCloud: {
    songId: 27694142,
    bitrate: 1681,
    fileName: "他和她 - 回音哥.flac",
    fileSize: 48781208,
    originalAudioSongId: 3364659151,
  },
  simpleSong: {
    id: 27694142,
    name: "他和她",
    dt: 229067,
    fee: 1,
    ar: [{ name: "回音哥" }],
    al: { name: "重定义", picUrl: "http://p2.music.126.net/x.jpg" },
  },
  songId: 27694142,
  songName: "他和她",
  bitrate: 1681,
  fileSize: 48781208,
  fileName: "他和她 - 回音哥.flac",
  matchType: "matched",
};

describe("toCloudMusicInfo", () => {
  it("把已匹配条目映射成可播放的 wy 条目，并带上云盘标记", () => {
    const music = toCloudMusicInfo(MATCHED_ITEM);

    expect(music).not.toBeNull();
    expect(music).toMatchObject({
      id: "27694142",
      name: "他和她",
      singer: "回音哥",
      albumName: "重定义",
      source: "wy",
      // dt 是毫秒，interval 必须是秒——写错会让试听判定拿到 229067 秒的期望时长
      interval: 229,
      picUrl: "http://p2.music.126.net/x.jpg",
      // 两端播放链路靠这个开关跳过网关/自定义源与试听判定
      wyCloud: true,
    });
    expect(music?.cloudMeta).toEqual({
      bitrate: 1681,
      fileName: "他和她 - 回音哥.flac",
      size: 48781208,
      matchStatus: "matched",
    });
  });

  it("未匹配条目同样可播，但 matchStatus 记成 unmatched", () => {
    const music = toCloudMusicInfo({
      ...MATCHED_ITEM,
      matchType: "unmatched",
    });

    expect(music?.wyCloud).toBe(true);
    expect(music?.cloudMeta?.matchStatus).toBe("unmatched");
  });

  it("匹配状态未知时不臆造取值", () => {
    const music = toCloudMusicInfo({ ...MATCHED_ITEM, matchType: undefined });
    expect(music?.cloudMeta?.matchStatus).toBeUndefined();
  });

  it("缺少 id 返回 null —— 这类记录无法取链，不能混进列表冒充可播放项", () => {
    expect(toCloudMusicInfo({ songName: "没有 id" })).toBeNull();
    expect(toCloudMusicInfo({ songId: 0, songName: "id 为 0" })).toBeNull();
    expect(toCloudMusicInfo({ songId: "", songName: "id 为空串" })).toBeNull();
  });

  it("缺少歌名返回 null", () => {
    expect(toCloudMusicInfo({ songId: 123 })).toBeNull();
  });

  it("容忍 null / 非对象输入", () => {
    expect(toCloudMusicInfo(null)).toBeNull();
    expect(toCloudMusicInfo(undefined)).toBeNull();
    expect(toCloudMusicInfos(null)).toEqual([]);
    expect(toCloudMusicInfos([{ songId: 1, songName: "a" }, { songId: 2 }])).toHaveLength(1);
  });

  it("多歌手按 / 拼接，缺失时回退到未知歌手", () => {
    const music = toCloudMusicInfo({
      songId: 2009386221,
      songName: "私奔（简薇）",
      simpleSong: {
        id: 2009386221,
        name: "私奔（简薇）",
        dt: 309543,
        ar: [{ name: "何涛" }, { name: "蜜蜂少女音" }],
        al: { name: "我的26岁女房客同人曲" },
      },
    });
    expect(music?.singer).toBe("何涛/蜜蜂少女音");

    const unknown = toCloudMusicInfo({ songId: 1, songName: "x", simpleSong: { id: 1, name: "x" } });
    expect(unknown?.singer).toBe("未知歌手");
  });

  it("封面只认 simpleSong.al.picUrl，不吃数字型 cover id", () => {
    const music = toCloudMusicInfo({
      songId: 1,
      songName: "x",
      cover: 630940946689,
      simpleSong: { id: 1, name: "x" },
    });
    expect(music?.picUrl).toBeUndefined();
  });

  it("时长缺失时 interval 留空而不是 0 —— 0 会被 isPreviewStream 当成无效期望时长", () => {
    const music = toCloudMusicInfo({ songId: 1, songName: "x", simpleSong: { id: 1, name: "x" } });
    expect(music?.interval).toBeUndefined();
  });
});

describe("cloudQualityLabel", () => {
  it("按真实码率给出诚实标签", () => {
    expect(cloudQualityLabel(128)).toBe("128k");
    expect(cloudQualityLabel(320)).toBe("320k");
    expect(cloudQualityLabel(944)).toBe("无损");
    expect(cloudQualityLabel(2987)).toBe("Hi-Res");
    expect(cloudQualityLabel(0)).toBeUndefined();
    expect(cloudQualityLabel(undefined)).toBeUndefined();
  });
});

describe("cloudFileExtension", () => {
  it("取上传文件的真实扩展名，而不是请求档位", () => {
    // 请求 320k 也可能拿到用户上传的 FLAC：扩展名必须跟着文件走
    expect(
      cloudFileExtension({
        wyCloud: true,
        cloudMeta: { fileName: "他和她 - 回音哥.flac", bitrate: 1681 },
      }),
    ).toBe("flac");
  });

  it("大写扩展名归一化", () => {
    expect(
      cloudFileExtension({ wyCloud: true, cloudMeta: { fileName: "Track.FLAC" } }),
    ).toBe("flac");
  });

  it("文件名缺失 / 无扩展名 / 非音频扩展名时返回 undefined", () => {
    expect(cloudFileExtension({ wyCloud: true, cloudMeta: {} })).toBeUndefined();
    expect(
      cloudFileExtension({ wyCloud: true, cloudMeta: { fileName: "no-extension" } }),
    ).toBeUndefined();
    expect(
      cloudFileExtension({ wyCloud: true, cloudMeta: { fileName: "cover.jpg" } }),
    ).toBeUndefined();
  });

  it("非云盘曲不参与该推断", () => {
    expect(
      cloudFileExtension({ wyCloud: false, cloudMeta: { fileName: "a.flac" } }),
    ).toBeUndefined();
    expect(cloudFileExtension({ cloudMeta: { fileName: "a.flac" } })).toBeUndefined();
  });
});
