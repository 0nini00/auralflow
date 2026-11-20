const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred } = require("./helpers/loadTs.cjs");

const flush = () => new Promise(setImmediate);

test("新播放意图取消旧解析的底层任务", async () => {
  const load = createLoader({});
  const { beginPlaybackRequest } = load("src/services/playbackRequest.ts");
  const { runPlaybackResolution } = load("src/services/playbackResolution.ts");
  const gate = deferred();
  let receivedSignal;
  const task = runPlaybackResolution(signal => {
    receivedSignal = signal;
    return gate.promise;
  }, beginPlaybackRequest());
  const rejected = assert.rejects(task, /新的操作替代/);
  await flush();
  beginPlaybackRequest();
  await rejected;
  gate.resolve("late");
  assert.equal(receivedSignal?.aborted, true);
});

test("预读独立持有解析，取消等待者不会取消仍被复用的预读", async () => {
  const load = createLoader({});
  const { beginPlaybackRequest } = load("src/services/playbackRequest.ts");
  const { runPlaybackResolution } = load("src/services/playbackResolution.ts");
  const gate = deferred();
  let prefetchSignal;
  const prefetch = runPlaybackResolution(signal => {
    prefetchSignal = signal;
    return gate.promise;
  });
  const old = runPlaybackResolution(() => prefetch, beginPlaybackRequest());
  const rejected = assert.rejects(old, /新的操作替代/);
  await flush();
  const current = runPlaybackResolution(() => prefetch, beginPlaybackRequest());
  await rejected;
  const cancelled = prefetchSignal?.aborted;
  gate.resolve("shared");
  assert.equal(await current, "shared");
  assert.equal(cancelled, false);
});

test("fetchWithTimeout 把调用者取消传递到真实 fetch", async t => {
  const load = createLoader({});
  const { fetchWithTimeout } = load("src/utils/fetchWithTimeout.ts");
  const parent = new AbortController();
  let nativeSignal;
  const gate = deferred();
  t.mock.method(globalThis, "fetch", (_url, init) => {
    nativeSignal = init.signal;
    return gate.promise;
  });
  const task = fetchWithTimeout("https://example.com", { signal: parent.signal });
  parent.abort();
  gate.resolve({ ok: true });
  await task;
  assert.equal(nativeSignal.aborted, true);
});
