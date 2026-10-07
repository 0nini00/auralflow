const assert = require("node:assert/strict");
const test = require("node:test");
const fixture = require("./fixtures/song-comments.json");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

const PLACEHOLDER = "[发布了语音，请前往最新移动端版本查看]";
const VOICE = { url: fixture.contentResource.url, duration: 54 };

function loadComments(fetchWithTimeout) {
  // 隔离无关搜索/原生依赖，保留真实 fetchText 和评论解析链路。
  return createLoader({
    "@lx/core": { createBuiltinMusicApiClient: () => ({}) },
    "./searchResultCache": {},
    "./songMetadataMerge": {},
    "./txPlaylistService": {},
    "./wySearchService": {},
    "./wyMusicMapper": {},
    "./wyDirectProvider": {},
    "@/utils/fetchWithTimeout": { fetchWithTimeout },
  })("src/services/musicApi.ts").fetchNeteaseComments;
}

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 503, text: async () => body };
}

function fetchPayload(payload) {
  return loadComments(async () => response(JSON.stringify(payload)))("test-song");
}

function page(comments, total = comments.length) {
  return { code: 200, total, comments };
}

async function parseComment(overrides = {}) {
  const result = await fetchPayload(page([{ ...fixture, ...overrides }]));
  return result.comments[0];
}

function assertUnavailable(comment) {
  assert.equal(comment.voice, undefined);
  assert.equal(typeof comment.voiceError, "string");
  assert.match(comment.voiceError, /语音.*不可用/);
}

test("真实 contentResource 结构映射为秒数语音并保留脱敏附文", async () => {
  const comment = await parseComment();
  assert.deepEqual(comment.voice, VOICE);
  assert.equal(comment.voiceError, undefined);
  assert.equal(comment.content, "测试附文");
});

for (const [content, expected] of [
  [PLACEHOLDER, ""],
  [`\n${PLACEHOLDER}`, ""],
  [`附文\r\n${PLACEHOLDER}`, "附文"],
  [`  附文\n第二行  \n${PLACEHOLDER}`, "  附文\n第二行  "],
  ["  没有占位的附文\n", "  没有占位的附文\n"],
]) {
  test(`语音正文仅移除固定尾部占位：${JSON.stringify(content)}`, async () => {
    const comment = await parseComment({ content });
    assert.equal(comment.content, expected);
    assert.deepEqual(comment.voice, VOICE);
  });
}

for (const contentResource of [undefined, null, {}, { resourceType: 1 }, { resourceType: 9999 }, { resourceType: "1014" }]) {
  test(`非语音及未知资源不推断语音、不清理用户文字：${JSON.stringify(contentResource)}`, async () => {
    const content = `  用户文字\n${PLACEHOLDER}\n `;
    const comment = await parseComment({ content, contentResource });
    assert.equal(comment.content, content);
    assert.equal(comment.voice, undefined);
    assert.equal(comment.voiceError, undefined);
  });
}

const VALID_VOICE_URLS = [
  "http://example.test/audio.m4a?format=original#part",
  "https://media.example.test:8443/audio.m4a",
  "https://another.example.test/path/@audio.m4a?email=sample@example.test",
  "HTTPS://example.test/audio.m4a",
];

for (const url of VALID_VOICE_URLS) {
  test(`有效 URL 保持原协议、主机、路径和查询：${url}`, async () => {
    const comment = await parseComment({ contentResource: { ...fixture.contentResource, url } });
    assert.deepEqual(comment.voice, { url, duration: 54 });
  });
}

const INVALID_VOICE_URLS = [
  undefined, null, "", 123, {}, "not-a-url", "/audio.m4a", "//example.test/audio.m4a",
  "https://", "https://?audio.m4a", "https://exa mple.test/audio.m4a",
  "https://example.test:bad/audio.m4a", "https://example.test:99999/audio.m4a",
  "file:///audio.m4a", "data:audio/mp4;base64,AAAA", "javascript:alert(1)",
  "ftp://example.test/audio.m4a", "https://sample@example.test/audio.m4a",
  "http://sample:password@example.test/audio.m4a", "https://:password@example.test/audio.m4a",
];

