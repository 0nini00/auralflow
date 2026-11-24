const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

const MD5 = "0123456789abcdef0123456789abcdef";
const COOKIE = "MUSIC_U=FAKE; __csrf=FAKE_CSRF";
const FILE = {
  uri: "content://downloads/document/42",
  fileName: "晴天.flac",
  mimeType: "audio/flac",
  size: 55_397_039,
  title: "晴天",
  artist: "周杰伦",
  album: "叶惠美",
  durationMs: 269_000,
};

function setup(overrides = {}) {
  const apiCalls = [];
  const fetchCalls = [];
  const uploadCalls = [];
  const responses = [...(overrides.responses ?? [])];
  const native = {
    pickAudioFiles: async () => overrides.picked ?? [FILE],
    computeMd5: async (uri) => {
      assert.equal(uri, FILE.uri);
      return overrides.md5 ?? MD5;
    },
    uploadFile: async (...args) => {
      uploadCalls.push(args);
      return null;
    },
    cancelUpload: async () => true,
    ...overrides.native,
  };
  const load = createLoader({
    "react-native": {
      NativeModules: { CloudUploadModule: native },
      Platform: { OS: "android" },
    },
    "@/utils/fetchWithTimeout": {
      fetchWithTimeout: async (url, init) => {
        fetchCalls.push({ url, init });
        return Response.json(overrides.lbs ?? { upload: ["https://nos.example/upload/"] });
      },
    },
    "./wyAccountService": { getWyCookie: async () => COOKIE },
    "./wyPlaylistService": {
      postWyWeapi: async (path, payload, cookie) => {
        apiCalls.push({ path, payload, cookie });
        assert.ok(responses.length > 0, `未预期的 weapi 调用：${path}`);
        return responses.shift();
      },
    },
  });
  return {
    api: load("src/services/cloudUploadService.ts"),
    native,
    apiCalls,
    fetchCalls,
    uploadCalls,
  };
}

function successResponses(needUpload = true) {
  return [
    { code: 200, needUpload, songId: "9001" },
    {
      code: 200,
      result: { token: "nos-token", objectKey: "dir/file.flac", resourceId: "resource-1" },
    },
    { code: 200, songId: "9001" },
    { code: 200 },
  ];
}

function callbacks(overrides = {}) {
  const phases = [];
  const progress = [];
  return {
    phases,
    progress,
    value: {
      uploadId: "upload-1",
      onPhase: (phase) => phases.push(phase),
      onProgress: (loaded, total) => progress.push([loaded, total]),
      isCancelled: () => false,
      ...overrides,
    },
  };
}

test("直传链路按 check、token、LBS、原生上传、入库、发布顺序执行", async () => {
  const h = setup({ responses: successResponses(true) });
  const c = callbacks();
  const outcome = await h.api.uploadCloudAudio(FILE, c.value);

  assert.deepEqual(h.apiCalls.map((call) => call.path), [
    "/cloud/upload/check",
    "/nos/token/alloc",
    "/upload/cloud/info/v2",
    "/cloud/pub/v2",
  ]);
  assert.deepEqual(h.apiCalls[0].payload, {
    bitrate: "999000",
    ext: "",
    length: FILE.size,
    md5: MD5,
    songId: "0",
    version: 1,
  });
  assert.deepEqual(h.apiCalls[1].payload, {
    bucket: "jd-musicrep-privatecloud-audio-public",
    ext: "flac",
    filename: "晴天",
    local: false,
    nos_product: 3,
    type: "audio",
    md5: MD5,
  });
  assert.equal(h.apiCalls[2].payload.filename, FILE.fileName);
  assert.equal(h.apiCalls[2].payload.song, FILE.title);
  assert.equal(h.apiCalls[2].payload.artist, FILE.artist);
  assert.equal(h.apiCalls[2].payload.album, FILE.album);
  assert.equal(h.apiCalls[2].payload.songid, "9001");
  assert.equal(h.apiCalls[2].payload.resourceId, "resource-1");
  assert.deepEqual(h.apiCalls[3].payload, { songid: "9001" });
  assert.ok(h.apiCalls.every((call) => call.cookie === COOKIE));

  assert.equal(h.fetchCalls.length, 1);
  assert.equal(
    h.uploadCalls[0][1],
    "https://nos.example/upload/jd-musicrep-privatecloud-audio-public/dir%2Ffile.flac?offset=0&complete=true&version=1.0",
  );
  assert.equal(h.uploadCalls[0][0], FILE.uri);
  assert.equal(h.uploadCalls[0][2], "nos-token");
  assert.equal(h.uploadCalls[0][3], MD5);
  assert.equal(h.uploadCalls[0][4], "audio/flac");
  assert.equal(h.uploadCalls[0][5], FILE.size);
  assert.equal(h.uploadCalls[0][6], "upload-1");

  assert.deepEqual(c.phases, ["hashing", "checking", "uploading", "completing"]);
  assert.deepEqual(outcome, { songId: "9001", needUpload: true });
});

test("needUpload=false 跳过二进制上传但仍完成入库", async () => {
  const h = setup({ responses: successResponses(false) });
  const c = callbacks();
  const outcome = await h.api.uploadCloudAudio(FILE, c.value);

  assert.equal(h.uploadCalls.length, 0);
  assert.equal(h.fetchCalls.length, 0);
  assert.deepEqual(c.phases, ["hashing", "checking", "completing"]);
  assert.deepEqual(outcome, { songId: "9001", needUpload: false });
});

test("取消后不再发起 weapi 请求", async () => {
  const h = setup({ responses: successResponses(true) });
  const c = callbacks({ isCancelled: () => true });
  await assert.rejects(h.api.uploadCloudAudio(FILE, c.value), { name: "CloudUploadCancelledError" });
  assert.equal(h.apiCalls.length, 0);
});

test("上传凭证缺少字段时显式失败", async () => {
  const h = setup({
    responses: [
      { code: 200, needUpload: true, songId: "9001" },
      { code: 200, result: { token: "t" } },
    ],
  });
  await assert.rejects(h.api.uploadCloudAudio(FILE, callbacks().value), /上传凭证/);
  assert.equal(h.uploadCalls.length, 0);
});

test("文件选择结果缺少大小或 URI 时拒绝", async () => {
  const h = setup({
    picked: [
      { ...FILE, uri: "" },
      { ...FILE, fileName: "缺大小.flac", size: 0 },
    ],
  });
  await assert.rejects(h.api.pickCloudAudioFiles(), /无法读取音频文件/);
});

test("删除云盘歌曲使用 songIds 数组", async () => {
  const h = setup({ responses: [{ code: 200 }] });
  await h.api.deleteCloudSong("9001");
  assert.deepEqual(h.apiCalls, [{
    path: "/cloud/del",
    payload: { songIds: ["9001"] },
    cookie: COOKIE,
  }]);
});

test("删除失败保留服务端消息", async () => {
  const h = setup({ responses: [{ code: 400, msg: "没有权限" }] });
  await assert.rejects(h.api.deleteCloudSong("9001"), { message: "没有权限" });
});
