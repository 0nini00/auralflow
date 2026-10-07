const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

const core = createLoader({})("../../packages/core/src/mobile-api.ts");
const LYRICS = [{ time: 0, text: "夜色中的航线", tr: "A route in the night" }];
const COVER = "https://example.test/cover.jpg";
const BOTH = { lyrics: true, cover: true };
const local = (extra = {}) => ({
  id: "local:/private/music/night.flac", source: "local", isLocal: true,
  name: "夜航", singer: "林舟", albumName: "星图", interval: 210,
  url: "file:///private/music/night.flac", localPath: "/private/music/night.flac", ...extra,
});
const online = (extra = {}) => ({
  id: "wy-1", source: "wy", name: "夜航", singer: "林舟", albumName: "星图",
  interval: 210, picUrl: COVER, ...extra,
});
const tx = (extra = {}) => online({ source: "tx", id: "qq-native-mid", ...extra });

function harness({ results = {}, gatewayResults = {}, lyrics = async () => LYRICS, gatewayLyrics = lyrics, pic = async () => response({ url: COVER }) } = {}) {
  const calls = { search: [], gatewaySearch: [], lyrics: [], directLyrics: [], gatewayLyrics: [], pic: [] };
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
    "@lx/core": { buildBuiltinMusicApiUrl: core.buildBuiltinMusicApiUrl },
    "@/utils/fetchWithTimeout": {
      fetchWithTimeout: async (...args) => { calls.pic.push(args); return pic(...args); },
    },
  });
  return { find: load("src/services/localMediaSearchService.ts").findLocalMediaAssets, calls };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
}

function assertNoAssets(result, status) {
  assert.equal(result.status, status);
  assert.equal(result.candidate, undefined);
  assert.equal(result.lyrics, undefined);
  assert.equal(result.coverUrl, undefined);
}

function assertIssue(result, pattern) {
  assert.ok(result.issues.some(issue => pattern.test(issue)), JSON.stringify(result.issues));
}

test("按纯歌名并行搜索两个内置源，不修改本地身份或音频", async () => {
  const wy = deferred();
  const qq = deferred();
  const input = Object.freeze(local({ name: " 夜航 ", gateway: Object.freeze({ source: "private", trackId: "local-secret" }) }));
  const candidate = Object.freeze(online());
  const h = harness({ results: { wy: () => wy.promise, tx: () => qq.promise } });
  const pending = h.find(input, BOTH);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.search, [["wy", "夜航"], ["tx", "夜航"]]);
  wy.resolve([candidate]);
  qq.resolve([]);
  const result = await pending;
  assert.equal(result.status, "matched");
  assert.deepEqual(result.candidate, { source: "wy", id: "wy-1", name: "夜航", singer: "林舟" });
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(result.coverUrl, COVER);
  assert.equal(h.calls.lyrics[0].id, "wy-1");
  for (const key of ["isLocal", "localPath", "url", "localLyrics"]) assert.equal(h.calls.lyrics[0][key], undefined);
  assert.equal(input.id, "local:/private/music/night.flac");
  assert.equal(input.gateway.trackId, "local-secret");
});

test("标题只标准化排版，不按模糊子串匹配", async () => {
  const h = harness({ results: { wy: [online({ name: "　夜航（Ｌｉｖｅ）　" })] } });
  assert.equal((await h.find(local({ name: "夜航 (live)" }), BOTH)).status, "matched");
  const miss = harness({ results: { wy: [online({ name: "夜航之旅" })] } });
  assertNoAssets(await miss.find(local(), BOTH), "not-found");
  assert.equal(miss.calls.lyrics.length, 0);
});

for (const name of ["夜航 (Live)", "夜航（伴奏）", "夜航 (翻唱)", "夜航 (重录版)", "夜航 (Remix)", "夜航 (Acoustic)"]) {
  test(`版本冲突绝不套用：${name}`, async () => {
    for (const [inputName, candidateName] of [["夜航", name], [name, "夜航"]]) {
      const h = harness({ results: { wy: [online({ name: candidateName })] } });
      assertNoAssets(await h.find(local({ name: inputName }), BOTH), "not-found");
      assert.equal(h.calls.lyrics.length, 0);
    }
  });
}

test("专辑显式版本冲突也不混成同一录音", async () => {
  const h = harness({ results: { wy: [online({ albumName: "星图 Live" })] } });
  assertNoAssets(await h.find(local(), BOTH), "not-found");
});

