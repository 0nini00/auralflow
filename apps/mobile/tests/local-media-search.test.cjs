const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createLoader, deferred, mobileRequire, mobileRoot } = require("./helpers/loadTs.cjs");

const core = createLoader({})("../../packages/core/src/lyrics/parser.ts");
// 判定已收敛到 @lx/core（移动端原 localMediaMatchModel 已删除），用例直接加载 core 的真实实现，
// 不再依赖移动端副本，避免「两端各有一套判定」的历史问题。
const matcher = createLoader({})("../../packages/core/src/local-media-match.ts");
const LYRICS = [{ time: 0, text: "夜色中的航线", tr: "A route in the night" }];
const COVER = "https://example.test/cover.jpg";
const local = (extra = {}) => ({
  id: "local:/private/music/night.flac", source: "local", isLocal: true,
  name: "夜航", singer: "林舟", albumName: "星图", interval: 210,
  url: "file:///private/music/night.flac", localPath: "/private/music/night.flac", ...extra,
});
const online = (extra = {}) => ({
  id: "wy-1", source: "wy", name: "夜航", singer: "林舟", albumName: "星图",
  interval: 210, ...extra,
});
const tx = (extra = {}) => online({ source: "tx", id: "qq-native-mid", ...extra });

/**
 * 唯一的边界替换是 musicApi、LRCLIB 与 core：**没有** fetchWithTimeout 之类出站依赖的 mock，
 * 一旦有人给本服务重新接回封面抓取，模块图会直接以 Unmocked import 失败——删掉的能力不会偷偷长回来。
 */
function harness({
  results = {}, gatewayResults = {}, lyrics = async () => LYRICS, gatewayLyrics = lyrics,
  // LRCLIB 默认未命中：绝大多数用例走「LRCLIB 空手 → wy/tx 搜索链」。
  lrclib = async () => null,
} = {}) {
  const calls = { search: [], gatewaySearch: [], lyrics: [], directLyrics: [], gatewayLyrics: [], lrclib: [] };
  const load = createLoader({
    "./musicApi": {
      searchSongs: async (source, keyword) => {
        calls.search.push([source, keyword]);
        const result = results[source] ?? [];
        if (typeof result === "function") return result();
        if (result instanceof Error) throw result;
        return result;
      },
      searchGatewaySongs: async (source, keyword) => {
        calls.gatewaySearch.push([source, keyword]);
        const result = gatewayResults[source] ?? [];
        if (result instanceof Error) throw result;
        return result;
      },
      getLyrics: async (song) => { calls.lyrics.push(song); calls.directLyrics.push(song); return lyrics(song); },
      getGatewayLyrics: async (song) => { calls.lyrics.push(song); calls.gatewayLyrics.push(song); return gatewayLyrics(song); },
      searchAll: () => assert.fail("不得调用 searchAll"),
    },
    "@lx/core": { ...matcher, ...core },
    "./lrclibLyricsService": {
      readLrclibLyrics: async (song) => { calls.lrclib.push(song); return lrclib(song); },
      LRCLIB_ORIGIN_SOURCE: "lrclib",
    },
  });
  const service = load("src/services/localMediaSearchService.ts");
  return { service, find: service.findLocalMediaAssets, calls };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
}

function assertNoAssets(result, status) {
  assert.equal(result.status, status);
  assert.equal(result.candidate, undefined);
  assert.equal(result.lyrics, undefined);
}

function assertIssue(result, pattern) {
  assert.ok(result.issues.some(issue => pattern.test(issue)), JSON.stringify(result.issues));
}

test("按纯歌名并行搜索两个内置源，不修改本地身份或音频", async () => {
  const wy = deferred();
  const qq = deferred();
  const input = Object.freeze(local({ name: " 夜航 ", gateway: Object.freeze({ source: "private", trackId: "local-secret" }) }));
  const candidate = Object.freeze(online({ id: "wy-1", picUrl: COVER, gateway: { source: "netease", trackId: "wy-1", lyricId: "wy-1", picId: "picture-id" } }));
  const h = harness({ results: { wy: () => wy.promise, tx: () => qq.promise } });
  const pending = h.find(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.search, [["wy", "夜航"], ["tx", "夜航"]]);
  wy.resolve([candidate]);
  qq.resolve([]);
  const result = await pending;
  assert.equal(result.status, "matched");
  assert.deepEqual(result.candidate, { source: "wy", id: "wy-1", name: "夜航", singer: "林舟", gatewaySource: "netease", gatewayTrackId: "wy-1" });
  assert.deepEqual(result.lyrics, LYRICS);
  // 封面字段彻底不在结果形状里：候选自带的 picUrl / picId 不产生任何返回值，也不产生任何请求。
  assert.equal("coverUrl" in result, false);
  assert.equal(h.calls.lyrics[0].id, "wy-1");
  for (const key of ["isLocal", "localPath", "url", "localLyrics"]) assert.equal(h.calls.lyrics[0][key], undefined);
  assert.equal(input.id, "local:/private/music/night.flac");
  assert.equal(input.gateway.trackId, "local-secret");
});

