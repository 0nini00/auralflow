const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred } = require("./helpers/loadTs.cjs");

const flush = () => new Promise(setImmediate);
const original = { source: "wy", id: "original", name: "歌曲", singer: "歌手", interval: 180 };
const txResult = { request: { data: { body: { item_song: [{ mid: "match", title: "歌曲", singer: [{ name: "歌手" }], interval: 180 }] } } } };
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 503, text: async () => JSON.stringify(body) });

function setup() {
  const load = createLoader({
    "./wyDirectProvider": { eapiEncrypt: () => "encrypted" },
    "./wyAccountService": { getWyCookie: async () => "" },
  });
  return {
    fallback: load("src/services/crossSourceFallbackService.ts"),
    api: load("src/services/musicApi.ts"),
  };
}

test("跨源真实搜索链取消 HTTP，迟到结果不写入任何结果缓存", async t => {
  const h = setup();
  const gate = deferred();
  const calls = [];
  t.mock.method(globalThis, "fetch", (_url, init) => {
    calls.push(init);
    return calls.length === 1 ? gate.promise : Promise.resolve(response(txResult));
  });
  const controller = new AbortController();
  const first = h.fallback.findTxVariants(original, controller.signal).then(value => ({ value }), error => ({ error }));
  await flush();
  controller.abort();
  gate.resolve(response(txResult));
  const cancelled = await first;
  const retry = await h.fallback.findTxVariants(original);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(cancelled.error?.name, "AbortError");
  assert.equal(calls.length, 2);
  assert.equal(retry[0].id, "match");
});

test("同词两个独占搜索取消一个时另一个消费者继续完成", async t => {
  const h = setup();
  const requests = [];
  t.mock.method(globalThis, "fetch", (_url, init) => {
    const gate = deferred();
    requests.push({ signal: init.signal, gate });
    init.signal.addEventListener("abort", () => gate.reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
    return gate.promise;
  });
  const controller = new AbortController();
  const old = h.fallback.findTxVariants(original, controller.signal).catch(error => error);
  const current = h.fallback.findTxVariants(original);
  await flush();
  controller.abort();
  const aborted = requests.map(request => request.signal.aborted);
  for (const request of requests) request.gate.resolve(response(txResult));
  const oldResult = await old;
  const currentResult = await current;
  assert.deepEqual(aborted, [true, false]);
  assert.equal(oldResult.name, "AbortError");
  assert.equal(currentResult[0].id, "match");
});

test("网易云直连取消后不再发网关兜底", async t => {
  const h = setup();
  const gate = deferred();
  const calls = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    calls.push({ url, signal: init.signal });
    return calls.length === 1 ? gate.promise : Promise.resolve(response([]));
  });
  const controller = new AbortController();
  const pending = h.api.searchSongs("wy", "取消搜索", 1, controller.signal).catch(error => error);
  await flush();
  controller.abort();
  gate.resolve(response({}, false));
  const result = await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(result.name, "AbortError");
});

test("网关取消后迟到空结果不缓存，重试仍发起完整搜索", async t => {
  const h = setup();
  const gate = deferred();
  const calls = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    calls.push({ url, signal: init.signal });
    if (url.includes("interface3.music.163.com")) return Promise.resolve(response({}, false));
    return calls.length === 2 ? gate.promise : Promise.resolve(response([]));
  });
  const controller = new AbortController();
  const first = h.api.searchSongs("wy", "网关取消", 1, controller.signal).catch(error => error);
  await flush();
  controller.abort();
  gate.resolve(response([]));
  const cancelled = await first;
  await h.api.searchSongs("wy", "网关取消");
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(cancelled.name, "AbortError");
  assert.equal(calls.length, 4);
});