for (const extra of [{ singer: "另一歌手" }, { singer: "林舟、另一歌手" }, { interval: 255 }]) {
  test(`相同标题不能覆盖明确歌手或时长冲突 ${JSON.stringify(extra)}`, async () => {
    const h = harness({ results: { wy: [online(extra)] } });
    assertNoAssets(await h.find(local(), BOTH), "not-found");
    assert.equal(h.calls.lyrics.length, 0);
    assert.equal(h.calls.pic.length, 0);
  });
}

test("歌手名单顺序与分隔排版不形成冲突", async () => {
  const h = harness({ results: { wy: [online({ singer: "乙 / 甲" })] } });
  assert.equal((await h.find(local({ singer: "甲、乙" }), BOTH)).status, "matched");
});

for (const singer of ["", "未知歌手", "Unknown Artist", "群星", "N/A", "---"]) {
  test(`缺失或不可用歌手必须有时长加专辑佐证：${singer}`, async () => {
    const h = harness({ results: { wy: [online()] } });
    assert.equal((await h.find(local({ singer }), BOTH)).status, "matched");
    for (const extra of [{ interval: undefined }, { albumName: "未知专辑" }, { interval: NaN }, { interval: 0 }]) {
      const weak = harness({ results: { wy: [online()] } });
      assertNoAssets(await weak.find(local({ singer, ...extra }), BOTH), "ambiguous");
      assert.equal(weak.calls.lyrics.length, 0);
    }
  });
}

test("在线歌手不可用同样要求强佐证，双方 unknown 不算歌手相同", async () => {
  const h = harness({ results: { wy: [online({ singer: "未知歌手", interval: undefined, albumName: "" })] } });
  assertNoAssets(await h.find(local(), BOTH), "ambiguous");
  assertNoAssets(await h.find(local({ singer: "未知歌手" }), BOTH), "ambiguous");
});

test("缺歌手但时长仅近似且不够接近仍是歧义", async () => {
  const h = harness({ results: { wy: [online({ interval: 214 })] } });
  assertNoAssets(await h.find(local({ singer: "" }), BOTH), "ambiguous");
});

test("网关缺 duration 时保留标题和明确歌手证据，不伪造时长", async () => {
  const candidate = online({ interval: undefined, picUrl: undefined, gateway: { source: "netease", trackId: "track-real", lyricId: "lyric-real", picId: "pic-real" } });
  const h = harness({ results: { wy: [candidate] } });
  assert.equal((await h.find(local(), BOTH)).status, "matched");
  assert.deepEqual(h.calls.lyrics[0].gateway, candidate.gateway);
  assert.equal(h.calls.lyrics[0].interval, undefined);
});

test("同名同歌手不同录音无足够领先差距，不取搜索第一项", async () => {
  const candidates = [online({ id: "a", albumName: "单曲", interval: 210 }), online({ id: "b", albumName: "重聚", interval: 211 })];
  for (const list of [candidates, [...candidates].reverse()]) {
    const h = harness({ results: { wy: list } });
    assertNoAssets(await h.find(local({ albumName: "" }), BOTH), "ambiguous");
    assert.equal(h.calls.lyrics.length, 0);
  }
});

test("缺歌手时不同歌手即便标题专辑时长相同也不能跨源合组", async () => {
  const h = harness({ results: { wy: [online()], tx: [tx({ singer: "其他人" })] } });
  assertNoAssets(await h.find(local({ singer: "" }), BOTH), "ambiguous");
});

test("可靠证据有明确领先才选择，不靠结果数量提高置信度", async () => {
  const weak = online({ id: "weak", albumName: "另一专辑", interval: undefined });
  const h = harness({ results: { wy: [...Array(20).fill(weak), online()] } });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.id, "wy-1");
});

test("跨源同一录音可合组，仅在该组补齐缺失内容并保留原生 QQ ID", async () => {
  const qq = tx({ gateway: undefined });
  const h = harness({ results: { wy: [online({ picUrl: undefined })], tx: [qq] } });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.equal(result.coverUrl, COVER);
  assert.deepEqual(result.lyrics, LYRICS);
  assert.ok(h.calls.lyrics.every(song => ["wy-1", "qq-native-mid"].includes(song.id)));
  assert.equal(h.calls.pic.length, 0);
});