test("标题只标准化排版，不按模糊子串匹配", async () => {
  const h = harness({ results: { wy: [online({ name: "　夜航（Ｌｉｖｅ）　" })] } });
  assert.equal((await h.find(local({ name: "夜航 (live)" }))).status, "matched");
  const miss = harness({ results: { wy: [online({ name: "夜航之旅" })] } });
  assertNoAssets(await miss.find(local()), "not-found");
  assert.equal(miss.calls.lyrics.length, 0);
});

for (const name of ["夜航 (Live)", "夜航（伴奏）", "夜航 (翻唱)", "夜航 (重录版)", "夜航 (Remix)", "夜航 (Acoustic)"]) {
  test(`版本冲突绝不套用：${name}`, async () => {
    for (const [inputName, candidateName] of [["夜航", name], [name, "夜航"]]) {
      const h = harness({ results: { wy: [online({ name: candidateName })] } });
      assertNoAssets(await h.find(local({ name: inputName })), "not-found");
      assert.equal(h.calls.lyrics.length, 0);
    }
  });
}

test("专辑显式版本冲突也不混成同一录音", async () => {
  const h = harness({ results: { wy: [online({ albumName: "星图 Live" })] } });
  assertNoAssets(await h.find(local()), "not-found");
});

// 召回里出现与本地同演唱者的候选（含「林舟、另一歌手」这种署名重叠）时，歌名相同也不得改用它人的录音；
// 时长冲突同样不构成可用证据。
for (const extra of [{ singer: "林舟、另一歌手" }, { interval: 255 }]) {
  test(`相同标题不能覆盖明确歌手或时长冲突 ${JSON.stringify(extra)}`, async () => {
    const h = harness({ results: { wy: [online(extra)] } });
    assertNoAssets(await h.find(local()), "not-found");
    assert.equal(h.calls.lyrics.length, 0);
  });
}

// 原唱在这次召回里一条都没有（下架 / 无版权）+ 时长几乎一致：只有这时才允许启用同曲异唱档。
// 旧用例在此预期 not-found，同曲异唱档落地后按新语义显式断言 matched，并把演唱者与来源一起钉住。
test("原唱缺席且时长几乎一致时才按同曲异唱采用，并标注演唱者", async () => {
  const h = harness({ results: { wy: [online({ singer: "另一歌手" })] } });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.id, "wy-1");
  assert.equal(result.candidate.singer, "另一歌手");
  assert.deepEqual(result.lyricOrigin, { tier: "other-performer", performer: "另一歌手", source: "wy" });
  assert.deepEqual(result.lyrics, LYRICS);
  assert.deepEqual(h.calls.directLyrics.map(song => song.id), ["wy-1"]);
});

test("歌手名单顺序与分隔排版不形成冲突", async () => {
  const h = harness({ results: { wy: [online({ singer: "乙 / 甲" })] } });
  assert.equal((await h.find(local({ singer: "甲、乙" }))).status, "matched");
});

for (const singer of ["", "未知歌手", "Unknown Artist", "群星", "N/A", "---"]) {
  test(`缺失或不可用歌手必须有时长加专辑佐证：${singer}`, async () => {
    const h = harness({ results: { wy: [online()] } });
    assert.equal((await h.find(local({ singer }))).status, "matched");
    for (const extra of [{ interval: undefined }, { albumName: "未知专辑" }, { interval: NaN }, { interval: 0 }]) {
      const weak = harness({ results: { wy: [online()] } });
      assertNoAssets(await weak.find(local({ singer, ...extra })), "ambiguous");
      assert.equal(weak.calls.lyrics.length, 0);
    }
  });
}

