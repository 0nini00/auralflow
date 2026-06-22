import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTsModule(relativePath) {
  const sourcePath = resolve(__dirname, relativePath);
  assert.equal(existsSync(sourcePath), true, `${relativePath} should exist`);
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(transpiled.outputText, {
    exports: module.exports,
    module,
    require,
  }, { filename: sourcePath });
  return module.exports;
}

const { buildMusicShareLink, buildMusicShareText } = loadTsModule("../src/utils/shareLink.ts");

assert.equal(
  buildMusicShareLink({ id: "12345", name: "晴天", singer: "周杰伦", albumName: "", source: "wy" }),
  "https://music.163.com/#/song?id=12345",
  "NetEase songs should share their official song URL",
);

assert.equal(
  buildMusicShareLink({ id: "0039MnYb0qxYhV", name: "七里香", singer: "周杰伦", albumName: "", source: "tx" }),
  "https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV",
  "QQ Music songs should share their official song detail URL",
);

assert.equal(
  buildMusicShareLink({ id: "local-1", name: "本地歌", singer: "本地歌手", albumName: "", source: "local" }),
  null,
  "local songs do not have a platform share URL",
);

assert.equal(
  buildMusicShareText({ id: "local-1", name: "本地歌", singer: "本地歌手", albumName: "", source: "local" }),
  "本地歌 - 本地歌手",
  "local songs should fall back to readable song info",
);

const playerViewSource = readFileSync(resolve(__dirname, "../src/views/PlayerView.tsx"), "utf8");
assert.match(
  playerViewSource,
  /buildMusicShareText\(currentTrack\)/,
  "player share action should copy the platform share link when available",
);
assert.match(
  playerViewSource,
  /title="复制歌曲链接"/,
  "player share button tooltip should describe copying a song link",
);

console.log("share link tests passed");
