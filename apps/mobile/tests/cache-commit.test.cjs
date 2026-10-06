const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");
const song = { source: "wy", id: "commit", name: "Song", singer: "Artist" };
const audioPath = "/cache/auralflow/audio/wy-commit-flac.audio";
const settings = { timeout: 5000 };

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.fail("没有到达下载检查点");
}

function setup(initialFiles = {}, options = {}) {
  const files = new Map(Object.entries(initialFiles));
  const jobs = [];
  const storage = new Map();
  const warnings = [];
  const moves = [];
  const rnfs = {
    CachesDirectoryPath: "/cache", DocumentDirectoryPath: "/doc",
    exists: async p => files.has(p) || !path.posix.extname(p),
    mkdir: async () => {},
    stat: async p => {
      if (!files.has(p)) throw new Error("ENOENT");
      return { size: files.get(p).length, mtime: new Date() };
    },
    readDir: async dir => [...files].filter(([p]) => path.posix.dirname(p) === dir).map(([p, value]) => ({
      path: p, name: path.posix.basename(p), size: value.length, mtime: new Date(), isFile: () => true,
    })),
    unlink: async p => { if (!files.delete(p)) throw new Error("ENOENT"); },
    moveFile: async (from, to) => {
      if (options.unsafeMove) { files.set(to, "trunc"); throw new Error("copy failed"); }
      if (!files.has(from)) throw new Error("ENOENT");
      moves.push([from, to]); files.set(to, files.get(from)); files.delete(from);
    },
    downloadFile: request => {
      const pending = deferred();
      files.set(request.toFile, "partial");
      const job = { request, finish(body = "complete", statusCode = 200, bytesWritten = body.length) {
        files.set(request.toFile, body); pending.resolve({ statusCode, bytesWritten });
      }, fail() { pending.reject(new Error("network interrupted")); } };
      jobs.push(job);
      return { jobId: jobs.length, promise: pending.promise };
    },
    stopDownload: () => {},
  };
  const load = createLoader({
    "react-native-fs": rnfs,
    "@react-native-async-storage/async-storage": { getItem: async k => storage.get(k) ?? null, setItem: async (k, v) => storage.set(k, v), removeItem: async k => storage.delete(k) },
    "crypto-js": mobileRequire("crypto-js"), "react-native": { Platform: { OS: "android" }, NativeModules: { DownloadFileModule: { commitDownload: async (from, to) => {
      if (files.has(to)) throw new Error("destination exists");
      if (!files.has(from)) throw new Error("ENOENT");
      moves.push([from, to]); files.set(to, files.get(from)); files.delete(from);
    } } } },
    "@lx/core": { COVER_SIZE_LARGE: 500, resizeCoverUrl: url => url },
    "./playbackUrlCache": { clearPlaybackUrlCache: async () => {} },
    "./musicApi": { buildStreamHeaders: () => ({}) },
    "@/stores/playerStore": { usePlayerStore: { getState: () => ({}) } },
    "@/services/logger": { logger: { warn: (...args) => warnings.push(args) } },
  });
  return { service: load("src/services/cacheService.ts"), files, jobs, warnings, moves };
}

for (const kind of ["audio", "cover"]) {
  test(`${kind} 下载中不可命中，完成后才发布最终文件`, settings, async () => {
    const h = setup();
    const start = () => kind === "audio" ? h.service.cacheAudioFile("https://example.org/song", song, "flac") : h.service.cacheCover("https://example.org/cover.jpg");
    const read = () => kind === "audio" ? h.service.getCachedAudioFile(song, "flac") : h.service.getCachedCover("https://example.org/cover.jpg");
    const pending = start();
    await until(() => h.jobs.length === 1);
    const during = await read();
    const second = start();
    await new Promise(setImmediate);
    h.jobs[0].finish();
    const [firstPath, secondPath] = await Promise.all([pending, second]);
    assert.equal(during, null);
    assert.equal(h.jobs.length, 1);
    assert.ok(h.jobs[0].request.toFile.endsWith(".part"));
    assert.equal(firstPath, secondPath);
    assert.equal(await read(), firstPath);
    assert.equal(h.moves.length, 1);
    assert.equal([...h.files.keys()].some(p => p.endsWith(".part")), false);
  });
}

for (const [name, body, status, bytes] of [["空内容", "", 200, 0], ["写入长度不一致", "short", 200, 12], ["HTTP错误", "error", 403, 5]]) {
  test(`${name} 不提交缓存并给出日志`, settings, async () => {
    const h = setup();
    const pending = h.service.cacheAudioFile("https://example.org/song", song, "flac");
    await until(() => h.jobs.length === 1);
    h.jobs[0].finish(body, status, bytes);
    assert.equal(await pending, null);
    assert.equal(await h.service.getCachedAudioFile(song, "flac"), null);
    assert.equal(h.moves.length, 0);
    assert.ok(h.warnings.length > 0);
    assert.equal(h.files.size, 0);
  });
}

test("首次初始化清理遗留临时文件，不清理正在进行的同进程下载", settings, async () => {
  const orphan = `${audioPath}.part`;
  const h = setup({ [orphan]: "stale", "/cache/auralflow/audio/other.audio": "kept" });
  const pending = h.service.cacheAudioFile("https://example.org/song", song, "flac");
  await until(() => h.jobs.length === 1);
  await h.service.listCachedAudio();
  assert.ok(h.files.has(h.jobs[0].request.toFile));
  h.jobs[0].finish();
  await pending;
  assert.equal(h.files.has(orphan), false);
  assert.equal(h.files.get("/cache/auralflow/audio/other.audio"), "kept");
});

test("下载失败只删除临时文件且后续可重试", settings, async () => {
  const h = setup();
  const first = h.service.cacheAudioFile("https://example.org/song", song, "flac");
  await until(() => h.jobs.length === 1);
  h.jobs[0].fail();
  assert.equal(await first, null);
  const retry = h.service.cacheAudioFile("https://example.org/song", song, "flac");
  await until(() => h.jobs.length === 2);
  h.jobs[1].finish();
  assert.equal(await retry, `file://${audioPath}`);
});


test("提交不能使用可能复制半成品的 RNFS.moveFile", settings, async () => {
  const h = setup({}, { unsafeMove: true });
  const pending = h.service.cacheAudioFile("https://example.org/song", song, "flac");
  await until(() => h.jobs.length === 1);
  h.jobs[0].finish();
  assert.equal(await pending, `file://${audioPath}`);
  assert.equal(h.files.get(audioPath), "complete");
});

for (const outcome of ["success", "failure"]) {
  test(`缓存超时后迟到${outcome}必须再次清理临时文件`, settings, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = setup();
    const first = h.service.cacheAudioFile("https://example.org/song", song, "flac");
    await until(() => h.jobs.length === 1);
    t.mock.timers.tick(30_000);
    assert.equal(await first, null);
    const retry = h.service.cacheAudioFile("https://example.org/song", song, "flac");
    await until(() => h.jobs.length === 2);
    h.jobs[1].finish("new-complete");
    await retry;
    h.files.set(h.jobs[0].request.toFile, "late");
    if (outcome === "success") h.jobs[0].finish("old-complete"); else h.jobs[0].fail();
    await new Promise(setImmediate);
    assert.equal(h.files.has(h.jobs[0].request.toFile), false);
    assert.equal(h.files.get(audioPath), "new-complete");
  });
}
