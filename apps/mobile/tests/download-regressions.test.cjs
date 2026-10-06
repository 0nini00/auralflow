const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

const DIRECTORY = "/mock/doc/auralflow/downloads";
const STORE_KEY = "auralflow.mobile.downloads";
const song = { source: "wy", id: "audit", name: "Audit", singer: "Mock", interval: 200 };
const secondSong = { ...song, id: "second" };
const url = { url: "https://mock.invalid/audio.flac", quality: "flac" };
const audioPath = `${DIRECTORY}/wy-audit-flac.flac`;
const lyricPath = `${DIRECTORY}/wy-audit-flac.lrc`;

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.fail("未到达预期的异步检查点");
}

function setup(options = {}) {
  const files = new Map();
  const storage = new Map();
  const events = [];
  const jobs = [];
  const parses = [];
  const saves = [];
  let lyricsCalls = 0;
  let haptics = 0;
  const rnfs = {
    DocumentDirectoryPath: "/mock/doc",
    CachesDirectoryPath: "/mock/cache",
    exists: async (raw) => {
      const p = raw.replace(/^file:\/\//, "");
      if (p === "/mock/doc/auralflow" && options.directoryGate) await options.directoryGate.promise;
      return files.has(p) || p === "/mock/doc/auralflow" || p === DIRECTORY;
    },
    mkdir: async () => {},
    stat: async (p) => {
      if (!files.has(p)) throw new Error("ENOENT");
      return { size: Buffer.byteLength(files.get(p)) };
    },
    readDir: async (dir) => [...files].filter(([p]) => path.posix.dirname(p) === dir)
      .map(([p, data]) => ({ name: path.posix.basename(p), path: p, size: data.length, isFile: () => true })),
    unlink: async (p) => {
      if (options.failUnlink?.(p)) throw new Error("Mock unlink denied");
      if (!files.delete(p)) throw new Error("ENOENT");
      events.push(`unlink:${p}`);
    },
    moveFile: async (from, to) => {
      if (!files.has(from)) throw new Error("ENOENT");
      files.set(to, files.get(from)); files.delete(from);
      events.push(`move:${from}:${to}`);
    },
    writeFile: async (p, data) => {
      if (options.failTagWrite && p.endsWith(".part")) { files.set(p, "ID3"); throw new Error("ENOSPC"); }
      files.set(p, data); events.push(`write:${p}`);
    },
    readFile: async (p, encoding) => {
      if (!files.has(p)) throw new Error("ENOENT");
      return encoding === "base64" ? Buffer.from(files.get(p)).toString("base64") : files.get(p);
    },
    downloadFile: (request) => {
      const pending = deferred();
      const id = jobs.length + 1;
      files.set(request.toFile, `partial-${id}`);
      events.push(`start:${id}`);
      const job = {
        request, pending, stopped: false,
        finish() {
          files.set(request.toFile, `complete-audio-${id}`);
          pending.resolve({ statusCode: 200, bytesWritten: 16 });
        },
      };
      jobs.push(job);
      if (!options.manualNative) job.finish();
      return { jobId: id, promise: pending.promise };
    },
    stopDownload: (id) => {
      const job = jobs[id - 1];
      job.stopped = true;
      events.push(`stop:${id}`);
      if (!options.manualStop) job.pending.reject(new Error("Download cancelled"));
    },
  };
  const load = createLoader({
    "@react-native-async-storage/async-storage": {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => {
        saves.push(JSON.parse(value));
        if (saves.length === 1 && options.saveGate) await options.saveGate.promise;
        storage.set(key, value);
      },
    },
    "react-native-fs": rnfs,
    "react-native": { NativeModules: { DownloadFileModule: { commitDownload: rnfs.moveFile } } },
    "@lx/core": {
      DEFAULT_QUALITY_UPGRADE_WINDOW_MS: 0,
      raceForBestQuality: (attempts) => Promise.any(attempts),
      isPreviewStream: () => false,
    },
    "./musicApi": {
      parseUrl: (track) => {
        parses.push(track.id);
        return parses.length === 1 && options.parseGate ? options.parseGate.promise : Promise.resolve(options.resolvedUrl ?? url);
      },
      buildStreamHeaders: () => ({}),
      fetchSongLyrics: async () => {
        lyricsCalls++;
        if (lyricsCalls === 1 && options.lyricsGate) await options.lyricsGate.promise;
        return [{ time: 0, text: "mock lyric" }];
      },
    },
    "./playerService": { resolveUrlWithCustomSource: async () => { throw new Error("Mock source unavailable"); } },
    "./streamProbe": { probeStreamUrl: async () => ({ ok: true }) },
    "./id3TagWriter": { embedId3Tag: (audio) => audio },
    "@/utils/base64": {
      base64ToBytes: (value) => Buffer.from(value, "base64"),
      bytesToBase64: (value) => Buffer.from(value).toString("base64"),
    },
    zustand: mobileRequire("zustand"),
    "@/stores/playbackSettingsStore": { usePlaybackSettingsStore: { getState: () => ({ defaultQuality: "flac" }) } },
    "@/services/hapticService": { hapticSuccess: () => { haptics++; } },
    "@/services/logger": { logger: { warn: (...args) => events.push(["warn", ...args]) } },
  });
  const service = load("src/services/downloadService.ts");
  const store = load("src/stores/downloadStore.ts").useDownloadStore;
  return {
    files, storage, events, jobs, parses, saves, service, store,
    saved: () => JSON.parse(storage.get(STORE_KEY) ?? "[]"),
    get lyricsCalls() { return lyricsCalls; },
    get haptics() { return haptics; },
  };
}

const settings = { timeout: 5000 };

test("取消取链中的任务，不启动原生下载或保存完成记录", settings, async () => {
  const parseGate = deferred();
  const h = setup({ parseGate });
  const pending = h.store.getState().downloadSong(song, "flac");
  await until(() => h.parses.length === 1);
  h.store.getState().cancelDownload(song, "flac");
  parseGate.resolve(url);
  assert.equal((await pending).status, "cancelled");
  assert.equal(h.jobs.length, 0);
  assert.deepEqual(h.saved(), []);
  assert.equal(h.files.size, 0);
});

test("目录检查前取消，也不会在异步检查后重新入队", settings, async () => {
  const directoryGate = deferred();
  const h = setup({ directoryGate });
  const pending = h.store.getState().downloadSong(song, "flac");
  h.store.getState().cancelDownload(song, "flac");
  directoryGate.resolve();
  assert.equal((await pending).status, "cancelled");
  assert.equal(h.jobs.length, 0);
});

test("取消排队任务后同 key 重试，旧回调不得移除新任务", settings, async () => {
  const parseGate = deferred();
  const h = setup({ parseGate });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.parses.length === 1);
  const old = h.store.getState().downloadSong(secondSong, "flac");
  await new Promise(setImmediate);
  h.store.getState().cancelDownload(secondSong, "flac");
  const retry = h.store.getState().downloadSong(secondSong, "flac");
  assert.equal((await old).status, "cancelled");
  assert.equal(h.store.getState().downloading.filter((item) => item.song.id === secondSong.id).length, 1);
  parseGate.resolve(url);
  assert.equal((await first).status, "completed");
  assert.equal((await retry).status, "completed");
  assert.equal(h.saved().length, 2);
});

