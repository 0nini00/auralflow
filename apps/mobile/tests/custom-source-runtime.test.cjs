const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, mobileRequire } = require("./helpers/loadTs.cjs");

// 脚本协议与深度测试编排在 @lx/core（按真实源码加载）；这里锁住移动端宿主的接线：
// WebView 桥路由、运行时缓存的去留、出站校验与远端脚本拉取。

const song = { id: "1", source: "wy", name: "测试曲", singer: "歌手", albumName: "专辑" };
const header = version => `/*\n * @name 测试源\n * @version ${version}\n */\n`;
const wy = (actions = ["musicUrl"]) => ({ wy: { type: "music", actions, qualitys: ["128k"] } });

function api(overrides = {}) {
  return {
    id: "runtime-test", name: "测试源", description: "", script: `${header("1.0.0")}// fixture`, enabled: true,
    allowShowUpdateAlert: true, testStatus: "idle", updateStatus: "idle", createdAt: 1, updatedAt: 1, ...overrides,
  };
}

/**
 * 假 WebView：`run` 立即回 inited，`request` 交给 respond 决定应答。
 * respond 返回 undefined 表示脚本迟迟不应答。
 */
function fixture(options = {}) {
  const sent = [];
  const fetches = [];
  let handlers;
  const respond = options.respond ?? (() => ({ result: "https://example.com/song.mp3" }));
  const load = createLoader({
    "crypto-js": mobileRequire("crypto-js"),
    "@/services/customSourceWebViewBridge": {
      setLxBridgeHandlers: next => { handlers = next; },
      waitForBridge: async () => {},
      sendToWebView: msg => {
        sent.push(msg);
        if (msg.type === "run") {
          handlers.onMessage({ type: "inited", rid: msg.rid, sources: { sources: options.sources ?? wy() }, updateAlert: options.updateAlert });
        }
        if (msg.type === "request") {
          const reply = respond(msg.payload, msg, handlers);
          if (reply) handlers.onMessage({ type: "request-response", rid: msg.rid, id: msg.id, ...reply });
        }
      },
    },
    "@/utils/fetchWithTimeout": {
      fetchWithTimeout: async (url, init, timeoutMs) => {
        fetches.push({ url, init, timeoutMs });
        return options.remote ?? { ok: true, status: 200, statusText: "OK", text: async () => `${header("1.0.0")}// fixture` };
      },
    },
    "./hiddenSourceSearchers": { hiddenSourceSearchers: [] },
  });
  const runtime = load("src/services/customSourceRuntime.ts");
  const count = type => sent.filter(msg => msg.type === type).length;
  return { runtime, sent, fetches, count, receive: msg => handlers.onMessage(msg) };
}

const flush = () => new Promise(setImmediate);

test("取消一个取链只取消它的 HTTP，另一个消费者继续完成", async t => {
  const requests = [];
  const h = fixture({ respond: (_payload, msg, handlers) => {
    requests.push(msg);
    handlers.onMessage({ type: "http", rid: msg.rid, id: `http-${msg.id}`, ownerId: msg.id, url: "https://example.com/data", options: {} });
  } });
  const fetches = [];
  t.mock.method(globalThis, "fetch", (_url, init) => new Promise((resolve, reject) => {
    fetches.push({ signal: init.signal, resolve });
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
  }));
  const controller = new AbortController();
  const old = h.runtime.requestCustomSourceMusicUrl(api(), { ...song, id: "old" }, "128k", undefined, undefined, controller.signal);
  const rejected = assert.rejects(old, /取消/);
  await flush();
  const current = h.runtime.requestCustomSourceMusicUrl(api(), song, "128k");
  await flush();
  controller.abort();
  await flush();
  const abortStates = fetches.map(request => request.signal.aborted);
  const second = requests.find(request => request.payload.info.musicInfo.songmid === song.id);
  h.receive({ type: "request-response", rid: second.rid, id: second.id, result: "https://example.com/current.mp3" });
  const result = await current;
  for (const request of fetches) request.resolve({ url: "https://example.com/data", status: 200, statusText: "OK", headers: new Headers(), text: async () => "{}" });
  h.runtime.invalidateRuntimeCache(api().id);
  await flush();
  assert.deepEqual(abortStates, [true, false]);
  await rejected;
  assert.equal(result.url, "https://example.com/current.mp3");
});