test("跨源同组在一个歌词 provider 失败后可尝试另一个，失败仍可见", async () => {
  const h = harness({ results: { wy: [online()], tx: [tx()] }, lyrics: async song => {
    if (song.source === "wy") throw new Error("provider unavailable");
    return LYRICS;
  } });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(h.calls.lyrics.length, 2);
  assertIssue(result, /wy.*lyrics.*failed/);
});

test("资料不能从落选的不同身份候选补齐", async () => {
  const h = harness({ results: { wy: [online({ picUrl: undefined })], tx: [tx({ albumName: "另一专辑", interval: undefined })] }, lyrics: async () => [] });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.equal(result.lyrics, undefined);
  assert.equal(result.coverUrl, undefined);
  assert.equal(h.calls.lyrics.length, 1);
  assert.equal(h.calls.lyrics[0].source, "wy");
  assertIssue(result, /lyrics.*missing/);
  assertIssue(result, /cover.*missing/);
});

for (const source of ["wy", "tx"]) {
  test(`${source} 搜索失败不吞掉另一个 provider，issues 不泄露 URL 或凭证`, async () => {
    const other = source === "wy" ? "tx" : "wy";
    const h = harness({ results: { [source]: new Error("https://secret.test/?signature=secret Cookie=private"), [other]: [online({ source: other })] } });
    const result = await h.find(local(), BOTH);
    assert.equal(result.status, "matched");
    assertIssue(result, new RegExp(`${source}.*search.*failed`));
    assert.doesNotMatch(result.issues.join(" "), /secret|Cookie|https:/);
  });
}

test("全部失败、空召回与不相关召回均显式返回 not-found", async () => {
  const failed = harness({ results: { wy: new Error("fail"), tx: new Error("fail") } });
  const result = await failed.find(local(), BOTH);
  assertNoAssets(result, "not-found");
  assertIssue(result, /wy.*search.*failed/);
  assertIssue(result, /tx.*search.*failed/);
  const empty = harness();
  const missing = await empty.find(local(), BOTH);
  assertNoAssets(missing, "not-found");
  assertIssue(missing, /search.*empty/);
});

test("pic 使用真实 gateway source 和 picId，解析实测的顶层 JSON url", async () => {
  // 2026-10-07 公开 netease pic 响应：HTTP 200，{ url: string, from: string }；不保存签名地址。
  const gateway = Object.freeze({ source: "netease", trackId: "track-id", lyricId: "lyric-id", picId: "picture-id" });
  const h = harness({ results: { wy: [online({ picUrl: undefined, gateway })] }, pic: async () => response({ url: COVER, from: "netease" }) });
  const result = await h.find(local(), BOTH);
  assert.equal(result.coverUrl, COVER);
  const url = new URL(h.calls.pic[0][0]);
  assert.equal(url.searchParams.get("types"), "pic");
  assert.equal(url.searchParams.get("source"), "netease");
  assert.equal(url.searchParams.get("id"), "picture-id");
  assert.equal(url.searchParams.get("size"), "500");
  assert.equal(h.calls.lyrics[0].id, "wy-1");
  assert.deepEqual(h.calls.lyrics[0].gateway, gateway);
});

test("原生 QQ 缺封面不合成 joox ID，真实 joox 元数据则原样使用", async () => {
  const native = harness({ results: { tx: [tx({ picUrl: undefined })] } });
  const missing = await native.find(local(), BOTH);
  assert.equal(missing.coverUrl, undefined);
  assert.equal(native.calls.pic.length, 0);
  assert.equal(native.calls.lyrics[0].id, "qq-native-mid");
  assert.equal(native.calls.lyrics[0].gateway, undefined);
  const gateway = { source: "joox", trackId: "joox-track", picId: "joox-pic", lyricId: "joox-lyric" };
  const actual = harness({ results: { tx: [tx({ id: "joox-original-id", picUrl: undefined, gateway })] } });
  const result = await actual.find(local(), BOTH);
  assert.equal(result.candidate.id, "joox-original-id");
  assert.equal(new URL(actual.calls.pic[0][0]).searchParams.get("source"), "joox");
  assert.deepEqual(actual.calls.lyrics[0].gateway, gateway);
});