test("取消原生下载后立即重试，不复用半成品或接受旧进度", settings, async () => {
  const h = setup({ manualNative: true, manualStop: true });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.jobs.length === 1);
  h.store.getState().cancelDownload(song, "flac");
  const retry = h.store.getState().downloadSong({ ...song, name: "Retry" }, "flac");
  await new Promise(setImmediate);
  h.jobs[0].request.progress({ bytesWritten: 9, contentLength: 10 });
  assert.equal(h.store.getState().downloading[0]?.progress, 0);
  assert.deepEqual(h.saved(), []);
  h.jobs[0].finish();
  assert.equal((await first).status, "cancelled");
  await until(() => h.jobs.length === 2);
  h.jobs[1].finish();
  assert.equal((await retry).status, "completed");
  assert.equal(h.saved()[0].song.name, "Retry");
  assert.equal(h.files.get(audioPath), "complete-audio-2");
  assert.equal(h.haptics, 1);
});

test("暂停取链后继续，只允许继续后的任务下载", settings, async () => {
  const parseGate = deferred();
  const h = setup({ parseGate });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.parses.length === 1);
  h.store.getState().pauseDownload(song, "flac");
  parseGate.resolve(url);
  assert.equal((await first).status, "inProgress");
  assert.equal(h.jobs.length, 0);
  assert.equal(h.store.getState().downloading[0].status, "paused");
  h.store.getState().resumeDownload(song, "flac");
  await until(() => h.saved().length === 1);
  assert.equal(h.jobs.length, 1);
});

test("原生下载暂停后立即继续，旧完成不得覆盖新任务", settings, async () => {
  const h = setup({ manualNative: true, manualStop: true });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.jobs.length === 1);
  h.store.getState().pauseDownload(song, "flac");
  h.store.getState().resumeDownload(song, "flac");
  h.jobs[0].finish();
  assert.equal((await first).status, "inProgress");
  await until(() => h.jobs.length === 2);
  assert.equal(h.store.getState().downloading.length, 1);
  assert.deepEqual(h.saved(), []);
  h.jobs[1].finish();
  await until(() => h.saved().length === 1);
  assert.equal(h.files.get(audioPath), "complete-audio-2");
  assert.equal(h.haptics, 1);
});