test("脚本扇出 HTTP 仍受全局真实在途上限约束", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = fixture({ respond: (_payload, msg, handlers) => {
    for (let i = 0; i < 12; i++) handlers.onMessage({ type: "http", rid: msg.rid, id: `http-${i}`, ownerId: msg.id, url: "https://example.com/data", options: {} });
  } });
  let active = 0;
  let peak = 0;
  t.mock.method(globalThis, "fetch", (_url, init) => new Promise((_resolve, reject) => {
    peak = Math.max(peak, ++active);
    init.signal.addEventListener("abort", () => { active--; reject(new Error("cancelled")); }, { once: true });
  }));
  const controller = new AbortController();
  const pending = h.runtime.requestCustomSourceMusicUrl(api(), song, "128k", undefined, undefined, controller.signal);
  const rejected = assert.rejects(pending, /取消/);
  await flush();
  t.mock.timers.tick(3_000);
  await flush();
  controller.abort();
  h.runtime.invalidateRuntimeCache(api().id);
  await rejected;
  await flush();
  assert.equal(peak, 3);
  assert.equal(active, 0);
});

test("取链把 lx 协议请求发给脚本并复用同一个运行时", async () => {
  const h = fixture();
  const first = await h.runtime.requestCustomSourceMusicUrl(api(), song, "128k");
  assert.deepEqual(first, { url: "https://example.com/song.mp3", quality: "128k", sources: wy() });
  await h.runtime.requestCustomSourceMusicUrl(api(), song, "128k");
  assert.equal(h.count("run"), 1);
  const { payload } = h.sent.find(msg => msg.type === "request");
  assert.equal(payload.source, "wy");
  assert.equal(payload.action, "musicUrl");
  assert.equal(payload.info.type, "128k");
  assert.equal(payload.info.musicInfo.songmid, "1");
});

test("全局池限制活动和空闲实例，重复访问仍复用最近保留的运行时", async () => {
  const h = fixture();
  for (let id = 0; id < 8; id++) await h.runtime.requestCustomSourceMusicUrl(api({ id: String(id) }), song, "128k");
  assert.equal(h.count("run") - h.count("dispose"), 3);
  await h.runtime.requestCustomSourceMusicUrl(api({ id: "7" }), song, "128k");
  assert.equal(h.count("run"), 8);
});

test("超时退休的实例不能留在缓存中复用", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const h = fixture({ respond: () => ++attempts === 1 ? undefined : { result: "https://example.com/retry.mp3" } });
  const first = h.runtime.requestCustomSourceMusicUrl(api(), song, "128k");
  const rejected = assert.rejects(first, /取链超时/);
  await flush();
  t.mock.timers.tick(30000);
  await rejected;
  const result = await h.runtime.requestCustomSourceMusicUrl(api(), song, "128k");
  assert.equal(result.url, "https://example.com/retry.mp3");
  assert.equal(h.count("run"), 2);
});

test("脚本报告遗留异步资源时退休实例，后续请求使用干净实例", async () => {
  const h = fixture({ respond: () => ({ result: "https://example.com/song.mp3", reusable: false }) });
  await h.runtime.requestCustomSourceMusicUrl(api(), song, "128k");
  await h.runtime.requestCustomSourceMusicUrl(api(), song, "128k");
  assert.equal(h.count("run"), 2);
  assert.equal(h.count("dispose"), 2);
});