for (const body of [{}, { url: "" }, { url: "file:///private/cover.jpg" }, { url: "data:image/png;base64,xxx" }, { url: "javascript:alert(1)" }, { url: "//example.test/a" }, { url: "https://user:password@example.test/a" }, { data: { url: COVER } }, COVER, null]) {
  test(`pic 拒绝未经证实的结构或非 HTTP URL：${JSON.stringify(body)}`, async () => {
    const h = harness({ results: { wy: [online({ picUrl: undefined, gateway: { source: "netease", trackId: "song", picId: "pic" } })] }, pic: async () => response(body) });
    const result = await h.find(local(), BOTH);
    assert.equal(result.coverUrl, undefined);
    assert.deepEqual(result.lyrics, LYRICS);
    assertIssue(result, /cover/);
  });
}

for (const pic of [async () => { throw new Error("network"); }, async () => response({ url: COVER }, 503), async () => ({ ok: true, json: async () => { throw new SyntaxError("HTML"); } })]) {
  test("pic 网络、HTTP 或 JSON 失败不吞成功歌词", async () => {
    const h = harness({ results: { wy: [online({ picUrl: undefined, gateway: { source: "netease", trackId: "song", picId: "pic" } })] }, pic });
    const result = await h.find(local(), BOTH);
    assert.deepEqual(result.lyrics, LYRICS);
    assert.equal(result.coverUrl, undefined);
    assertIssue(result, /cover.*(failed|invalid|http)/);
  });
}

test("歌词失败与空白内容可见，封面获取仍完成", async () => {
  for (const lyrics of [async () => { throw new Error("fail"); }, async () => [], async () => [{ time: 0, text: " " }], async () => [{ time: NaN, text: "bad" }]]) {
    const h = harness({ results: { wy: [online()] }, lyrics });
    const result = await h.find(local(), BOTH);
    assert.equal(result.status, "matched");
    assert.equal(result.coverUrl, COVER);
    assert.equal(result.lyrics, undefined);
    assertIssue(result, /lyrics/);
  }
});

test("封面已有无效 URL 时显式报告，合法 img 别名可用", async () => {
  const h = harness({ results: { wy: [online({ picUrl: "file:///cover.jpg", img: COVER })] } });
  const result = await h.find(local(), BOTH);
  assert.equal(result.coverUrl, COVER);
  assertIssue(result, /cover.*invalid/);
});

test("每种 needs 只获取所需内容，空标题和无 needs 不请求", async () => {
  const cover = harness({ results: { wy: [online()] } });
  assert.equal((await cover.find(local(), { lyrics: false, cover: true })).lyrics, undefined);
  assert.equal(cover.calls.lyrics.length, 0);
  const lyrics = harness({ results: { wy: [online({ picUrl: undefined, gateway: { source: "netease", trackId: "song", picId: "pic" } })] } });
  assert.equal((await lyrics.find(local(), { lyrics: true, cover: false })).coverUrl, undefined);
  assert.equal(lyrics.calls.pic.length, 0);
  const skip = harness();
  assertNoAssets(await skip.find(local(), { lyrics: false, cover: false }), "not-found");
  assertNoAssets(await skip.find(local({ name: " " }), BOTH), "not-found");
  assert.equal(skip.calls.search.length, 0);
});

test("候选与 JSON 外部输入不合法时不触发歌词或封面请求", async () => {
  const h = harness({ results: { wy: [null, {}, online({ source: "local", isLocal: true }), online({ id: "" }), online({ localPath: "/private/song.mp3" })], tx: {} } });
  const result = await h.find(local(), BOTH);
  assertNoAssets(result, "not-found");
  assertIssue(result, /invalid/);
  assert.equal(h.calls.lyrics.length, 0);
  assert.equal(h.calls.pic.length, 0);
});

test("资料重试仅限可靠同组且至多每源一次，请求总数不随候选数量增长", async () => {
  const make = source => Array.from({ length: 40 }, (_, i) => online({ source, id: `${source}-${i}`, picUrl: undefined, gateway: { source: source === "wy" ? "netease" : "joox", trackId: `track-${i}`, picId: `pic-${i}` } }));
  const h = harness({ results: { wy: make("wy"), tx: make("tx") }, lyrics: async () => [], pic: async () => response({}) });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.equal(h.calls.search.length, 2);
  assert.equal(h.calls.lyrics.length, 2);
  assert.equal(h.calls.pic.length, 2);
  assert.equal(new Set(h.calls.lyrics.map(song => song.source)).size, 2);
  assertIssue(result, /lyrics.*missing/);
  assertIssue(result, /cover/);
});