test("在线歌手不可用同样要求强佐证，双方 unknown 不算歌手相同", async () => {
  const h = harness({ results: { wy: [online({ singer: "未知歌手", interval: undefined, albumName: "" })] } });
  assertNoAssets(await h.find(local()), "ambiguous");
  assertNoAssets(await h.find(local({ singer: "未知歌手" })), "ambiguous");
});

test("缺歌手但时长仅近似且不够接近仍是歧义", async () => {
  const h = harness({ results: { wy: [online({ interval: 214 })] } });
  assertNoAssets(await h.find(local({ singer: "" })), "ambiguous");
});

test("网关缺 duration 时保留标题和明确歌手证据，不伪造时长", async () => {
  const candidate = online({ interval: undefined, gateway: { source: "netease", trackId: "track-real", lyricId: "lyric-real", picId: "pic-real" } });
  const h = harness({ results: { wy: [candidate] } });
  assert.equal((await h.find(local())).status, "matched");
  assert.deepEqual(h.calls.lyrics[0].gateway, candidate.gateway);
  assert.equal(h.calls.lyrics[0].interval, undefined);
});

test("同名同歌手不同录音无足够领先差距，不取搜索第一项", async () => {
  const candidates = [online({ id: "a", albumName: "单曲", interval: 210 }), online({ id: "b", albumName: "重聚", interval: 211 })];
  for (const list of [candidates, [...candidates].reverse()]) {
    const h = harness({ results: { wy: list } });
    assertNoAssets(await h.find(local({ albumName: "" })), "ambiguous");
    assert.equal(h.calls.lyrics.length, 0);
  }
});

test("缺歌手时不同歌手即便标题专辑时长相同也不能跨源合组", async () => {
  const h = harness({ results: { wy: [online()], tx: [tx({ singer: "其他人" })] } });
  assertNoAssets(await h.find(local({ singer: "" })), "ambiguous");
});

test("可靠证据有明确领先才选择，不靠结果数量提高置信度", async () => {
  const weak = online({ id: "weak", albumName: "另一专辑", interval: undefined });
  const h = harness({ results: { wy: [...Array(20).fill(weak), online()] } });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.id, "wy-1");
});

test("跨源同一录音可合组，仅在该组补齐缺失内容并保留原生 QQ ID", async () => {
  const qq = tx({ gateway: undefined });
  const h = harness({ results: { wy: [online({ picUrl: undefined })], tx: [qq] } });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.ok(h.calls.lyrics.every(song => ["wy-1", "qq-native-mid"].includes(song.id)));
});

test("跨源同组在一个歌词 provider 失败后可尝试另一个，失败仍可见", async () => {
  const h = harness({ results: { wy: [online()], tx: [tx()] }, lyrics: async song => {
    if (song.source === "wy") throw new Error("provider unavailable");
    return LYRICS;
  } });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(h.calls.lyrics.length, 2);
  assertIssue(result, /wy.*lyrics.*failed/);
});

test("资料不能从落选的不同身份候选补齐", async () => {
  const h = harness({ results: { wy: [online({ picUrl: undefined })], tx: [tx({ albumName: "另一专辑", interval: undefined })] }, lyrics: async () => [] });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.equal(result.lyrics, undefined);
  assert.equal(h.calls.lyrics.length, 1);
  assert.equal(h.calls.lyrics[0].source, "wy");
  assertIssue(result, /lyrics.*missing/);
});

for (const source of ["wy", "tx"]) {
  test(`${source} 搜索失败不吞掉另一个 provider，issues 不泄露 URL 或凭证`, async () => {
    const other = source === "wy" ? "tx" : "wy";
    const h = harness({ results: { [source]: new Error("https://secret.test/?signature=secret Cookie=private"), [other]: [online({ source: other })] } });
    const result = await h.find(local());
    assert.equal(result.status, "matched");
    assertIssue(result, new RegExp(`${source}.*search.*failed`));
    assert.doesNotMatch(result.issues.join(" "), /secret|Cookie|https:/);
  });
}

test("全部失败、空召回与不相关召回均显式返回 not-found", async () => {
  const failed = harness({ results: { wy: new Error("fail"), tx: new Error("fail") } });
  const result = await failed.find(local());
  assertNoAssets(result, "not-found");
  assertIssue(result, /wy.*search.*failed/);
  assertIssue(result, /tx.*search.*failed/);
  const empty = harness();
  const missing = await empty.find(local());
  assertNoAssets(missing, "not-found");
  assertIssue(missing, /search.*empty/);
});