test("记录持久化期间取消并重试，回滚旧记录且保留新文件", settings, async () => {
  const saveGate = deferred();
  const h = setup({ saveGate });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.saves.length === 1);
  h.store.getState().cancelDownload(song, "flac");
  const retry = h.store.getState().downloadSong({ ...song, name: "Retry" }, "flac");
  saveGate.resolve();
  assert.equal((await first).status, "cancelled");
  assert.equal((await retry).status, "completed");
  assert.equal(h.saved().length, 1);
  assert.equal(h.saved()[0].song.name, "Retry");
  assert.equal(h.files.get(audioPath), "complete-audio-2");
  assert.equal(h.haptics, 1);
  assert.equal(h.store.getState().failedDownloads.length, 0);
});

test("歌词后处理期间取消，清理音频且不写完成记录", settings, async () => {
  const lyricsGate = deferred();
  const h = setup({ lyricsGate });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.lyricsCalls === 1);
  h.store.getState().cancelDownload(song, "flac");
  lyricsGate.resolve();
  assert.equal((await first).status, "cancelled");
  assert.equal(h.files.size, 0);
  assert.deepEqual(h.saved(), []);
});

test("删除下载时同时删除对应歌词，再次下载必须获取音频", settings, async () => {
  const h = setup();
  assert.equal((await h.store.getState().downloadSong(song, "flac")).status, "completed");
  assert.equal(h.files.has(lyricPath), true);
  await h.store.getState().removeDownload(song, "flac");
  assert.equal(h.files.has(audioPath), false);
  assert.equal(h.files.has(lyricPath), false);
  assert.equal((await h.store.getState().downloadSong(song, "flac")).status, "completed");
  assert.equal(h.jobs.length, 2);
  assert.equal(h.saved()[0].localPath, `file://${audioPath}`);
});

test("遗留旁挂文件不是音频，不能短路重新下载", settings, async () => {
  const h = setup();
  for (const ext of ["lrc", "jpg", "json", "tmp"]) h.files.set(`${DIRECTORY}/wy-audit-flac.${ext}`, "sidecar");
  assert.equal((await h.store.getState().downloadSong(song, "flac")).status, "completed");
  assert.equal(h.jobs.length, 1);
  assert.equal(h.saved()[0].localPath, `file://${audioPath}`);
});

test("复用实际扩展名音频，删除时不影响其他音质的歌词", settings, async () => {
  const h = setup();
  const actualPath = `${DIRECTORY}/wy-audit-flac.m4a`;
  const otherLyric = `${DIRECTORY}/wy-audit-320k.lrc`;
  h.files.set(lyricPath, "lyric");
  h.files.set(actualPath, "complete-audio");
  h.files.set(otherLyric, "other lyric");
  assert.equal((await h.store.getState().downloadSong(song, "flac")).status, "completed");
  assert.equal(h.saved()[0].localPath, `file://${actualPath}`);
  assert.equal(h.jobs.length, 0);
  await h.store.getState().removeDownload(song, "flac");
  assert.equal(h.files.has(actualPath), false);
  assert.equal(h.files.has(lyricPath), false);
  assert.equal(h.files.has(otherLyric), true);
});


test("取链未返回也能取消并重试，迟到结果不得启动旧下载", settings, async () => {
  const parseGate = deferred();
  const h = setup({ parseGate });
  let outcome;
  const first = h.store.getState().downloadSong(song, "flac").then((value) => { outcome = value; });
  await until(() => h.parses.length === 1);
  h.store.getState().cancelDownload(song, "flac");
  await until(() => outcome !== undefined);
  assert.equal(outcome.status, "cancelled");
  assert.equal((await h.store.getState().downloadSong(song, "flac")).status, "completed");
  parseGate.resolve(url);
  await first;
  await new Promise(setImmediate);
  assert.equal(h.jobs.length, 1);
  assert.equal(h.files.get(audioPath), "complete-audio-1");
});

test("持久化期间仅取消不重试，磁盘记录和文件均为空", settings, async () => {
  const saveGate = deferred();
  const h = setup({ saveGate });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.saves.length === 1);
  h.store.getState().cancelDownload(song, "flac");
  saveGate.resolve();
  assert.equal((await first).status, "cancelled");
  assert.deepEqual(h.saves.map((items) => items.length), [1, 0]);
  assert.deepEqual(h.saved(), []);
  assert.deepEqual(h.store.getState().downloads, []);
  assert.equal(h.files.size, 0);
  assert.equal(h.haptics, 0);
});