test("领先两分仍有歧义，不用专辑小优势强行套用", async () => {
  const h = harness({ results: { wy: [online(), online({ id: "alternate", albumName: "另一专辑" })] } });
  assertNoAssets(await h.find(local(), BOTH), "ambiguous");
  assert.equal(h.calls.lyrics.length, 0);
});

test("缺时长候选不能传递合并时长冲突的不同录音", async () => {
  const h = harness({ results: {
    wy: [online({ interval: 210 }), online({ id: "other-recording", interval: 240 })],
    tx: [tx({ interval: undefined })],
  } });
  assertNoAssets(await h.find(local({ interval: undefined }), BOTH), "ambiguous");
});

test("混合未知歌手不能抹掉已知歌手冲突或伪造完整歌手证据", async () => {
  const conflicting = harness({ results: { wy: [online({ singer: "另一歌手" })] } });
  assertNoAssets(await conflicting.find(local({ singer: "林舟、未知歌手" }), BOTH), "not-found");
  const partial = harness({ results: { wy: [online({ singer: "林舟、未知歌手", albumName: "", interval: undefined })] } });
  assertNoAssets(await partial.find(local({ singer: "林舟、未知歌手" }), BOTH), "ambiguous");
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
    const result = await h.find(local(), BOTH);
    assertNoAssets(result, "not-found");
    assertIssue(result, /invalid-candidate/);
    assert.equal(h.calls.lyrics.length, 0);
    assert.equal(h.calls.pic.length, 0);
  }
});


// 转译实际安装的 RN URL/URLSearchParams；仅隔离与地址校验无关的原生 Blob 模块。
function loadReactNativeURL() {
  function load(name) {
    const { code } = mobileRequire("@babel/core").transformFileSync(
      mobileRequire.resolve(`react-native/Libraries/Blob/${name}.js`),
      { presets: [mobileRequire.resolve("@react-native/babel-preset")], babelrc: false, configFile: false },
    );
    const module = { exports: {} };
    const requireDependency = name => {
      if (name === "./NativeBlobModule") return { __esModule: true, default: null };
      if (name === "./URLSearchParams") return load("URLSearchParams");
      return mobileRequire(name);
    };
    new Function("require", "module", "exports", code)(requireDependency, module, module.exports);
    return module.exports;
  }
  return load("URL").URL;
}

const VALID_COVER_URLS = [
  COVER,
  "http://example.test/cover.jpg?format=original#part",
  "https://media.example.test:8443/path/@cover.jpg?email=sample@example.test",
  "https://example.test/cover.jpg?email=sample@example.test",
  "HTTPS://Example.test/cover%20art.jpg?crop=1%3A1",
  "https://[2001:db8::1]:8443/cover.jpg",
  "https://example.test",
  "  https://example.test/cover.jpg  ",
];
const INVALID_COVER_URLS = [
  "https://sample@example.test/cover.jpg", "https://sample:password@example.test/cover.jpg",
  "https://:password@example.test/cover.jpg", "https://@example.test/cover.jpg", "https://:@example.test/cover.jpg",
  "https://", "https://?cover.jpg", "https:///cover.jpg", "https://exa mple.test/cover.jpg",
  "https://example.test:bad/cover.jpg", "https://example.test:65536/cover.jpg",
  "https://exa\nmple.test/cover.jpg", "https://example.test/cover\\art.jpg",
  "//example.test/cover.jpg", "file:///cover.jpg", "content://private/cover",
  "data:image/png;base64,AAAA", "javascript:alert(1)", "ftp://example.test/cover.jpg",
];

for (const runtime of ["Node", "RN"]) {
  for (const origin of ["picUrl", "img", "gateway"]) {
    test(`${runtime} 真实 URL 实现下 ${origin} 保留合法封面并拒绝凭证、非法协议及 authority`, async t => {
      if (runtime === "RN") {
        const NativeURL = loadReactNativeURL();
        t.mock.method(globalThis, "URL", function (...args) { return new NativeURL(...args); });
      }
      for (const [valid, urls] of [[true, VALID_COVER_URLS], [false, INVALID_COVER_URLS]]) {
        for (const url of urls) {
          const candidate = online({ picUrl: undefined, [origin]: origin === "gateway"
            ? { source: "netease", trackId: "track", picId: "picture" } : url });
          const h = harness({ results: { wy: [candidate] }, pic: async () => response({ url }) });
          const result = await h.find(local(), BOTH);
          assert.equal(result.status, "matched");
          assert.deepEqual(result.lyrics, LYRICS);
          assert.equal(result.coverUrl, valid ? url.trim() : undefined);
          assert.equal(h.calls.pic.length, origin === "gateway" ? 1 : 0);
          if (valid) assert.ok(!result.issues.some(issue => issue.includes(":cover:")));
          else assertIssue(result, /cover.*invalid/);
        }
      }
    });
  }
}