test("歌词失败与空白内容可见，结果里没有封面这一路", async () => {
  for (const lyrics of [async () => { throw new Error("fail"); }, async () => [], async () => [{ time: 0, text: " " }], async () => [{ time: NaN, text: "bad" }]]) {
    const h = harness({ results: { wy: [online()] }, lyrics });
    const result = await h.find(local());
    assert.equal(result.status, "matched");
    assert.equal(result.lyrics, undefined);
    assert.equal("coverUrl" in result, false);
    assertIssue(result, /lyrics/);
  }
});

test("空标题不请求；候选自带的封面字段不会引发任何请求", async () => {
  const skip = harness();
  assertNoAssets(await skip.find(local({ name: " " })), "not-found");
  assert.equal(skip.calls.search.length, 0);
  // 带 picUrl / gateway.picId 的正常候选：封面字段连解析都不做，出站调用只有歌词。
  const h = harness({ results: { wy: [online({ picUrl: COVER, img: COVER, gateway: { source: "netease", trackId: "song", lyricId: "song", picId: "pic" } })] } });
  const result = await h.find(local());
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal("coverUrl" in result, false);
  assert.equal(h.calls.lyrics.length, 1);
});

test("候选与 JSON 外部输入不合法时不触发歌词请求", async () => {
  const h = harness({ results: { wy: [null, {}, online({ source: "local", isLocal: true }), online({ id: "" }), online({ localPath: "/private/song.mp3" })], tx: {} } });
  const result = await h.find(local());
  assertNoAssets(result, "not-found");
  assertIssue(result, /invalid/);
  assert.equal(h.calls.lyrics.length, 0);
});

test("资料重试仅限可靠同组且至多每源一次，请求总数不随候选数量增长", async () => {
  const make = source => Array.from({ length: 40 }, (_, i) => online({ source, id: `${source}-${i}`, gateway: { source: source === "wy" ? "netease" : "joox", trackId: `track-${i}`, picId: `pic-${i}` } }));
  const h = harness({ results: { wy: make("wy"), tx: make("tx") }, lyrics: async () => [] });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.equal(h.calls.search.length, 2);
  assert.equal(h.calls.lyrics.length, 2);
  assert.equal(new Set(h.calls.lyrics.map(song => song.source)).size, 2);
  assertIssue(result, /lyrics.*missing/);
});

test("领先两分仍有歧义，不用专辑小优势强行套用", async () => {
  const h = harness({ results: { wy: [online(), online({ id: "alternate", albumName: "另一专辑" })] } });
  assertNoAssets(await h.find(local()), "ambiguous");
  assert.equal(h.calls.lyrics.length, 0);
});

test("缺时长候选不能传递合并时长冲突的不同录音", async () => {
  const h = harness({ results: {
    wy: [online({ interval: 210 }), online({ id: "other-recording", interval: 240 })],
    tx: [tx({ interval: undefined })],
  } });
  assertNoAssets(await h.find(local({ interval: undefined })), "ambiguous");
});

test("混合未知歌手不能抹掉已知歌手冲突或伪造完整歌手证据", async () => {
  // 召回里只要有一条与本地已知歌手（林舟）同演唱者的候选——哪怕它因时长冲突被否决——
  // 就证明「原唱在平台上可得」，同曲异唱档必须拒绝启用，结果仍是 not-found。
  const guarded = harness({
    results: { wy: [online({ singer: "另一歌手" })], tx: [tx({ singer: "林舟", interval: 240 })] },
  });
  assertNoAssets(await guarded.find(local({ singer: "林舟、未知歌手" })), "not-found");
  assert.equal(guarded.calls.lyrics.length, 0);
  const partial = harness({ results: { wy: [online({ singer: "林舟、未知歌手", albumName: "", interval: undefined })] } });
  assertNoAssets(await partial.find(local({ singer: "林舟、未知歌手" })), "ambiguous");
});

