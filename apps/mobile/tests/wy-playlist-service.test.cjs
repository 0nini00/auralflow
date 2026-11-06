const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

const COOKIE = "MUSIC_U=FAKE_SESSION; __csrf=FAKE_CSRF; os=android";
const RISK_MESSAGE = "检测到您的网络环境存在风险，请稍后再试";

function setup(responses, cookie = COOKIE) {
  const requests = [];
  const payloads = [];
  const load = createLoader({
    "./wyAccountService": { getWyCookie: async () => cookie },
    "@/services/weapi": {
      weapi: async (payload) => {
        payloads.push(payload);
        return { params: "encrypted+params", encSecKey: "test-key" };
      },
    },
    "@/utils/fetchWithTimeout": {
      fetchWithTimeout: async (url, init) => {
        const index = requests.length;
        requests.push({ url, ...init });
        assert.ok(index < responses.length, "不得发出未预期的重试请求");
        const response = responses[index];
        if (response instanceof Error) throw response;
        return response instanceof Response ? response : Response.json(response);
      },
    },
  });
  return { api: load("src/services/wyPlaylistService.ts"), requests, payloads };
}

for (const [method, op] of [["addPlaylistTracks", "add"], ["removePlaylistTracks", "del"]]) {
  for (const cookie of [COOKIE, "MUSIC_U=FAKE_SESSION; __csrf=FAKE_CSRF"]) {
    test(`${method} 保留登录会话 Cookie：${cookie.includes("os=") ? "已有 os" : "无 os"}`, async () => {
      const h = setup([{ code: 200 }], cookie);
      await h.api[method]("playlist-1", ["song-1", "song-2"]);
      assert.equal(h.requests.length, 1);
      assert.equal(h.requests[0].url, "https://music.163.com/weapi/playlist/manipulate/tracks");
      assert.equal(h.requests[0].method, "POST");
      assert.equal(h.requests[0].headers.Cookie, cookie);
      assert.equal(h.requests[0].headers["Content-Type"], "application/x-www-form-urlencoded");
      assert.deepEqual(Object.fromEntries(new URLSearchParams(h.requests[0].body)), {
        params: "encrypted+params", encSecKey: "test-key",
      });
      assert.deepEqual(h.payloads, [{
        op, pid: "playlist-1", trackIds: '["song-1","song-2"]', imme: "true", csrf_token: "FAKE_CSRF",
      }]);
    });
  }
}

test("添加歌曲的 512 兼容重试保留原始 Cookie 并仅重复一次歌曲 ID", async () => {
  const h = setup([{ code: 512 }, { code: 201 }]);
  await h.api.addPlaylistTracks("playlist-1", ["song-1", "song-2"]);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests.map((request) => request.headers.Cookie), [COOKIE, COOKIE]);
  assert.deepEqual(h.payloads.map((payload) => JSON.parse(payload.trackIds)), [
    ["song-1", "song-2"], ["song-1", "song-2", "song-1", "song-2"],
  ]);
  assert.ok(h.payloads.every((payload) => payload.op === "add" && payload.csrf_token === "FAKE_CSRF"));
});

for (const subscribe of [true, false]) {
  test(`歌单${subscribe ? "订阅" : "取消订阅"}保留现有 PC Cookie 行为`, async () => {
    const h = setup([{ code: 200 }]);
    await h.api.subscribePlaylist("playlist-1", subscribe);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].url, "https://music.163.com/weapi/playlist/subscribe");
    assert.equal(h.requests[0].headers.Cookie, "MUSIC_U=FAKE_SESSION; __csrf=FAKE_CSRF; os=pc");
    assert.deepEqual(h.payloads, [{ id: "playlist-1", t: subscribe ? 1 : 2, csrf_token: "FAKE_CSRF" }]);
  });
}

for (const method of ["addPlaylistTracks", "removePlaylistTracks"]) {
  test(`${method} 原样报告服务端风控且不自动重试`, async () => {
    const h = setup([{ code: 405, message: RISK_MESSAGE }]);
    await assert.rejects(h.api[method]("playlist-1", ["song-1"]), { message: RISK_MESSAGE });
    assert.equal(h.requests.length, 1);
  });
}

test("删除歌曲收到 512 时直接失败，不执行添加专用的兼容重试", async () => {
  const h = setup([{ code: 512, message: "删除失败" }]);
  await assert.rejects(h.api.removePlaylistTracks("playlist-1", ["song-1"]), { message: "删除失败" });
  assert.equal(h.requests.length, 1);
});

test("添加歌曲兼容重试仍被风控拒绝时保留失败", async () => {
  const h = setup([{ code: 512 }, { code: 405, message: RISK_MESSAGE }]);
  await assert.rejects(h.api.addPlaylistTracks("playlist-1", ["song-1"]), { message: RISK_MESSAGE });
  assert.equal(h.requests.length, 2);
});

test("301 保留登录过期错误类型且不重试", async () => {
  const h = setup([{ code: 301 }]);
  await assert.rejects(h.api.addPlaylistTracks("playlist-1", ["song-1"]), {
    name: "WyAuthExpiredError", message: "网易云登录已过期，请重新登录",
  });
  assert.equal(h.requests.length, 1);
});

test("HTTP 风控失败原样报告服务端消息", async () => {
  const h = setup([Response.json({ code: 403, message: RISK_MESSAGE }, { status: 403 })]);
  await assert.rejects(h.api.addPlaylistTracks("playlist-1", ["song-1"]), { message: RISK_MESSAGE });
  assert.equal(h.requests.length, 1);
});

test("网络异常保持原错误对象且不重试", async () => {
  const error = new Error("网络请求中断");
  const h = setup([error]);
  await assert.rejects(h.api.addPlaylistTracks("playlist-1", ["song-1"]), (actual) => actual === error);
  assert.equal(h.requests.length, 1);
});

test("非 JSON 响应明确失败且不重试", async () => {
  const h = setup([new Response("<html>blocked</html>")]);
  await assert.rejects(h.api.addPlaylistTracks("playlist-1", ["song-1"]), /网易云返回异常响应/);
  assert.equal(h.requests.length, 1);
});

test("用户歌单保留远端数量及创建者，并通过创建者区分缺失 subscribed 的歌单", async () => {
  const h = setup([{ code: 200, playlist: [
    { id: 1, name: "自己的歌单", trackCount: 369, creator: { userId: 42, nickname: "本人" } },
    { id: 2, name: "收藏的歌单", trackCount: 81, subscribed: null, creator: { userId: 99, nickname: "作者" } },
    { id: 3, name: "明确收藏", trackCount: 12, subscribed: true, creator: { userId: 42, nickname: "本人" } },
  ] }]);
  const playlists = await h.api.getUserPlaylists("42");
  assert.equal(h.requests[0].headers.Cookie, COOKIE);
  assert.deepEqual(playlists.map(({ trackCount, creator, subscribed }) => ({ trackCount, creator, subscribed })), [
    { trackCount: 369, creator: { userId: "42", nickname: "本人" }, subscribed: false },
    { trackCount: 81, creator: { userId: "99", nickname: "作者" }, subscribed: true },
    { trackCount: 12, creator: { userId: "42", nickname: "本人" }, subscribed: true },
  ]);
});
