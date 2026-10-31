import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import { mergeSongSearchMetadata } from "../src/services/search/songMetadataMerge";

function song(patch: Partial<MusicInfo> & Pick<MusicInfo, "id" | "name" | "source">): MusicInfo {
  return { singer: "林俊杰", ...patch } as MusicInfo;
}

describe("mergeSongSearchMetadata", () => {
  it("补充封面/专辑，但保留主条目自己的解析身份", () => {
    const primary = song({
      id: "0039MnYb0qxYhV",
      name: "江南",
      source: "tx",
      albumName: "",
      picUrl: "",
    });
    const metadata = song({
      id: "hhM0Y7ctJdxVXaeTA2FtuA==",
      name: "江南",
      source: "tx",
      albumName: "江南",
      picUrl: "https://example.com/cover.jpg",
      gateway: {
        source: "joox",
        trackId: "hhM0Y7ctJdxVXaeTA2FtuA==",
        lyricId: "hhM0Y7ctJdxVXaeTA2FtuA==",
        picId: "f744883bb8f28e01",
      },
    });

    const [merged] = mergeSongSearchMetadata([primary], [metadata]);

    expect(merged.id).toBe("0039MnYb0qxYhV");
    expect(merged.albumName).toBe("江南");
    expect(merged.picUrl).toBe("https://example.com/cover.jpg");
    // 关键：JOOX 的解析身份绝不能挂到 QQ 曲目上，否则会去取别人的录音。
    expect(merged.gateway).toBeUndefined();
  });

  it("主条目自带 gateway 时原样保留", () => {
    const gateway = {
      source: "netease",
      trackId: "2034742057",
      lyricId: "2034742057",
      picId: "2034742057",
    };
    const primary = song({ id: "2034742057", name: "江南", source: "wy", gateway });
    const metadata = song({
      id: "999",
      name: "江南",
      source: "wy",
      gateway: { source: "joox", trackId: "other", lyricId: "other", picId: "other" },
    });

    const [merged] = mergeSongSearchMetadata([primary], [metadata]);

    expect(merged.gateway).toEqual(gateway);
  });

  it("时长差超过容差时不合并，元数据条目原样追加", () => {
    const primary = song({ id: "1", name: "江南", source: "wy", interval: 270 });
    const live = song({ id: "2", name: "江南", source: "wy", interval: 310 });

    const merged = mergeSongSearchMetadata([primary], [live]);

    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe("2");
  });
});