test("不带音质取消已暂停任务，再下载不残留暂停标记", settings, async () => {
  const h = setup({ manualNative: true });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.jobs.length === 1);
  h.store.getState().pauseDownload(song, "flac");
  assert.equal((await first).status, "inProgress");
  h.store.getState().cancelDownload(song);
  assert.equal(h.service.isDownloadPaused(song, "flac"), false);
  assert.equal(h.files.size, 0);
  const retry = h.store.getState().downloadSong(song, "flac");
  await until(() => h.jobs.length === 2);
  h.jobs[1].finish();
  assert.equal((await retry).status, "completed");
});

test("继续操作只作用于暂停任务，不替换仍在运行的尝试", settings, async () => {
  const h = setup({ manualNative: true });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.jobs.length === 1);
  h.store.getState().resumeDownload(song, "flac");
  h.jobs[0].finish();
  assert.equal((await first).status, "completed");
  await until(() => h.store.getState().downloading.length === 0);
  assert.equal(h.saves.length, 1);
  assert.equal(h.haptics, 1);
});

test("删除文件失败必须报告错误，不能提前丢弃持久化记录", settings, async () => {
  const h = setup({ failUnlink: (p) => p === audioPath });
  await h.store.getState().downloadSong(song, "flac");
  await h.store.getState().removeDownload(song, "flac");
  assert.equal(h.files.has(audioPath), true);
  assert.equal(h.saved().length, 1);
  assert.equal(h.store.getState().downloads.length, 1);
  assert.match(h.store.getState().error, /Mock unlink denied/);
});

test("暂停停止尚未完成时重复继续，不重复提交新尝试", settings, async () => {
  const h = setup({ manualNative: true, manualStop: true });
  const first = h.store.getState().downloadSong(song, "flac");
  await until(() => h.jobs.length === 1);
  h.store.getState().pauseDownload(song, "flac");
  h.store.getState().resumeDownload(song, "flac");
  h.store.getState().resumeDownload(song, "flac");
  h.jobs[0].finish();
  assert.equal((await first).status, "inProgress");
  await until(() => h.jobs.length === 2);
  h.jobs[1].finish();
  await until(() => h.store.getState().downloading.length === 0);
  assert.equal(h.saves.length, 1);
  assert.equal(h.haptics, 1);
});


test("音频下载和后处理结束前，不允许从最终路径读取半成品", settings, async () => {
  const lyricsGate = deferred();
  const h = setup({ manualNative: true, lyricsGate });
  const pending = h.store.getState().downloadSong(song, "flac");
  await until(() => h.jobs.length === 1);
  const duringDownload = await h.service.getDownloadedPath(song, "flac");
  h.jobs[0].finish();
  await until(() => h.lyricsCalls === 1);
  const duringProcessing = await h.service.getDownloadedPath(song, "flac");
  lyricsGate.resolve();
  assert.equal((await pending).status, "completed");
  assert.equal(duringDownload, null);
  assert.equal(duringProcessing, null);
  assert.ok(h.jobs[0].request.toFile.endsWith(".part"));
  assert.equal(await h.service.getDownloadedPath(song, "flac"), `file://${audioPath}`);
  assert.equal([...h.files.keys()].some(p => p.endsWith(".part")), false);
});

test("重新启动后的临时音频不能作为已下载文件且会被清理", settings, async () => {
  const h = setup();
  h.files.set(`${audioPath}.old.part`, "unfinished");
  assert.equal(await h.service.getDownloadedPath(song, "flac"), null);
  await h.service.ensureDownloadDirectory();
  assert.equal(h.files.size, 0);
});

test("200响应但实际为空时不能提交下载记录", settings, async () => {
  const h = setup({ manualNative: true });
  const pending = h.store.getState().downloadSong(song, "flac");
  await until(() => h.jobs.length === 1);
  h.files.set(h.jobs[0].request.toFile, "");
  h.jobs[0].pending.resolve({ statusCode: 200, bytesWritten: 0 });
  assert.equal((await pending).status, "failed");
  assert.deepEqual(h.saved(), []);
  assert.equal(h.files.size, 0);
});


test("MP3标签部分写入失败不得发布损坏音频", settings, async () => {
  const h = setup({ failTagWrite: true, resolvedUrl: { url: "https://mock.invalid/audio.mp3", quality: "320k" } });
  const result = await h.store.getState().downloadSong(song, "320k");
  assert.equal(result.status, "failed");
  assert.deepEqual(h.saved(), []);
  assert.equal(h.files.size, 0);
});
