const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const nativeDir = path.resolve(
  __dirname,
  "../android/app/src/main/java/cn/chenle/auralflow/mobile",
);
const source = fs.readFileSync(path.join(nativeDir, "CloudUploadModule.java"), "utf8");
const packageSource = fs.readFileSync(path.join(nativeDir, "LocalMusicPackage.java"), "utf8");

test("云盘上传模块已注册，选择、MD5、直传和取消入口齐全", () => {
  assert.match(packageSource, /new CloudUploadModule\(reactContext\)/);
  for (const method of ["pickAudioFiles", "computeMd5", "uploadFile", "cancelUpload"]) {
    assert.match(source, new RegExp(`public void ${method}\\(`), `缺少原生方法 ${method}`);
  }
});

test("文件选择使用 SAF 且支持多选与持久授权", () => {
  assert.match(source, /UiThreadUtil\.runOnUiThread/);
  assert.match(source, /Intent\.ACTION_OPEN_DOCUMENT/);
  assert.match(source, /EXTRA_ALLOW_MULTIPLE,\s*true/);
  assert.match(source, /FLAG_GRANT_PERSISTABLE_URI_PERMISSION/);
  assert.match(source, /takePersistableUriPermission/);
});

test("直传统一携带 NOS 凭证与 MD5，进度事件名与 JS 对齐", () => {
  assert.match(source, /"x-nos-token"/);
  assert.match(source, /"Content-MD5"/);
  assert.match(source, /"CloudUploadProgress"/);
  assert.match(source, /\.post\(body\)/);
  assert.match(source, /\.enqueue\(/);
});

test("上传与校验按流处理，不把整文件读入内存", () => {
  assert.match(source, /MessageDigest\.getInstance\("MD5"\)/);
  assert.match(source, /BUFFER_SIZE = 64 \* 1024/);
  assert.match(source, /while \(\(read = input\.read\(buffer\)\) != -1\)/);
  assert.doesNotMatch(source, /readFile\(|readAllBytes\(|Base64\.encodeToString\(input/);
});