for (const url of INVALID_VOICE_URLS) {
  test(`无效/非 HTTP(S)/带凭证语音地址显式不可用：${JSON.stringify(url)}`, async () => {
    const comment = await parseComment({ contentResource: { ...fixture.contentResource, url } });
    assertUnavailable(comment);
    assert.equal(comment.content, "测试附文");
  });
}

for (const duration of [undefined, null, 0, -1, "54", true, NaN, Infinity, -Infinity]) {
  test(`无效秒数不生成可播放语音：${String(duration)}`, async () => {
    const comment = await parseComment({ contentResource: { ...fixture.contentResource, duration } });
    assertUnavailable(comment);
    assert.equal(comment.content, "测试附文");
  });
}

test("正数小数秒原样保留，不按毫秒换算", async () => {
  const comment = await parseComment({ contentResource: { ...fixture.contentResource, duration: 0.25 } });
  assert.equal(comment.voice.duration, 0.25);
});

test("缺少标准 URL 时不猜 audioUrl、shareUrl 等替代字段", async () => {
  const comment = await parseComment({ contentResource: {
    resourceType: 1014, duration: 54, audioUrl: VOICE.url, shareUrl: VOICE.url,
  } });
  assertUnavailable(comment);
});

test("纯语音的无效元数据仍产生显式不可用行", async () => {
  const comment = await parseComment({ content: PLACEHOLDER, contentResource: { resourceType: 1014 } });
  assert.equal(comment.content, "");
  assertUnavailable(comment);
});

test("回复独立解析实际 contentResource，不继承主评论语音", async () => {
  const reply = { user: { nickname: "测试回复者" }, content: fixture.content };
  const comment = await parseComment({ beReplied: [
    { ...reply, contentResource: fixture.contentResource },
    { ...reply, contentResource: { resourceType: 1014 } },
    { ...reply, content: PLACEHOLDER, contentResource: fixture.contentResource },
    { ...reply, contentResource: { resourceType: 9999 } },
    reply,
  ] });
  assert.deepEqual(comment.beReplied[0], { nickname: "测试回复者", content: "测试附文", voice: VOICE });
  assertUnavailable(comment.beReplied[1]);
  assert.equal(comment.beReplied[1].content, "测试附文");
  assert.equal(comment.beReplied[2].content, "");
  assert.deepEqual(comment.beReplied[2].voice, VOICE);
  for (const item of comment.beReplied.slice(3)) {
    assert.deepEqual(item, { nickname: "测试回复者", content: fixture.content });
  }
});

test("普通文本、元数据和无 user 的回复过滤维持既有语义", async () => {
  const comment = await parseComment({
    commentId: 7, content: "  普通评论\n第二行  ", contentResource: null,
    user: { userId: "synthetic-user", nickname: "测试昵称", avatarUrl: "https://example.test/avatar.png" },
    likedCount: 3, time: 1234,
    beReplied: [null, { content: "已删除" }, { user: { nickname: "测试回复" }, content: "  原文\n" }],
  });
  assert.deepEqual(comment, {
    id: "7", content: "  普通评论\n第二行  ", userId: "synthetic-user", nickname: "测试昵称",
    avatarUrl: "https://example.test/avatar.png", likedCount: 3, createdAt: 1234,
    beReplied: [{ nickname: "测试回复", content: "  原文\n" }],
  });
});

test("没有评论的真实成功响应可返回空列表", async () => {
  assert.deepEqual(await fetchPayload(page([], 0)), { total: 0, comments: [] });
  assert.deepEqual(await fetchPayload(page([], 50)), { total: 50, comments: [] });
});

test("请求接口、默认分页及翻页参数保持不变", async () => {
  const requests = [];
  const fetchComments = loadComments(async (...args) => {
    requests.push(args);
    return response(JSON.stringify(page([fixture], 100)));
  });
  assert.equal((await fetchComments("song/1")).total, 100);
  await fetchComments("song/1", 20, 10);
  assert.deepEqual(requests.map(([url]) => url), [
    "https://music.163.com/api/v1/resource/comments/R_SO_4_song%2F1?rid=R_SO_4_song%2F1&offset=0&total=false&limit=20",
    "https://music.163.com/api/v1/resource/comments/R_SO_4_song%2F1?rid=R_SO_4_song%2F1&offset=20&total=true&limit=10",
  ]);
  assert.equal(requests[0][1].headers.Accept, "application/json,text/plain,*/*");
});