test("伪装成在线结果的本地 ID 及本地网关 ID 不会出网", async () => {
  for (const extra of [
    { id: "local:/private/song.mp3" },
    { id: "file:///private/song.mp3" },
    { gateway: { source: "netease", trackId: "local:/private/song.mp3" } },
    { gateway: { source: "netease", trackId: "track", lyricId: "file:///private/lyrics.lrc" } },
    { gateway: { source: "netease", trackId: "track", picId: "content://private/cover" } },
  ]) {
    const h = harness({ results: { wy: [online(extra)] } });
    const result = await h.find(local());
    assertNoAssets(result, "not-found");
    assertIssue(result, /invalid-candidate/);
    assert.equal(h.calls.lyrics.length, 0);
  }
});


test("本地曲歌词补全不再有任何封面网络路径", () => {
  const source = fs.readFileSync(path.join(mobileRoot, "src/services/localMediaSearchService.ts"), "utf8");
  for (const removed of ["fetchWithTimeout", "buildBuiltinMusicApiUrl", "isHttpMediaUrl", "readCover", "coverUrl", "coverKey", "picUrl"]) {
    assert.equal(source.includes(removed), false, `不得重新引入封面路径：${removed}`);
  }
  assert.match(source, /findLocalLyricsCandidates/);
});

const gatewaySong = (source, extra = {}) => online({
  source, id: `${source}-gateway`, interval: undefined,
  gateway: { source: source === "wy" ? "netease" : "joox", trackId: `${source}-track`, lyricId: `${source}-lyric`, picId: `${source}-pic` },
  ...extra,
});

test("追加网关：官方缺失歌曲仍可从网关严格匹配，歌词不经过官方", async () => {
  const h = harness({ gatewayResults: { wy: [gatewaySong("wy")] } });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.deepEqual(h.calls.gatewaySearch, [["wy", "夜航"], ["tx", "夜航"]]);
  assert.equal(h.calls.directLyrics.length, 0);
  assert.equal(h.calls.gatewayLyrics.length, 1);
  assert.equal(result.candidate.gatewaySource, "netease");
  assert.equal(result.candidate.gatewayTrackId, "wy-track");
});

test("追加网关：官方非空但全是翻唱，含 gateway 的网易官方结果也不阻止补查", async () => {
  const original = gatewaySong("wy");
  const h = harness({ results: { wy: [online({ singer: "翻唱者", gateway: { source: "netease", trackId: "wy-1", lyricId: "wy-1" } })] }, gatewayResults: { wy: [original] } });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.id, original.id);
  assert.equal(h.calls.directLyrics.length, 0);
  assert.deepEqual(h.calls.gatewayLyrics.map(song => song.gateway.source), ["netease"]);
  assert.ok(h.calls.gatewaySearch.some(([source]) => source === "wy"));
});

test("追加网关：QQ 无歌词但同一录音的 JOOX 有，原生 ID 与网关 namespace 分开", async () => {
  const joox = gatewaySong("tx", { id: "qq-native-mid" });
  const h = harness({ results: { tx: [tx()] }, gatewayResults: { tx: [joox] }, lyrics: async () => [], gatewayLyrics: async () => LYRICS });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.deepEqual(h.calls.directLyrics.map(song => song.id), ["qq-native-mid"]);
  assert.deepEqual(h.calls.gatewayLyrics.map(song => song.gateway.source), ["joox"]);
  assert.equal(h.calls.lyrics.length, 2);
});

test("追加网关：重判变歧义时丢弃旧部分资料，不能凭先前匹配继续套用", async () => {
  const h = harness({ results: { tx: [tx()] }, lyrics: async () => [], gatewayResults: { tx: [gatewaySong("tx", { albumName: "另一张专辑", interval: 210 })] } });
  const result = await h.find(local());
  assertNoAssets(result, "ambiguous");
  assert.equal(h.calls.directLyrics.length, 1);
  assert.equal(h.calls.gatewayLyrics.length, 0);
});

test("追加网关：新胜出身份不继承落选旧身份的资料", async () => {
  const old = tx({ albumName: "旧专辑", interval: undefined });
  const newer = gatewaySong("tx", { id: "new-recording", interval: 210, gateway: { source: "joox", trackId: "new-track", lyricId: "new-lyric" } });
  const h = harness({ results: { tx: [old] }, gatewayResults: { tx: [newer] }, lyrics: async () => [], gatewayLyrics: async () => LYRICS });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.id, "new-recording");
  assert.equal(result.candidate.gatewaySource, "joox");
  assert.deepEqual(result.lyrics, LYRICS);
});

