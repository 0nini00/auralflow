const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

const nativeDir = path.resolve(__dirname, "../android/app/src/main/java/cn/chenle/auralflow/mobile");
const AUDIO_URI = "content://downloads/document/42";
const nativeSong = (patch = {}) => ({
  id: "42", title: "外部歌曲", artist: "歌手", album: "专辑", duration: 123400,
  filePath: AUDIO_URI, contentUri: AUDIO_URI, ...patch,
});

function loadAudioService(native, platform = "android") {
  return createLoader({
    "react-native": { NativeModules: { LocalMusicModule: native }, Platform: { OS: platform } },
    "react-native-fs": {},
    "react-native-permissions": {},
    "@/stores/downloadStore": {},
  })("src/services/localMusicService.ts");
}

test("外部音频映射为临时本地歌曲并保留授权 URI", async () => {
  const calls = [];
  const api = loadAudioService({ readLocalAudioFile: async (uri) => { calls.push(uri); return nativeSong(); } });
  assert.equal(typeof api.readLocalAudioFile, "function", "缺少外部单文件音频入口");
  const song = await api.readLocalAudioFile(AUDIO_URI);
  assert.deepEqual(calls, [AUDIO_URI]);
  assert.deepEqual(song, {
    id: "42", name: "外部歌曲", singer: "歌手", albumName: "专辑", source: "local",
    interval: 123, url: AUDIO_URI, picUrl: undefined, img: undefined,
    localLyrics: undefined, isLocal: true, localOrigin: "manual",
  });
});

test("标准 file:/ URI 规范化为可播放的 file:/// URL", async () => {
  const uri = "file:/storage/emulated/0/Music/song%20%231.mp3";
  const api = loadAudioService({
    readLocalAudioFile: async (value) => {
      assert.equal(value, uri);
      return nativeSong({ filePath: value, contentUri: value });
    },
  });
  const song = await api.readLocalAudioFile(uri);
  assert.equal(song.url, "file:///storage/emulated/0/Music/song%20%231.mp3");
});

test("外部音频入口在调用原生前拒绝非本地 URI", async () => {
  const api = loadAudioService({ readLocalAudioFile: () => assert.fail("无效 URI 不得送入原生") });
  assert.equal(typeof api.readLocalAudioFile, "function");
  for (const uri of [null, "", "https://example.test/a.mp3", "relative.mp3", "content:///42", "file://host/a.mp3"]) {
    await assert.rejects(api.readLocalAudioFile(uri), /URI/);
  }
});

test("外部音频入口拒绝损坏的原生歌曲结果", async () => {
  for (const value of [null, {}, nativeSong({ id: "" }), nativeSong({ duration: NaN }),
    nativeSong({ duration: -1 }), nativeSong({ title: null }), nativeSong({ filePath: "" }),
    nativeSong({ albumArtUri: 17 })]) {
    const api = loadAudioService({ readLocalAudioFile: async () => value });
    assert.equal(typeof api.readLocalAudioFile, "function");
    await assert.rejects(api.readLocalAudioFile(AUDIO_URI), /结果/);
  }
});

test("外部音频入口保留原生读取失败", async () => {
  const error = new Error("临时读取授权已失效");
  const api = loadAudioService({ readLocalAudioFile: async () => { throw error; } });
  assert.equal(typeof api.readLocalAudioFile, "function");
  await assert.rejects(api.readLocalAudioFile(AUDIO_URI), (actual) => actual === error);
});

test("外部音频原生模块缺失或平台不支持时明确失败", async () => {
  const missing = loadAudioService({});
  const unsupported = loadAudioService({}, "ios");
  assert.equal(typeof missing.readLocalAudioFile, "function");
  await assert.rejects(missing.readLocalAudioFile(AUDIO_URI), /原生模块/);
  await assert.rejects(unsupported.readLocalAudioFile(AUDIO_URI), /Android/);
});

test("热启动先更新 Activity Intent，再交由 React Native 分发", () => {
  const source = fs.readFileSync(path.join(nativeDir, "MainActivity.kt"), "utf8");
  assert.match(source, /override fun onNewIntent\(intent: Intent\)\s*\{\s*setIntent\(intent\)\s*super\.onNewIntent\(intent\)/);
});

function readMethod(source, name) {
  const match = source.match(new RegExp(`^  (?:public|private) (?:static )?[^\\n]+ ${name}\\([^]*?^  }`, "m"));
  assert.ok(match, `缺少原生方法 ${name}`);
  return match[0];
}

test("原生文件边界校验 URI、元数据、读取授权及后台生命周期", { timeout: 60000 }, () => {
  const sourceInfo = fs.readFileSync(path.join(nativeDir, "CustomSourceFilePickerModule.java"), "utf8");
  const sourceAudio = fs.readFileSync(path.join(nativeDir, "LocalMusicModule.java"), "utf8");
  const infoMethods = ["getFileInfo", "readFileInfo", "invalidate"].map((name) => readMethod(sourceInfo, name)).join("\n");
  const audioMethods = ["readLocalAudioFile", "resolveLocalAudioFile", "invalidate"].map((name) => readMethod(sourceAudio, name)).join("\n");
  const field = (source, name) => {
    const match = source.match(new RegExp(`^  private final ExecutorService ${name} = [^]*?;$`, "m"));
    assert.ok(match, `缺少后台执行器 ${name}`);
    return match[0];
  };
  const template = fs.readFileSync(path.join(__dirname, "fixtures/external-file/ExternalFileNativeHarness.java"), "utf8");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralflow-external-file-"));
  try {
    const target = path.join(directory, "ExternalFileNativeHarness.java");
    fs.writeFileSync(target, template
      .replace("/* FILE_INFO_METHODS */", field(sourceInfo, "fileInfoExecutor") + "\n" + infoMethods)
      .replace("/* AUDIO_METHODS */", field(sourceAudio, "audioAssetsExecutor") + "\n" + audioMethods));
    for (const [command, args] of [
      ["javac", ["-encoding", "UTF-8", "-d", directory, target]],
      ["java", ["-cp", directory, "ExternalFileNativeHarness", directory]],
    ]) {
      const executable = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", command) : command;
      const result = spawnSync(executable, args, { encoding: "utf8", timeout: 25000, windowsHide: true });
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("auralflow-external-file-"));
    fs.rmSync(directory, { recursive: true });
  }
});