test("HTTP 失败即使含成功业务 JSON 也抛错", async () => {
  const fetchComments = loadComments(async () => response(JSON.stringify(page([])), false));
  await assert.rejects(fetchComments("test-song"), /请求失败/);
});

test("网络失败原样向既有错误 UI 传播", async () => {
  const error = new Error("测试网络失败");
  const fetchComments = loadComments(async () => { throw error; });
  await assert.rejects(fetchComments("test-song"), (actual) => actual === error);
});

test("响应正文读取失败原样传播", async () => {
  const error = new Error("测试读取失败");
  const fetchComments = loadComments(async () => ({ ok: true, text: async () => { throw error; } }));
  await assert.rejects(fetchComments("test-song"), (actual) => actual === error);
});

for (const body of ["", "<html>not JSON</html>", '{"code":200,']) {
  test(`JSON 解析失败不能伪装空列表：${JSON.stringify(body)}`, async () => {
    const fetchComments = loadComments(async () => response(body));
    await assert.rejects(fetchComments("test-song"), SyntaxError);
  });
}

for (const code of [301, 403, 500]) {
  test(`HTTP 成功但业务 code=${code} 必须抛错`, async () => {
    await assert.rejects(fetchPayload({ ...page([fixture]), code, message: "测试服务错误" }), new RegExp(String(code)));
  });
}

for (const payload of [
  null, [], {}, { comments: [], total: 0 }, { code: "200", comments: [], total: 0 },
  { code: 200, total: 0 }, { code: 200, total: 0, comments: null },
  { code: 200, total: 0, comments: {} }, { code: 200, comments: [] },
  { code: 200, total: "bad", comments: [] }, { code: 200, total: -1, comments: [] },
  { code: 200, total: null, comments: [] }, { code: 200, total: 1.5, comments: [] },
  page([null]), page(["bad-comment"]), page([{ ...fixture, content: {} }]),
]) {
  test(`响应边界无效时明确失败：${JSON.stringify(payload)}`, async () => {
    await assert.rejects(fetchPayload(payload), /评论/);
  });
}

test("JSON 大指数产生 Infinity 时仍明确拒绝时长及总数", async () => {
  const voiceBody = JSON.stringify(page([fixture])).replace('"duration":54', '"duration":1e400');
  const fetchComments = loadComments(async () => response(voiceBody));
  assertUnavailable((await fetchComments("test-song")).comments[0]);
  const invalidTotal = loadComments(async () => response('{"code":200,"total":1e400,"comments":[]}'));
  await assert.rejects(invalidTotal("test-song"), /评论/);
});

// 使用安装版本的 RN URL，而非假设 Node 的 WHATWG 校验等同于移动端。
function loadReactNativeURL() {
  const { code } = mobileRequire("@babel/core").transformFileSync(
    mobileRequire.resolve("react-native/Libraries/Blob/URL.js"),
    { presets: [mobileRequire.resolve("@react-native/babel-preset")], babelrc: false, configFile: false },
  );
  const module = { exports: {} };
  const requireDependency = (name) => {
    if (name === "./NativeBlobModule") return { __esModule: true, default: null };
    if (name === "./URLSearchParams") return { URLSearchParams };
    return mobileRequire(name);
  };
  new Function("require", "module", "exports", code)(requireDependency, module, module.exports);
  return module.exports.URL;
}

test("移动端原生 URL 实现下地址边界与 Node 一致", async (t) => {
  const NativeURL = loadReactNativeURL();
  t.mock.method(globalThis, "URL", function (...args) { return new NativeURL(...args); });
  for (const url of VALID_VOICE_URLS) {
    const comment = await parseComment({ contentResource: { ...fixture.contentResource, url } });
    assert.deepEqual(comment.voice, { url, duration: 54 }, url);
  }
  for (const url of INVALID_VOICE_URLS) {
    const comment = await parseComment({ contentResource: { ...fixture.contentResource, url } });
    assertUnavailable(comment);
  }
});
