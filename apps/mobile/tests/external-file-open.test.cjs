const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createLoader, deferred, mobileRoot } = require("./helpers/loadTs.cjs");

const opaqueUri = "content://com.android.providers.downloads.documents/document/msf%3A123";
function setup(info, error) {
  const filename = path.join(mobileRoot, "src/services/externalFileService.ts");
  assert.ok(fs.existsSync(filename), "外部文件必须先解析真实文件信息再选择播放或音源导入");
  const calls = [];
  const load = createLoader({
    "react-native": { NativeModules: { CustomSourceFilePickerModule: {
      getFileInfo: async uri => { calls.push(uri); if (error) throw error; return info; },
    } } },
  });
  return { api: load("src/services/externalFileService.ts"), calls };
}

for (const [label, info] of [
  ["MP3 MIME", { fileName: null, mimeType: "audio/mpeg" }],
  ["不透明 URI 的 MP3 文件名", { fileName: "音乐.MP3", mimeType: "application/octet-stream" }],
  ["OGG MIME", { fileName: null, mimeType: "application/ogg" }],
  ...["mp3", "m4a", "m4b", "flac", "wav", "aac", "ogg", "opus", "amr"].map(ext => [ext, { fileName: `歌曲.${ext}`, mimeType: null }]),
]) {
  test(`外部${label}走播放入口`, async () => {
    const h = setup(info);
    assert.deepEqual(await h.api.resolveExternalFile(opaqueUri), { type: "playAudio", uri: opaqueUri });
    assert.deepEqual(h.calls, [opaqueUri]);
  });
}

for (const [label, info] of [
  ["JS 被标为文本", { fileName: "音源.js", mimeType: "text/plain" }],
  ["JS 被标为二进制", { fileName: "音源.JS", mimeType: "application/octet-stream" }],
  ["JSON 音源", { fileName: "source.json", mimeType: null }],
  ["没有文件名但有 JS MIME", { fileName: null, mimeType: "application/javascript" }],
]) {
  test(`${label}要求确认导入`, async () => {
    const h = setup(info);
    assert.deepEqual(await h.api.resolveExternalFile(opaqueUri), { type: "importSource", uri: opaqueUri, fileName: info.fileName });
  });
}

test("带编码文件名的 file URI 在提供方没有文件名时仍能分类", async () => {
  const h = setup({ fileName: null, mimeType: null });
  const uri = "file:///storage/emulated/0/Download/%E9%9F%B3%E6%BA%90.js";
  assert.deepEqual(await h.api.resolveExternalFile(uri), { type: "importSource", uri, fileName: "音源.js" });
});

for (const info of [
  { fileName: "notes.txt", mimeType: "text/plain" },
  { fileName: "app.apk", mimeType: "application/octet-stream" },
  { fileName: null, mimeType: "application/octet-stream" },
  { fileName: "book.pdf", mimeType: "application/javascript" },
]) {
  test(`无关或无法确定的文件明确拒绝：${info.fileName ?? "未知"}`, async () => {
    const h = setup(info);
    await assert.rejects(h.api.resolveExternalFile(opaqueUri), /不支持|无法识别/);
  });
}

test("文件读取失败保留真实错误；网络 URI 在原生边界前被拒绝", async () => {
  const error = new Error("没有读取文件的权限");
  const h = setup(null, error);
  await assert.rejects(h.api.resolveExternalFile(opaqueUri), actual => actual === error);
  await assert.rejects(h.api.resolveExternalFile("https://example.test/source.js"), /本地文件/);
  assert.deepEqual(h.calls, [opaqueUri]);
});

function controllerFixture(resolve) {
  const filename = path.join(mobileRoot, "src/services/mobileLinkController.ts");
  assert.ok(fs.existsSync(filename), "外部打开必须等待应用就绪且允许重新打开同一文件");
  const dispatched = [];
  const errors = [];
  const calls = [];
  const { createMobileLinkController } = createLoader({})(filename);
  const controller = createMobileLinkController({
    resolve: async uri => { calls.push(uri); return resolve ? resolve(uri) : { type: "openFile", uri }; },
    dispatch: intent => dispatched.push(intent),
    onError: error => errors.push(error),
  });
  return { controller, dispatched, errors, calls };
}

test("冷启动文件保持等待直到导航和协议就绪，随后仅处理一次", async () => {
  const h = controllerFixture();
  h.controller.receive(opaqueUri);
  assert.deepEqual(h.calls, []);
  await h.controller.setReady(true);
  assert.deepEqual(h.dispatched, [{ type: "openFile", uri: opaqueUri }]);
  await h.controller.setReady(true);
  assert.equal(h.dispatched.length, 1);
});

test("取消导入后再次打开同一 URI 仍会派发，不按 URI 永久去重", async () => {
  const h = controllerFixture();
  await h.controller.setReady(true);
  await h.controller.receive(opaqueUri);
  await h.controller.receive(opaqueUri);
  assert.equal(h.dispatched.length, 2);
});

test("后到的打开请求优先，旧元数据响应不能晚到触发导入", async () => {
  const pending = deferred();
  const h = controllerFixture(uri => uri === "old" ? pending.promise : { type: "search", keyword: uri });
  await h.controller.setReady(true);
  const old = h.controller.receive("old");
  await h.controller.receive("new");
  pending.resolve({ type: "search", keyword: "old" });
  await old;
  assert.deepEqual(h.dispatched, [{ type: "search", keyword: "new" }]);
});

test("卸载后迟到结果不派发，读取失败明确呈现且允许后续重试", async () => {
  const error = new Error("读取失败");
  let fail = true;
  const h = controllerFixture(async uri => { if (fail) throw error; return { type: "search", keyword: uri }; });
  await h.controller.setReady(true);
  await h.controller.receive("retry");
  assert.deepEqual(h.errors, [error]);
  fail = false;
  await h.controller.receive("retry");
  assert.equal(h.dispatched.length, 1);
  h.controller.dispose();
  await h.controller.receive("late");
  assert.equal(h.dispatched.length, 1);
});
