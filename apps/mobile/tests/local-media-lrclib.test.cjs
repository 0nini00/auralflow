const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

const parser = createLoader({})("../../packages/core/src/lyrics/parser.ts");
const outbound = createLoader({})("../../packages/core/src/outbound-host.ts");

// 实测样本：LRCLIB 命中要求 artist_name 只用主歌手且不带 duration，整串署名/不准时长都会 404。
const song = {
  source: "local", isLocal: true, name: "Bad Girl", singer: "吴亦凡/Kris",
  albumName: "专辑", interval: 201.5624939, url: "file:///music/bad-girl.mp3",
};
const body = value => ({ ok: true, status: 200, json: async () => value });
const notFound = { ok: false, status: 404, json: async () => ({}) };

function service(fetchImpl) {
  const calls = { fetch: [], guard: [] };
  const load = createLoader({
    "@lx/core": {
      // 出站守卫走 core 的真实实现（内网/非 http 会抛错），同时记录下来验证它确实被调用。
      assertPublicOutboundUrl: (url, label) => {
        calls.guard.push([url, label]);
        return outbound.assertPublicOutboundUrl(url, label);
      },
      parseLyricSource: parser.parseLyricSource,
    },
    "@/utils/fetchWithTimeout": {
      fetchWithTimeout: async (url, init, timeout) => {
        calls.fetch.push({ url, init, timeout });
        return fetchImpl(url, init);
      },
    },
  });
  return { module: load("src/services/lrclibLyricsService.ts"), calls };
}

test("主歌手按常见分隔符取第一段，全角/别名/feat 都覆盖", () => {
  const { module } = service(async () => notFound);
  assert.equal(module.primaryArtistName("吴亦凡/Kris"), "吴亦凡");
  assert.equal(module.primaryArtistName("甲、乙"), "甲");
  assert.equal(module.primaryArtistName("甲，乙"), "甲");
  assert.equal(module.primaryArtistName("A & B"), "A");
  assert.equal(module.primaryArtistName("甲 feat. 乙"), "甲");
  assert.equal(module.primaryArtistName("甲 ft 乙"), "甲");
  assert.equal(module.primaryArtistName("甲 featuring 乙"), "甲");
  assert.equal(module.primaryArtistName("Rock and Roll Band"), "Rock");
  // 名字里的 and 不是分隔符：只有词边界上的独立单词才切分。
  assert.equal(module.primaryArtistName("Ｓａｎｄｙ"), "Sandy");
  assert.equal(module.primaryArtistName("   "), "");
});

test("首查只用主歌手且不带 duration，命中即解析同步歌词并经过出站校验", async () => {
  const { module, calls } = service(async () => body({ syncedLyrics: "[00:01.00]夜色\n[00:05.50]航线" }));
  const result = await module.readLrclibLyrics(song);
  assert.deepEqual(result, { kind: "lyrics", lines: [{ time: 1, text: "夜色" }, { time: 5.5, text: "航线" }] });
  assert.equal(calls.fetch.length, 1);
  const url = new URL(calls.fetch[0].url);
  assert.equal(url.origin, "https://lrclib.net");
  assert.equal(url.pathname, "/api/get");
  assert.equal(url.searchParams.get("artist_name"), "吴亦凡");
  assert.equal(url.searchParams.get("track_name"), "Bad Girl");
  assert.equal(url.searchParams.has("duration"), false);
  assert.match(calls.fetch[0].init.headers["User-Agent"], /AuralFlow/);
  assert.deepEqual(calls.guard.map(([, label]) => label), ["LRCLIB 歌词查询"]);
  assert.equal(calls.guard[0][0], calls.fetch[0].url);
});

test("未命中后补一次完整署名 + 时长重试，仍无结果才放弃", async () => {
  let count = 0;
  const hit = service(async () => (++count === 1 ? notFound : body({ syncedLyrics: "[00:02.00]重试命中" })));
  const result = await hit.module.readLrclibLyrics(song);
  assert.deepEqual(result, { kind: "lyrics", lines: [{ time: 2, text: "重试命中" }] });
  assert.equal(hit.calls.fetch.length, 2);
  const retry = new URL(hit.calls.fetch[1].url);
  assert.equal(retry.searchParams.get("artist_name"), "吴亦凡/Kris");
  assert.equal(retry.searchParams.get("track_name"), "Bad Girl");
  assert.equal(retry.searchParams.get("duration"), "202");

  const noDuration = service(async () => notFound);
  assert.equal(await noDuration.module.readLrclibLyrics({ ...song, interval: undefined }), null);
  assert.equal(noDuration.calls.fetch.length, 2);
  assert.equal(new URL(noDuration.calls.fetch[1].url).searchParams.has("duration"), false);
});

test("instrumental 命中直接判定纯音乐，不再看歌词字段", async () => {
  const { module } = service(async () => body({ instrumental: true, syncedLyrics: "[00:01.00]不该被采用" }));
  assert.deepEqual(await module.readLrclibLyrics(song), { kind: "instrumental" });
});

test("请求失败、HTML、空内容或无时间轴文本一律静默返回未命中", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("network"); },
    async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("HTML"); } }),
    async () => body({}),
    async () => body({ syncedLyrics: "   ", plainLyrics: "" }),
    // 纯文本没有时间轴，解析器给不出歌词行：与桌面端同样按未命中处理（继续走搜索链）。
    async () => body({ plainLyrics: "没有时间轴的纯文本" }),
  ]) {
    const { module } = service(fetchImpl);
    assert.equal(await module.readLrclibLyrics(song), null);
  }
});

test("缺歌名或歌手不发请求", async () => {
  const { module, calls } = service(async () => body({ syncedLyrics: "[00:01.00]x" }));
  assert.equal(await module.readLrclibLyrics({ ...song, name: "  " }), null);
  assert.equal(await module.readLrclibLyrics({ ...song, singer: "" }), null);
  assert.equal(await module.readLrclibLyrics({ ...song, singer: " / " }), null);
  assert.equal(calls.fetch.length, 0);
});