test("全局名额被旧取链占满时公平取消持有者，新播放仍能开始", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pendingRequests = [];
  const h = fixture({ respond: (payload, request) => {
    if (payload.info.musicInfo.songmid === "new") return { result: "https://example.com/new.mp3" };
    pendingRequests.push(request);
  } });
  const old = Array.from({ length: 3 }, (_, id) => h.runtime.requestCustomSourceMusicUrl(api({ id: String(id) }), song, "128k").catch(error => error));
  await flush();
  let finished = false;
  const current = h.runtime.requestCustomSourceMusicUrl(api({ id: "new" }), { ...song, id: "new" }, "128k").then(result => { finished = true; return result; });
  await flush();
  t.mock.timers.tick(3500);
  await flush();
  const beforeRelease = finished;
  for (const request of pendingRequests) h.receive({ type: "request-response", rid: request.rid, id: request.id, result: "https://example.com/old.mp3" });
  await Promise.all([...old, current]);
  assert.equal(beforeRelease, true);
});

test("没有排队竞争时六秒慢请求仍可完成", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = fixture({ respond: (_payload, request, handlers) => {
    setTimeout(() => handlers.onMessage({ type: "request-response", rid: request.rid, id: request.id, result: "https://example.com/slow.mp3" }), 6000);
  } });
  const pending = h.runtime.requestCustomSourceMusicUrl(api(), song, "128k");
  await flush();
  t.mock.timers.tick(6000);
  assert.equal((await pending).url, "https://example.com/slow.mp3");
  assert.equal(h.count("dispose"), 0);
});

test("持续新增排队者不会重置最早持有者的让位期限", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pendingRequests = [];
  const h = fixture({ respond: (payload, request) => {
    if (payload.info.musicInfo.songmid.startsWith("new")) return { result: "https://example.com/new.mp3" };
    pendingRequests.push(request);
  } });
  const old = Array.from({ length: 3 }, (_, id) => h.runtime.requestCustomSourceMusicUrl(api({ id: String(id) }), song, "128k").catch(error => error));
  await flush();
  let completed = 0;
  const start = id => h.runtime.requestCustomSourceMusicUrl(api({ id }), { ...song, id }, "128k").then(() => completed++);
  const first = start("new-1");
  await flush();
  t.mock.timers.tick(2000);
  const second = start("new-2");
  await flush();
  t.mock.timers.tick(1500);
  await flush();
  const beforeRelease = completed;
  for (const request of pendingRequests) h.receive({ type: "request-response", rid: request.rid, id: request.id, result: "https://example.com/old.mp3" });
  await Promise.all([...old, first, second]);
  assert.equal(beforeRelease, 2);
});

test("脚本未声明的平台或音质不发给脚本", async () => {
  const h = fixture();
  await assert.rejects(h.runtime.requestCustomSourceMusicUrl(api(), { ...song, source: "tx" }, "128k"), /音源不支持 tx 的播放链接解析/);
  await assert.rejects(h.runtime.requestCustomSourceMusicUrl(api(), song, "flac"), /音源不支持 flac 音质/);
  assert.equal(h.count("request"), 0);
});

test("脚本返回的播放地址必须是公网 http(s) 地址", async () => {
  const invalid = fixture({ respond: () => ({ result: "ftp://example.com/song.mp3" }) });
  await assert.rejects(invalid.runtime.requestCustomSourceMusicUrl(api(), song, "128k"), /自定义音源没有返回可播放 URL/);
  const local = fixture({ respond: () => ({ result: "http://127.0.0.1/song.mp3" }) });
  await assert.rejects(local.runtime.requestCustomSourceMusicUrl(api(), song, "128k"), /自定义音源播放地址/);
});

test("深度测试取链通过后保留运行时，播放不再重新执行脚本", async () => {
  const h = fixture();
  assert.deepEqual(await h.runtime.testCustomSourceDeep(api(), 0), {
    ok: true,
    message: "初始化正常；取链测试 1/1 通过（wy 通过:128k）",
    sources: wy(),
    updateAlert: undefined,
  });
  await h.runtime.requestCustomSourceMusicUrl(api(), song, "128k");
  assert.equal(h.count("run"), 1);
  assert.equal(h.count("dispose"), 0);
});