const gatewaySong = (source, extra = {}) => online({
  source, id: `${source}-gateway`, interval: undefined,
  gateway: { source: source === "wy" ? "netease" : "joox", trackId: `${source}-track`, lyricId: `${source}-lyric`, picId: `${source}-pic` },
  ...extra,
});

test("追加网关：官方缺失歌曲仍可从网关严格匹配，歌词不经过官方", async () => {
  const h = harness({ gatewayResults: { wy: [gatewaySong("wy")] } });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(result.coverUrl, COVER);
  assert.deepEqual(h.calls.gatewaySearch, [["wy", "夜航"], ["tx", "夜航"]]);
  assert.equal(h.calls.directLyrics.length, 0);
  assert.equal(h.calls.gatewayLyrics.length, 1);
  assert.equal(result.candidate.gatewaySource, "netease");
  assert.equal(result.candidate.gatewayTrackId, "wy-track");
});

test("追加网关：官方非空但全是翻唱，含 gateway 的网易官方结果也不阻止补查", async () => {
  const original = gatewaySong("wy");
  const h = harness({ results: { wy: [online({ singer: "翻唱者", gateway: { source: "netease", trackId: "wy-1", lyricId: "wy-1" } })] }, gatewayResults: { wy: [original] } });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.id, original.id);
  assert.equal(h.calls.directLyrics.length, 0);
  assert.deepEqual(h.calls.gatewayLyrics.map(song => song.gateway.source), ["netease"]);
  assert.ok(h.calls.gatewaySearch.some(([source]) => source === "wy"));
});

test("追加网关：QQ 无歌词但同一录音的 JOOX 有，原生 ID 与网关 namespace 分开", async () => {
  const joox = gatewaySong("tx", { id: "qq-native-mid" });
  const h = harness({ results: { tx: [tx()] }, gatewayResults: { tx: [joox] }, lyrics: async () => [], gatewayLyrics: async () => LYRICS });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(result.coverUrl, COVER);
  assert.deepEqual(h.calls.directLyrics.map(song => song.id), ["qq-native-mid"]);
  assert.deepEqual(h.calls.gatewayLyrics.map(song => song.gateway.source), ["joox"]);
  assert.equal(h.calls.lyrics.length, 2);
});

test("追加网关：重判变歧义时丢弃旧部分资料，不能凭先前匹配继续套用", async () => {
  const h = harness({ results: { tx: [tx()] }, lyrics: async () => [], gatewayResults: { tx: [gatewaySong("tx", { albumName: "另一张专辑", interval: 210 })] } });
  const result = await h.find(local(), BOTH);
  assertNoAssets(result, "ambiguous");
  assert.equal(h.calls.directLyrics.length, 1);
  assert.equal(h.calls.gatewayLyrics.length, 0);
});

test("追加网关：新胜出身份不继承落选旧身份的封面", async () => {
  const old = tx({ albumName: "旧专辑", interval: undefined });
  const newer = gatewaySong("tx", { id: "new-recording", interval: 210, picUrl: undefined, gateway: { source: "joox", trackId: "new-track", lyricId: "new-lyric" } });
  const h = harness({ results: { tx: [old] }, gatewayResults: { tx: [newer] }, lyrics: async () => [], gatewayLyrics: async () => LYRICS });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.id, "new-recording");
  assert.equal(result.candidate.gatewaySource, "joox");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(result.coverUrl, undefined);
});

test("追加网关：同组复用已经获取的歌词与 pic，不重复失败请求", async () => {
  const native = online({ picUrl: undefined, gateway: { source: "netease", trackId: "wy-1", lyricId: "wy-1", picId: "native-pic" } });
  const h = harness({ results: { wy: [native] }, gatewayResults: { tx: [gatewaySong("tx")] }, pic: async () => response({}) });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(result.coverUrl, COVER);
  assert.equal(h.calls.directLyrics.length, 1);
  assert.equal(h.calls.gatewayLyrics.length, 0);
  assert.equal(h.calls.pic.length, 1);
  assertIssue(result, /cover.*missing/);
});

