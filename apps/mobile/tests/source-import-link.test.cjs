const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

// 「用其他应用打开」的音源脚本靠 AndroidManifest 的 intent-filter 命中，
// RN 的 Linking 会把 ACTION_VIEW 的 data URI 直接抛给 JS（onCreate 走 getInitialURL，
// 已运行时走 url 事件），所以这里只管把 URI 认成「导入音源」意图。

const load = createLoader({});
const { parseMobileDeepLink } = load("src/services/mobileDeepLinkService.ts");

test("下载器的 content:// 文档 id（不带扩展名）也认，文件名交给调用方兜文案", () => {
  const uri = "content://com.android.providers.downloads.documents/document/msf%3A1000012345";
  assert.deepEqual(parseMobileDeepLink(uri), { type: "importSource", uri, fileName: null });
});

test("下载器把真实路径编码在最后一个 segment 里时能取出文件名", () => {
  const uri =
    "content://com.android.externalstorage.documents/document/primary%3ADownload%2Fmy-source.js";
  assert.deepEqual(parseMobileDeepLink(uri), {
    type: "importSource",
    uri,
    fileName: "my-source.js",
  });
});

test("file:// 的本地脚本认成导入音源", () => {
  const uri = "file:///storage/emulated/0/Download/auralflow-source.js";
  assert.deepEqual(parseMobileDeepLink(uri), {
    type: "importSource",
    uri,
    fileName: "auralflow-source.js",
  });
});

test("音频/安装包等明确不是脚本的文件拒绝导入", () => {
  for (const uri of [
    "content://media/external/audio/media/12345/song.mp3",
    "file:///storage/emulated/0/Download/app.apk",
  ]) {
    assert.equal(parseMobileDeepLink(uri), null, uri);
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
