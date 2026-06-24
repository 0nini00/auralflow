import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTxProvider(fetchImpl) {
  const sourcePath = resolve(__dirname, "../src/services/sources/txProvider.ts");
  assert.equal(existsSync(sourcePath), true, "txProvider.ts should exist");

  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const moduleRequire = (id) => {
    if (id === "@tauri-apps/plugin-http") {
      return { fetch: fetchImpl };
    }
    return require(id);
  };

  vm.runInNewContext(transpiled.outputText, {
    exports: module.exports,
    module,
    require: moduleRequire,
    URL,
    URLSearchParams,
    console,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    window: { fetch: fetchImpl },
    Math,
  }, { filename: sourcePath });

  return module.exports.txProvider;
}

const calls = [];
const provider = loadTxProvider(async (url, options = {}) => {
  calls.push({ url: String(url), options });
  const body = typeof options.body === "string" ? JSON.parse(options.body) : undefined;
  const searchType = body?.request?.param?.search_type;

  assert.equal(String(url), "https://u.y.qq.com/cgi-bin/musicu.fcg", "QQ search should use the musicu.fcg lite API");
  assert.equal(body?.request?.method, "DoSearchForQQMusicLite", "QQ search should use the lite search method");
  assert.equal(body?.request?.module, "music.search.SearchCgiService", "QQ search should use SearchCgiService");

  if (searchType === 3) {
    return {
      ok: true,
      json: async () => ({
        code: 0,
        request: {
          code: 0,
          data: {
            body: {
              item_songlist: [
                {
                  dissid: "89231",
                  dissname: "许嵩精选",
                  creator: { name: "QQ 用户" },
                  imgurl: "//y.qq.com/cover.jpg",
                  dissdesc: "<em>测试歌单</em>",
                  listennum: 123456,
                },
              ],
            },
          },
        },
      }),
    };
  }

  if (searchType === 1) {
    throw new Error("QQ singer search should not call the API while the feature is closed");
  }

  return {
    ok: false,
    status: 400,
    text: async () => "",
    json: async () => ({}),
  };
});

const playlistResult = await provider.search("许嵩", "playlist", 1);
assert.equal(playlistResult.playlists?.length, 1, "QQ playlist search should return mapped playlists");
const playlist = playlistResult.playlists?.[0];
assert.equal(playlist?.id, "89231");
assert.equal(playlist?.name, "许嵩精选");
assert.equal(playlist?.author, "QQ 用户");
assert.equal(playlist?.picUrl, "https://y.qq.com/cover.jpg");
assert.equal(playlist?.desc, "测试歌单");
assert.equal(playlist?.playCount, 123456);
assert.equal(playlist?.source, "tx");

assert.equal(
  provider.supportedSearchTypes.includes("singer"),
  false,
  "QQ provider should not advertise singer search while the feature is closed",
);
const artistResult = await provider.search("许嵩", "singer", 1);
assert.deepEqual(
  Object.keys(artistResult),
  [],
  "QQ singer search should return no result object while the feature is closed",
);

assert.equal(calls.length, 1, "playlist search should issue one request and singer search should be blocked locally");
assert.deepEqual(
  calls.map((call) => JSON.parse(call.options.body).request.param.search_type),
  [3],
  "QQ search type mapping should keep playlist=3",
);

console.log("QQ search tests passed");