test("深度测试全部平台失败时丢弃运行时，下次取链重新执行脚本", async () => {
  const h = fixture({ respond: () => ({ error: "上游\n  拒绝" }) });
  const result = await h.runtime.testCustomSourceDeep(api(), 0);
  assert.equal(result.ok, false);
  assert.equal(result.message, "初始化正常；取链测试 0/1 通过（wy 失败:取链失败：上游 拒绝）");
  assert.equal(h.count("dispose"), 1);
  await assert.rejects(h.runtime.requestCustomSourceMusicUrl(api(), song, "128k"), /上游/);
  assert.equal(h.count("run"), 2);
});

test("深度测试未声明 musicUrl 时只验证初始化，运行时留在缓存里", async () => {
  const h = fixture({ sources: wy([]) });
  const result = await h.runtime.testCustomSourceDeep(api(), 0);
  assert.equal(result.ok, true);
  assert.equal(result.message, "初始化正常；未声明 musicUrl，仅验证初始化");
  await assert.rejects(h.runtime.requestCustomSourceMusicUrl(api(), song, "128k"), /音源不支持 wy 的播放链接解析/);
  assert.equal(h.count("run"), 1);
  assert.equal(h.count("dispose"), 0);
});

test("深度测试取链迟迟不返回时按超时记为该平台失败", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = fixture({ respond: () => undefined });
  const pending = h.runtime.testCustomSourceDeep(api(), 0);
  await flush();
  t.mock.timers.tick(0);
  await flush();
  t.mock.timers.tick(5_500);
  // 取链超时与播放链的自定义源窗口一致（@lx/core CUSTOM_SOURCE_PLAYBACK_WINDOW_MS）
  assert.equal((await pending).message, "初始化正常；取链测试 0/1 通过（wy 失败:取链失败：取链测试超时（5500ms））");
});

test("更新检查在脚本没有上报更新时拉取远端脚本比对版本", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = fixture({ remote: { ok: true, status: 200, statusText: "OK", text: async () => `${header("1.1.0")}// fixture` } });
  const pending = h.runtime.checkCustomSourceUpdate(api({ homepage: "https://example.com/source.js" }));
  await flush();
  t.mock.timers.tick(5_000);
  const result = await pending;
  assert.deepEqual(result.updateAlert, { log: "发现新版本：v1.0.0 -> v1.1.0", updateUrl: "https://example.com/source.js" });
  assert.deepEqual(h.fetches, [{
    url: "https://example.com/source.js",
    init: { method: "GET", headers: { Accept: "text/plain,application/javascript,*/*" } },
    timeoutMs: 15_000,
  }]);
});

test("脚本自己上报了更新时不再拉取远端脚本", async () => {
  const h = fixture({ updateAlert: { log: "脚本自检到新版本", updateUrl: "https://example.com/new.js" } });
  const result = await h.runtime.checkCustomSourceUpdate(api({ homepage: "https://example.com/source.js" }));
  assert.deepEqual(result.updateAlert, { log: "脚本自检到新版本", updateUrl: "https://example.com/new.js" });
  assert.equal(h.fetches.length, 0);
});

test("远端脚本请求失败或指向内网时更新检查明确失败", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failed = fixture({ remote: { ok: false, status: 404, statusText: "Not Found", text: async () => "" } });
  const rejected = assert.rejects(
    failed.runtime.checkCustomSourceUpdate(api({ homepage: "https://example.com/source.js" })),
    /远端音源请求失败：HTTP 404 Not Found/,
  );
  await flush();
  t.mock.timers.tick(5_000);
  await rejected;

  const local = fixture();
  const blocked = assert.rejects(
    local.runtime.checkCustomSourceUpdate(api({ homepage: "http://192.168.1.2/source.js" })),
    /自定义音源更新检查/,
  );
  await flush();
  t.mock.timers.tick(5_000);
  await blocked;
  assert.equal(local.fetches.length, 0);
});