test("追加网关：同组复用已经获取的歌词，不重复发送失败请求", async () => {
  const native = online({ gateway: { source: "netease", trackId: "wy-1", lyricId: "wy-1" } });
  const h = harness({ results: { wy: [native] }, gatewayResults: { tx: [gatewaySong("tx")] } });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(h.calls.directLyrics.length, 1);
  assert.equal(h.calls.gatewayLyrics.length, 0);
  assert.equal(h.calls.gatewaySearch.length, 0);
});

test("追加网关：已有真实网关召回不重复查询；仅有网易官方 gateway 元数据不算", async () => {
  const h = harness({ results: { tx: [gatewaySong("tx")], wy: [online({ gateway: { source: "netease", trackId: "wy-1", lyricId: "wy-1" } })] }, lyrics: async () => [], gatewayLyrics: async () => [] });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.deepEqual(h.calls.gatewaySearch, [["wy", "夜航"]]);
  assert.equal(h.calls.directLyrics.length, 1);
  assert.equal(h.calls.gatewayLyrics.length, 1);
  const existing = harness({ results: { wy: [gatewaySong("wy")], tx: [gatewaySong("tx")] }, gatewayLyrics: async () => [] });
  await existing.find(local());
  assert.equal(existing.calls.gatewaySearch.length, 0);
  assert.equal(existing.calls.directLyrics.length, 0);
});

test("追加网关：所需资源完整时不补查，补查也不得放宽版本或歌手", async () => {
  const complete = harness({ results: { tx: [tx()] } });
  await complete.find(local());
  assert.equal(complete.calls.gatewaySearch.length, 0);
  for (const extra of [{ singer: "另一歌手" }, { name: "夜航 (Live)" }, { interval: 240 }]) {
    const h = harness({ gatewayResults: { wy: [gatewaySong("wy", extra)] } });
    assertNoAssets(await h.find(local()), "not-found");
    assert.equal(h.calls.gatewaySearch.length, 2);
    assert.equal(h.calls.lyrics.length, 0);
  }
});

test("追加网关：独立 provider 失败可见且最多补查一轮，不漏出上游敏感错误", async () => {
  const h = harness({ gatewayResults: { wy: new Error("https://private.test/?secret=hidden"), tx: [gatewaySong("tx")] } });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assertIssue(result, /wy.*gateway.*search.*failed/);
  assert.doesNotMatch(result.issues.join(" "), /secret|private/);
  assert.equal(h.calls.gatewaySearch.length, 2);
  const empty = harness({ gatewayResults: { wy: [], tx: [] } });
  assertNoAssets(await empty.find(local()), "not-found");
  assert.equal(empty.calls.gatewaySearch.length, 2);
});

function loadGatewayApi(fetchWithTimeout) {
  // musicApi 依赖 mobile-api（builtinClient）与歌词解析两处 core 能力，这里各自独立加载。
  const coreApi = createLoader({})("../../packages/core/src/mobile-api.ts");
  const parser = createLoader({})("../../packages/core/src/lyrics/parser.ts");
  return createLoader({
    "@lx/core": { ...coreApi, ...parser },
    "./searchResultCache": {}, "./songMetadataMerge": {}, "./txPlaylistService": {},
    "./wySearchService": {}, "./wyMusicMapper": {}, "./wyDirectProvider": {},
    "@/utils/fetchWithTimeout": { fetchWithTimeout },
  })("src/services/musicApi.ts");
}

test("显式网关包装使用已有 builtinClient 搜索、真实 ID 和歌词解析，不走任何官方接口", async () => {
  const requests = [];
  const api = loadGatewayApi(async url => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.searchParams.get("types") === "search") return response([{ id: "remote-id", name: "夜航", artist: ["林舟"], album: "星图", source: parsed.searchParams.get("source"), url_id: "track-real", lyric_id: "lyric-real", pic_id: "pic-real" }]);
    return response({ lyric: "[00:01.00]原词", tlyric: "[00:01.00]译文" });
  });
  for (const source of ["wy", "tx"]) {
    const songs = await api.searchGatewaySongs(source, "夜航");
    assert.equal(songs[0].source, source);
    assert.equal(songs[0].id, "remote-id");
    assert.deepEqual(await api.getGatewayLyrics(songs[0]), [{ time: 1, text: "原词", tr: "译文" }]);
  }
  assert.deepEqual(requests.map(url => [url.searchParams.get("types"), url.searchParams.get("source"), url.searchParams.get("id")]), [
    ["search", "netease", null], ["lyric", "netease", "lyric-real"],
    ["search", "joox", null], ["lyric", "joox", "lyric-real"],
  ]);
  assert.ok(requests.every(url => url.hostname === "music-api.gdstudio.xyz"));
  for (const candidate of [local(), tx(), { ...gatewaySong("tx"), isLocal: true }]) {
    await assert.rejects(() => api.getGatewayLyrics(candidate));
  }
  assert.equal(requests.length, 4);
  assert.deepEqual(await api.getLyrics(local()), []);
});

