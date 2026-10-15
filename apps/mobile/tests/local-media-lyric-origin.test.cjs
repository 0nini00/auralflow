const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createLoader, mobileRoot } = require("./helpers/loadTs.cjs");

const model = createLoader({})("src/services/localMediaPlaybackModel.ts");
const assets = createLoader({})("src/services/localMediaAssetsService.ts");

const song = { id: "42", source: "local", isLocal: true, url: "file:///music/a.flac", name: "歌曲", singer: "歌手", albumName: "专辑", interval: 210 };
const lines = [{ time: 1, text: "歌词" }];
const ORIGIN = { tier: "other-performer", performer: "翻唱者", source: "wy" };

function setup() {
  const cache = new Map();
  const behavior = { native: { signature: "file-v1", warnings: [] }, search: { status: "not-found", issues: [] } };
  const deps = {
    readLocal: async () => behavior.native,
    readCache: async key => cache.get(key) ?? null,
    writeCache: async (key, value) => { cache.set(key, value); },
    cover: async uri => uri,
    parse: async raw => raw ? [{ time: 1, text: raw }] : [],
    search: async () => behavior.search,
    now: () => 1000,
  };
  const resolver = assets.createLocalMediaResolver(deps);
  return {
    behavior, cache,
    resolve: target => resolver.resolve(target || song, () => {}, () => true),
    cacheKey: signature => JSON.stringify([assets.localMediaInputKey(song), signature]),
  };
}

test("来源标注只在当前本地曲的补全结果上成立，并渲染成演唱版本提示", () => {
  const localMedia = {
    songKey: model.localMediaSongKey(song), requestId: 1, status: "matched", message: "", issues: [],
    lyricOrigin: ORIGIN,
  };
  assert.equal(model.selectLocalMediaLyricOriginLabel({ currentSong: song, localMedia }), "歌词来自 翻唱者 的演唱版本");
  assert.equal(model.formatLyricOriginLabel({ tier: "other-performer" }), "歌词来自其他演唱版本");
  assert.equal(model.formatLyricOriginLabel({ tier: "same-recording", source: "lrclib" }), "歌词来自 LRCLIB");
  assert.equal(model.formatLyricOriginLabel({ tier: "same-recording" }), undefined);
  assert.equal(model.formatLyricOriginLabel(undefined), undefined);
  // 过期补全（songKey 不匹配）、非本地曲、没有补全结果都不标注。
  assert.equal(model.selectLocalMediaLyricOriginLabel({ currentSong: song, localMedia: { ...localMedia, songKey: "" } }), undefined);
  assert.equal(model.selectLocalMediaLyricOriginLabel({
    currentSong: { id: "x", source: "wy", name: "x", singer: "", albumName: "" }, localMedia,
  }), undefined);
  assert.equal(model.selectLocalMediaLyricOriginLabel({ currentSong: song, localMedia: null }), undefined);
});

test("新增来源标注不改变缓存键语义", () => {
  // 缓存键仍只由歌曲身份 + 文件签名决定；把标注塞进歌曲也不会改变键，既有缓存不会因此失效。
  assert.equal(assets.localMediaInputKey({ ...song, lyricOrigin: ORIGIN }), assets.localMediaInputKey(song));
  assert.equal(assets.localMediaInputKey(song).includes("other-performer"), false);
});

test("同曲异唱来源标注随缓存一起持久化；旧缓存缺该字段仍按无标注复用", async () => {
  const h = setup();
  h.behavior.search = {
    status: "matched", lyrics: lines, coverUrl: "https://example.test/cover",
    candidate: { source: "wy", id: "cover-version", name: "歌曲", singer: "翻唱者" },
    lyricOrigin: ORIGIN, issues: [],
  };
  const first = await h.resolve();
  assert.equal(first.status, "matched");
  assert.deepEqual(first.lyricOrigin, ORIGIN);
  const stored = h.cache.get(h.cacheKey("file-v1"));
  assert.deepEqual(stored.lyricOrigin, ORIGIN);
  // 旧版本文件（v1，但没有 lyricOrigin）结构仍兼容：读出来只是「没有可标注的来源」。
  delete stored.lyricOrigin;
  const reused = await h.resolve();
  assert.equal(reused.status, "cached");
  assert.deepEqual(reused.lyrics, lines);
  assert.equal(reused.lyricOrigin, undefined);
});

test("LRCLIB 判定纯音乐时提示「纯音乐，无歌词」，不说未找到匹配", async () => {
  const h = setup();
  h.behavior.search = { status: "not-found", issues: ["lrclib:instrumental"] };
  const result = await h.resolve();
  assert.equal(result.status, "local");
  assert.equal(result.message, "纯音乐，无歌词");
  assert.deepEqual(result.lyrics, []);
  assert.equal(h.cache.size, 0);
});

test("来源标注短时显示后自行退场，且不参与歌词页布局流", () => {
  const read = name => fs.readFileSync(path.join(mobileRoot, "src", name), "utf8");
  const screen = read("screens/ImmersiveLyricsScreen.tsx");
  const controller = read("screens/immersive/useImmersiveController.ts");
  const hook = read("screens/immersive/useLyricOriginNote.ts");
  // 渲染：仍然绝对定位，但用的是「短时显示的 note」，不再是常驻的 label
  assert.match(screen, /styles\.lyricOriginNote/);
  assert.match(screen, /\{lyricOriginNote\.text\}/);
  assert.doesNotMatch(screen, /\{localMediaLyricOriginLabel\}/);
  // 控制器：选择器 + 把页面可见性交给 hook（页面不可见时不挂待触发的隐藏计时）
  assert.match(controller, /selectLocalMediaLyricOriginNote/);
  assert.match(controller, /useLyricOriginNote\(localMediaLyricOriginNoteModel, visible\)/);
  // hook：到点清空；内容变化/卸载时清掉计时器
  assert.match(hook, /setTimeout\(\(\) => setShown\(undefined\), holdMs\)/);
  assert.match(hook, /return \(\) => clearTimeout\(timer\)/);
  assert.match(read("screens/immersive/immersiveStyles.ts"), /lyricOriginNote:\s*\{[\s\S]*?position:\s*"absolute"/);
});

test("标注停留时长：同曲异唱久于歌词库出处，无标注时不产生 note", () => {
  assert.equal(model.buildLyricOriginNote(ORIGIN).holdMs, 10000);
  assert.equal(model.buildLyricOriginNote(ORIGIN).text, "歌词来自 翻唱者 的演唱版本");
  assert.equal(model.buildLyricOriginNote({ tier: "same-recording", source: "lrclib" }).holdMs, 4000);
  assert.equal(model.buildLyricOriginNote({ tier: "same-recording" }), undefined);
  assert.equal(model.buildLyricOriginNote(undefined), undefined);
});

test("纯音乐但同时补到封面时仍是 matched +「纯音乐，无歌词」，封面照常缓存", async () => {
  const h = setup();
  h.behavior.search = { status: "matched", coverUrl: "https://example.test/cover", issues: ["lrclib:instrumental"] };
  const result = await h.resolve();
  assert.equal(result.status, "matched");
  assert.equal(result.message, "纯音乐，无歌词");
  assert.deepEqual(result.lyrics, []);
  assert.equal(result.coverUri, "https://example.test/cover");
  assert.equal(h.cache.get(h.cacheKey("file-v1")).coverUri, "https://example.test/cover");
});