test("追加网关：已有真实网关召回不重复查询；仅有网易官方 gateway 元数据不算", async () => {
  const h = harness({ results: { tx: [gatewaySong("tx")], wy: [online({ gateway: { source: "netease", trackId: "wy-1", lyricId: "wy-1" } })] }, lyrics: async () => [], gatewayLyrics: async () => [] });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.deepEqual(h.calls.gatewaySearch, [["wy", "夜航"]]);
  assert.equal(h.calls.directLyrics.length, 1);
  assert.equal(h.calls.gatewayLyrics.length, 1);
  const existing = harness({ results: { wy: [gatewaySong("wy")], tx: [gatewaySong("tx")] }, gatewayLyrics: async () => [] });
  await existing.find(local(), BOTH);
  assert.equal(existing.calls.gatewaySearch.length, 0);
  assert.equal(existing.calls.directLyrics.length, 0);
});

test("追加网关：所需资源完整时不补查，补查也不得放宽版本或歌手", async () => {
  const complete = harness({ results: { tx: [tx()] } });
  await complete.find(local(), BOTH);
  assert.equal(complete.calls.gatewaySearch.length, 0);
  for (const extra of [{ singer: "另一歌手" }, { name: "夜航 (Live)" }, { interval: 240 }]) {
    const h = harness({ gatewayResults: { wy: [gatewaySong("wy", extra)] } });
    assertNoAssets(await h.find(local(), BOTH), "not-found");
    assert.equal(h.calls.gatewaySearch.length, 2);
    assert.equal(h.calls.lyrics.length, 0);
  }
});

test("追加网关：独立 provider 失败可见且最多补查一轮，不漏出上游敏感错误", async () => {
  const h = harness({ gatewayResults: { wy: new Error("https://private.test/?secret=hidden"), tx: [gatewaySong("tx")] } });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assertIssue(result, /wy.*gateway.*search.*failed/);
  assert.doesNotMatch(result.issues.join(" "), /secret|private/);
  assert.equal(h.calls.gatewaySearch.length, 2);
  const empty = harness({ gatewayResults: { wy: [], tx: [] } });
  assertNoAssets(await empty.find(local(), BOTH), "not-found");
  assert.equal(empty.calls.gatewaySearch.length, 2);
});

function loadGatewayApi(fetchWithTimeout) {
  const parser = createLoader({})("../../packages/core/src/lyrics/parser.ts");
  return createLoader({
    "@lx/core": { ...core, ...parser },
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

test("追加网关：同一实际 pic 请求跨 direct/gateway 仍只发送一次", async () => {
  const gateway = { source: "netease", trackId: "wy-1", lyricId: "wy-1", picId: "shared-picture" };
  const h = harness({
    results: { wy: [online({ picUrl: undefined, gateway })] },
    gatewayResults: { wy: [gatewaySong("wy", { id: "wy-1", picUrl: undefined, gateway })] },
    pic: async () => response({}),
  });
  const result = await h.find(local(), BOTH);
  assert.equal(result.status, "matched");
  assert.deepEqual(result.lyrics, LYRICS);
  assert.equal(result.coverUrl, undefined);
  assert.equal(h.calls.pic.length, 1);
  assert.equal(h.calls.lyrics.length, 1);
});

test("追加网关：大批同组候选仍按 namespace 限次，重判不重发旧歌词请求", async () => {
  const make = source => Array.from({ length: 30 }, (_, i) => gatewaySong(source, { id: `${source}-${i}`, picUrl: undefined, gateway: { source: source === "wy" ? "netease" : "joox", trackId: `${source}-track-${i}`, picId: `${source}-pic-${i}` } }));
  const h = harness({
    results: { wy: [online({ picUrl: undefined })], tx: [tx({ picUrl: undefined })] },
    gatewayResults: { wy: make("wy"), tx: make("tx") },
    lyrics: async () => [], gatewayLyrics: async () => [], pic: async () => response({}),
  });
  await h.find(local(), BOTH);
  assert.equal(h.calls.search.length, 2);
  assert.equal(h.calls.gatewaySearch.length, 2);
  assert.equal(h.calls.directLyrics.length, 2);
  assert.equal(h.calls.gatewayLyrics.length, 2);
  assert.equal(h.calls.pic.length, 2);
});
