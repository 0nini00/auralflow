import { describe, expect, it } from "vitest";
import {
  createKugouHiddenSearcher,
  createKuwoHiddenSearcher,
  isInstrumentalVersion,
  matchHiddenCandidates,
  type HiddenSourceTrack,
} from "./hidden-source";

const kuwoResponse = {
  abslist: [
    {
      SONGNAME: "江南",
      ARTIST: "林俊杰",
      ALBUM: "第二天堂",
      ALBUMID: "15772",
      DURATION: "267",
      MUSICRID: "MUSIC_93157",
    },
    {
      SONGNAME: "江南 (Live)",
      ARTIST: "林俊杰",
      ALBUM: "现场",
      ALBUMID: "1",
      DURATION: "300",
      MUSICRID: "MUSIC_2",
    },
    {
      SONGNAME: "江南",
      ARTIST: "其他歌手",
      ALBUM: "翻唱",
      ALBUMID: "2",
      DURATION: "267",
      MUSICRID: "MUSIC_3",
    },
  ],
};

const kugouResponse = {
  data: {
    lists: [
      {
        SongName: "江南 &amp; 烟雨",
        Singers: [{ name: "林俊杰" }, { name: "某歌手" }],
        AlbumName: "第二天堂",
        AlbumID: "123",
        Duration: 267,
        Audioid: "93157",
        FileHash: "HASH_ABC",
        Image: "https://img.example/{size}.jpg",
      },
      {
        SongName: "晴天",
        Singers: [{ name: "周杰伦" }],
        AlbumName: "叶惠美",
        AlbumID: "456",
        Duration: 269,
        Audioid: "102065756",
        FileHash: "HASH_DEF",
      },
    ],
  },
};

function fetchTextOf(payload: unknown) {
  return async () => JSON.stringify(payload);
}

describe("createKuwoHiddenSearcher", () => {
  it("maps search rows to hidden tracks with duration and album metadata", async () => {
    const searcher = createKuwoHiddenSearcher(fetchTextOf(kuwoResponse));
    const tracks = await searcher.search("江南");

    expect(tracks).toHaveLength(3);
    expect(tracks[0]).toMatchObject({
      source: "kw",
      id: "93157",
      name: "江南",
      singer: "林俊杰",
      albumName: "第二天堂",
      interval: 267,
      extra: { albumId: "15772", albumMid: "15772" },
    });
  });

  it("returns an empty list for malformed responses", async () => {
    const searcher = createKuwoHiddenSearcher(async () => JSON.stringify({ abslist: null }));
    await expect(searcher.search("江南")).resolves.toEqual([]);
  });
});

describe("createKugouHiddenSearcher", () => {
  it("maps kugou rows and keeps the hash used by LX scripts", async () => {
    const searcher = createKugouHiddenSearcher(fetchTextOf(kugouResponse));
    const tracks = await searcher.search("江南");

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      source: "kg",
      id: "93157",
      name: "江南 & 烟雨",
      singer: "林俊杰、某歌手",
      albumName: "第二天堂",
      interval: 267,
      picUrl: "https://img.example/480.jpg",
      extra: { hash: "HASH_ABC", albumId: "123", albumMid: "123" },
    });
  });

  it("flattens grouped variants", async () => {
    const searcher = createKugouHiddenSearcher(
      fetchTextOf({
        data: {
          lists: [
            {
              SongName: "江南",
              Singers: [{ name: "林俊杰" }],
              Audioid: "A",
              FileHash: "H1",
              Grp: [
                { SongName: "江南", Singers: [{ name: "林俊杰" }], Audioid: "A2", FileHash: "H2" },
              ],
            },
          ],
        },
      }),
    );
    const tracks = await searcher.search("江南");
    expect(tracks.map((track) => track.id)).toEqual(["A", "A2"]);
  });
});