test("追加网关：大批同组候选仍按 namespace 限次，重判不重发旧歌词请求", async () => {
  const make = source => Array.from({ length: 30 }, (_, i) => gatewaySong(source, { id: `${source}-${i}`, gateway: { source: source === "wy" ? "netease" : "joox", trackId: `${source}-track-${i}`, picId: `${source}-pic-${i}` } }));
  const h = harness({
    results: { wy: [online()], tx: [tx()] },
    gatewayResults: { wy: make("wy"), tx: make("tx") },
    lyrics: async () => [], gatewayLyrics: async () => [],
  });
  await h.find(local());
  assert.equal(h.calls.search.length, 2);
  assert.equal(h.calls.gatewaySearch.length, 2);
  assert.equal(h.calls.directLyrics.length, 2);
  assert.equal(h.calls.gatewayLyrics.length, 2);
});

// ── LRCLIB 直查：命中即采用，失败静默降级 ──

test("LRCLIB 命中即采用，不再请求 wy/tx 搜索歌词", async () => {
  const h = harness({ results: { wy: [online()] }, lrclib: async () => ({ kind: "lyrics", lines: LYRICS }) });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.deepEqual(result.lyricOrigin, { tier: "same-recording", source: "lrclib" });
  assert.deepEqual(h.calls.search, []);
  assert.deepEqual(h.calls.gatewaySearch, []);
  assert.deepEqual(h.calls.lyrics, []);
  assert.deepEqual(h.calls.lrclib.map(song => song.name), ["夜航"]);
});

test("LRCLIB 判定纯音乐时不再为歌词搜索", async () => {
  const h = harness({ results: { wy: [online()] }, lrclib: async () => ({ kind: "instrumental" }) });
  const result = await h.find(local());
  assertNoAssets(result, "not-found");
  assertIssue(result, /lrclib:instrumental/);
  assert.deepEqual(h.calls.search, []);
  assert.deepEqual(h.calls.lrclib.map(song => song.name), ["夜航"]);
});

test("LRCLIB 未命中或异常时都走原搜索链", async () => {
  const miss = harness({ results: { wy: [online()] } });
  const result = await miss.find(local());
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(result.lyricOrigin, undefined);
  assert.deepEqual(miss.calls.search, [["wy", "夜航"], ["tx", "夜航"]]);
  assert.equal(miss.calls.lrclib.length, 1);
  const failed = harness({ results: { wy: [online()] }, lrclib: async () => { throw new Error("network"); } });
  assert.equal((await failed.find(local())).status, "matched");
});

// ── 同曲异唱：所有轮次穷尽后的最后手段 ──

test("召回里仍有原唱时，异唱档绝不介入", async () => {
  const h = harness({
    results: { wy: [online({ singer: "另一歌手" })] },
    gatewayResults: { wy: [gatewaySong("wy")] },
  });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.id, "wy-gateway");
  assert.equal(result.candidate.singer, "林舟");
  assert.equal(result.lyricOrigin, undefined);
  assert.deepEqual(h.calls.gatewayLyrics.map(song => song.gateway.source), ["netease"]);
});

test("证据不足的同名异唱只暴露 alternatives，不自动采用", async () => {
  // 时长差 2.5s：在异唱窗口内，但既非同一份录音素材（>1s），也没有第二个平台互证 → corroboration="none"。
  const h = harness({ results: { wy: [online({ singer: "另一歌手", interval: 212.5 })] } });
  const result = await h.find(local());
  assertNoAssets(result, "not-found");
  assert.equal(h.calls.lyrics.length, 0);
  assert.deepEqual(result.alternatives, [
    { source: "wy", id: "wy-1", name: "夜航", performer: "另一歌手", durationDeltaSeconds: 2.5 },
  ]);
});

