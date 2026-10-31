const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

const files = new Map();
const rnfs = {
  stat: async (p) => {
    if (!files.has(p)) throw new Error("ENOENT");
    return { size: Buffer.byteLength(files.get(p)) };
  },
  read: async (p, length, position, encoding) => {
    const data = files.get(p) ?? "";
    return encoding === "base64" ? Buffer.from(data).toString("base64") : data.slice(position, position + length);
  },
};

const { validateDownloadedFile } = createLoader({
  "react-native-fs": rnfs,
  "react-native": { NativeModules: {} },
})("./src/services/fileDownloadCommit.ts");

test("正常音频头通过校验", async () => {
  files.set("/tmp/ok.mp3", "ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000mock-audio-payload");
  await assert.doesNotReject(validateDownloadedFile("/tmp/ok.mp3"));
});

test("CDN 返回的 200 + HTML 错误页被拒绝", async () => {
  files.set("/tmp/err.mp3", "<!DOCTYPE html><html><body>403 Forbidden</body></html>");
  await assert.rejects(validateDownloadedFile("/tmp/err.mp3"), /不是音频文件/);
});

test("JSON 错误响应与 m3u8 播放列表被拒绝", async () => {
  files.set("/tmp/err2.flac", '{"code":403,"msg":"no copyright"}');
  await assert.rejects(validateDownloadedFile("/tmp/err2.flac"), /不是音频文件/);
  files.set("/tmp/list.mp3", "#EXTM3U\n#EXT-X-VERSION:3");
  await assert.rejects(validateDownloadedFile("/tmp/list.mp3"), /不是音频文件/);
});

test("空文件仍然按原有语义报错", async () => {
  files.set("/tmp/empty.mp3", "");
  await assert.rejects(validateDownloadedFile("/tmp/empty.mp3"), /为空/);
});