describe("matchHiddenCandidates", () => {
  const song = { name: "江南", singer: "林俊杰", interval: 267 };

  it("keeps the same song and rejects singer or duration mismatches", () => {
    const tracks: HiddenSourceTrack[] = [
      { source: "kw", id: "3", name: "江南", singer: "其他歌手", interval: 267 },
      { source: "kw", id: "2", name: "江南 (Live)", singer: "林俊杰", interval: 300 },
      { source: "kw", id: "1", name: "江南", singer: "林俊杰", interval: 267 },
    ];

    expect(matchHiddenCandidates(song, tracks).map((track) => track.id)).toEqual(["1"]);
  });

  it("sorts by duration delta and exact singer before search order", () => {
    const tracks: HiddenSourceTrack[] = [
      { source: "kg", id: "far", name: "江南", singer: "林俊杰、他人", interval: 270 },
      { source: "kg", id: "exact", name: "江南", singer: "林俊杰", interval: 269 },
      { source: "kg", id: "closest", name: "江南", singer: "他人、林俊杰", interval: 267 },
    ];

    expect(matchHiddenCandidates(song, tracks).map((track) => track.id)).toEqual([
      "closest",
      "exact",
      "far",
    ]);
  });

  it("allows rows without duration but never without an overlapping singer", () => {
    const tracks: HiddenSourceTrack[] = [
      { source: "kw", id: "no-duration", name: "江南", singer: "林俊杰" },
      { source: "kw", id: "wrong-singer", name: "江南", singer: "别人" },
    ];

    expect(matchHiddenCandidates(song, tracks).map((track) => track.id)).toEqual(["no-duration"]);
  });

  it("returns an empty list when the target has no usable name or singer", () => {
    expect(matchHiddenCandidates({ name: "", singer: "林俊杰" }, [])).toEqual([]);
    expect(matchHiddenCandidates({ name: "江南", singer: "" }, [])).toEqual([]);
  });

  it("dedupes repeated platform rows by source and id after matching", () => {
    const tracks: HiddenSourceTrack[] = [
      // 同一首曲的平台重复行（不同码率条目），只应尝试一次
      { source: "kg", id: "1", name: "江南", singer: "林俊杰", interval: 267 },
      { source: "kg", id: "1", name: "江南", singer: "林俊杰", interval: 268 },
      // 同 id 但歌手不匹配的行先出现，不能因此吞掉后面真正匹配的行
      { source: "kw", id: "9", name: "江南", singer: "别人", interval: 267 },
      { source: "kw", id: "9", name: "江南", singer: "林俊杰", interval: 267 },
    ];

    expect(matchHiddenCandidates(song, tracks).map((track) => `${track.source}:${track.id}`)).toEqual([
      "kg:1",
      "kw:9",
    ]);
  });

  it("ranks vocal versions above instrumentals even when the duration matches exactly", () => {
    const tracks: HiddenSourceTrack[] = [
      // 伴奏时长与目标完全一致，人声版差 3s：只按时长差排序会让伴奏抢到首位
      { source: "kw", id: "inst", name: "江南 (自制版伴奏)", singer: "林俊杰", interval: 267 },
      { source: "kw", id: "studio", name: "江南", singer: "林俊杰", interval: 270 },
    ];

    expect(matchHiddenCandidates(song, tracks).map((track) => track.id)).toEqual(["studio", "inst"]);
  });

  it("recognizes english instrumental markers", () => {
    const tracks: HiddenSourceTrack[] = [
      { source: "kg", id: "off-vocal", name: "江南 (Off Vocal)", singer: "林俊杰", interval: 267 },
      { source: "kg", id: "inst", name: "江南 (Instrumental)", singer: "林俊杰", interval: 267 },
      { source: "kg", id: "vocal", name: "江南", singer: "林俊杰", interval: 268 },
    ];

    expect(matchHiddenCandidates(song, tracks).map((track) => track.id)).toEqual([
      "vocal",
      "off-vocal",
      "inst",
    ]);
  });

  it("still keeps instrumentals when no vocal version exists", () => {
    const tracks: HiddenSourceTrack[] = [
      { source: "kw", id: "only-inst", name: "江南 (伴奏)", singer: "林俊杰", interval: 267 },
    ];

    expect(matchHiddenCandidates(song, tracks).map((track) => track.id)).toEqual(["only-inst"]);
  });

  it("does not penalize instrumentals when the requested song is itself an instrumental", () => {
    const karaokeSong = { name: "江南 (伴奏)", singer: "林俊杰", interval: 267 };
    const tracks: HiddenSourceTrack[] = [
      { source: "kw", id: "vocal", name: "江南", singer: "林俊杰", interval: 271 },
      { source: "kw", id: "inst", name: "江南 (伴奏)", singer: "林俊杰", interval: 267 },
    ];

    // 用户点的就是伴奏：不能把伴奏降权，否则正确版本会被自己的人声版挤到后面
    expect(matchHiddenCandidates(karaokeSong, tracks).map((track) => track.id)).toEqual(["inst", "vocal"]);
  });

  it("detects instrumental markers only on real version text", () => {
    for (const name of ["江南 (伴奏)", "江南（纯音乐）", "江南 [Instrumental]", "江南 (Off-Vocal)", "江南 (卡拉OK)"]) {
      expect(isInstrumentalVersion(name), name).toBe(true);
    }
    for (const name of ["江南", "江南 (Live)", "江南 (2011音乐万万岁现场)", "江南 (Acoustic)", "Instrument"]) {
      expect(isInstrumentalVersion(name), name).toBe(false);
    }
  });
});

describe("hidden source robustness", () => {
  it("normalizes non-positive platform durations as missing", async () => {
    const searcher = createKuwoHiddenSearcher(
      fetchTextOf({
        abslist: [{ SONGNAME: "晴天", ARTIST: "周杰伦", DURATION: "-1", MUSICRID: "MUSIC_1" }],
      }),
    );
    const tracks = await searcher.search("晴天");
    expect(tracks[0].interval).toBeUndefined();
  });

  it("keeps a candidate whose platform duration is unknown", () => {
    const song = { name: "晴天", singer: "周杰伦", interval: 269 };
    const tracks: HiddenSourceTrack[] = [
      { source: "kw", id: "1", name: "晴天", singer: "周杰伦", interval: -1 },
    ];
    expect(matchHiddenCandidates(song, tracks).map((track) => track.id)).toEqual(["1"]);
  });

  it("ignores out-of-range html entities instead of throwing", async () => {
    const searcher = createKugouHiddenSearcher(
      fetchTextOf({
        data: {
          lists: [
            {
              SongName: "晴天&#999999999;",
              Singers: [{ name: "周杰伦" }],
              Audioid: "1",
              FileHash: "HASH",
              Duration: 269,
            },
          ],
        },
      }),
    );
    const tracks = await searcher.search("晴天");
    expect(tracks[0].name).toBe("晴天");
  });
});
