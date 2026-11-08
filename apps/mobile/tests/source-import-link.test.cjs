const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

// Linking 只提供 URI，文件分类必须等待原生读取实际 MIME 与 DISPLAY_NAME。

const load = createLoader({});
const { parseMobileDeepLink } = load("src/services/mobileDeepLinkService.ts");

test("下载器的不透明文档 URI 进入文件解析，不预先当作音源脚本", () => {
  const uri = "content://com.android.providers.downloads.documents/document/msf%3A1000012345";
  assert.deepEqual(parseMobileDeepLink(uri), { type: "openFile", uri });
});

test("编码的文档路径保留原 URI 交给文件解析", () => {
  const uri =
    "content://com.android.externalstorage.documents/document/primary%3ADownload%2Fmy-source.js";
  assert.deepEqual(parseMobileDeepLink(uri), {
    type: "openFile",
    uri,
  });
});

test("file:// 本地脚本进入文件解析", () => {
  const uri = "file:///storage/emulated/0/Download/auralflow-source.js";
  assert.deepEqual(parseMobileDeepLink(uri), {
    type: "openFile",
    uri,
  });
});

test("音频和误送文件都交给文件边界识别类型并明确处理", () => {
  for (const uri of [
    "content://media/external/audio/media/12345/song.mp3",
    "file:///storage/emulated/0/Download/app.apk",
  ]) {
    assert.deepEqual(parseMobileDeepLink(uri), { type: "openFile", uri });
  }
});

test("原有 auralflow:// 深链行为不变", () => {
  assert.deepEqual(parseMobileDeepLink("auralflow://search/%E5%91%A8%E6%9D%B0%E4%BC%A6"), {
    type: "search",
    keyword: "周杰伦",
  });
  assert.deepEqual(parseMobileDeepLink("auralflow://daily"), { type: "homeMode", mode: "daily" });
  assert.deepEqual(parseMobileDeepLink("auralflow://fm"), { type: "homeMode", mode: "fm" });
  assert.equal(parseMobileDeepLink("https://music.163.com/playlist?id=1"), null);
});
