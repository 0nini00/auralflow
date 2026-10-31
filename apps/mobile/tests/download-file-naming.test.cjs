const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

// 该模块只 import 了 @lx/core 的类型，运行时无依赖，不需要任何 mock。
const { buildDownloadFileStem, fileSegment } = createLoader({})("./src/services/downloadFileNaming.ts");

test("常规 id 保持可读", () => {
  assert.equal(
    buildDownloadFileStem({ source: "wy", id: "2034742057" }, "flac"),
    "wy-2034742057-flac",
  );
});

test("JOOX base64 id 里的斜杠与等号被压成下划线，不会跳目录", () => {
  // 真实 JOOX id 形如 "hhM0Y7ctJdxVXaeTA2FtuA=="，base64 还可能出现 "/"。
  const stem = buildDownloadFileStem({ source: "tx", id: "hhM0Y7ct/JdxV+XaeTA2FtuA==" }, "320k");
  assert.equal(stem, "tx-hhM0Y7ct_JdxV_XaeTA2FtuA_-320k");
  assert.ok(!stem.includes("/"), "文件名不能包含路径分隔符");
});

test("路径穿越片段不会越出下载目录", () => {
  for (const id of ["../../etc/passwd", "..", ".", "a/../../b", "C:\\Windows\\x"]) {
    const stem = buildDownloadFileStem({ source: "wy", id }, "320k");
    assert.ok(!stem.includes("/") && !stem.includes("\\"), `id=${id} 仍含分隔符: ${stem}`);
    assert.ok(!/(^|\/)\.\.($|\/)/.test(stem), `id=${id} 仍含上级目录: ${stem}`);
    assert.equal(stem.split("-")[1].startsWith("."), false, `id=${id} 以点开头: ${stem}`);
  }
});

test("空标识退化为下划线而不是空片段", () => {
  assert.equal(fileSegment(""), "_");
  assert.equal(fileSegment("   "), "_");
});

test("云盘曲文件名不写请求档位：请求哪档都是同一份上传文件", () => {
  const cloud = { source: "wy", id: "27694142", wyCloud: true };
  assert.equal(buildDownloadFileStem(cloud, "320k"), "wy-27694142-original");
  assert.equal(buildDownloadFileStem(cloud, "flac24bit"), "wy-27694142-original");
  // 非云盘曲保持原样
  assert.equal(buildDownloadFileStem({ source: "wy", id: "27694142" }, "320k"), "wy-27694142-320k");
});