test("跨源互证的异唱候选才自动采用", async () => {
  const h = harness({
    results: {
      wy: [online({ singer: "另一歌手", interval: 212.5 })],
      tx: [tx({ singer: "另一歌手", interval: 212.5 })],
    },
  });
  const result = await h.find(local());
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyricOrigin, { tier: "other-performer", performer: "另一歌手", source: "wy" });
  assert.deepEqual(h.calls.directLyrics.map(song => song.id), ["wy-1"]);
});

// ── 「选择歌词」候选：只排序与标注，不隐藏；离线仍有本地那一档 ──

test("候选包含本地已有与 LRCLIB，本地那一档永远排在最前", async () => {
  const h = harness({ lrclib: async () => ({ kind: "lyrics", lines: [{ time: 0, text: "库里那一版" }] }) });
  const result = await h.service.findLocalLyricsCandidates(local(), { localText: "[00:01.00]旁挂第一行\n[00:02.00]旁挂第二行" });
  assert.deepEqual(result.candidates.map(candidate => candidate.kind), ["local", "lrclib"]);
  assert.equal(result.candidates[0].sourceLabel, "本地文件");
  assert.equal(result.candidates[0].preview, "旁挂第一行");
  assert.equal(result.candidates[1].preview, "库里那一版");
});

test("平台候选全部列出，只用 core 的档位标注与排序，不隐藏任何一条", async () => {
  const h = harness({
    results: { wy: [online({ id: "wy-1" })], tx: [tx({ id: "tx-1", singer: "另一歌手", interval: 212.5 })] },
  });
  const result = await h.service.findLocalLyricsCandidates(local());
  const platform = result.candidates.filter(candidate => candidate.kind === "wy" || candidate.kind === "tx");
  assert.deepEqual(platform.map(candidate => candidate.sourceLabel).sort(), ["QQ音乐", "网易云"]);
  assert.equal(platform[0].tier, "same-recording");
  assert.equal(platform[0].sourceLabel, "网易云");
  // 证据不足的异唱候选仍然在列表里，只是被标注成异唱档。
  const other = platform.find(candidate => candidate.kind === "tx");
  assert.equal(other.tier, "other-performer");
  assert.equal(other.durationDeltaSeconds, 2.5);
});

test("首行预览只取预算内的候选，其余候选点选时再取", async () => {
  const many = Array.from({ length: 8 }, (_, i) => online({ id: `wy-${i}` }));
  const h = harness({ results: { wy: many } });
  const result = await h.service.findLocalLyricsCandidates(local());
  assert.equal(result.candidates.length, 8);
  // MAX_CANDIDATE_PREVIEWS = 6：面板一次打开只为最靠前的 6 条预取歌词。
  assert.equal(h.calls.directLyrics.length, 6);
  assert.equal(result.candidates[5].preview !== undefined, true);
  assert.equal(result.candidates[6].preview, undefined);
  const lines = await h.service.readLyricsCandidateLines(result.candidates[6]);
  assert.deepEqual(lines, LYRICS);
  assert.equal(h.calls.directLyrics.length, 7);
});

test("候选搜索失败只回流 issues，本地候选与状态都不受影响", async () => {
  const h = harness({ results: { wy: new Error("https://secret.test/?signature=secret"), tx: new Error("offline") } });
  const result = await h.service.findLocalLyricsCandidates(local(), { localText: "[00:01.00]只剩本地" });
  assert.deepEqual(result.candidates.map(candidate => candidate.kind), ["local"]);
  assert.ok(result.issues.some(issue => /wy.*search.*failed/.test(issue)));
  assert.doesNotMatch(result.issues.join(" "), /secret|https:/);
});

test("网关候选点选时走网关取词，预览失败不阻断选择", async () => {
  const h = harness({
    gatewayResults: { wy: [gatewaySong("wy")] },
    lyrics: async () => [],
    gatewayLyrics: async song => (song.gateway.trackId === "wy-track" ? [] : LYRICS),
  });
  const result = await h.service.findLocalLyricsCandidates(local());
  const candidate = result.candidates.find(item => item.kind === "wy");
  assert.equal(candidate.identity.route, "gateway");
  assert.equal(candidate.preview, undefined);
  assert.equal(h.calls.gatewayLyrics.length, 1);
  assert.deepEqual(await h.service.readLyricsCandidateLines(candidate), []);
  assert.equal(h.calls.gatewayLyrics.length, 2);
});
