import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTsModule(relativePath, options = {}) {
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
  const moduleRequire = (id) => {
    if (options.requireStubs && Object.prototype.hasOwnProperty.call(options.requireStubs, id)) {
      return options.requireStubs[id];
    }
    return require(id);
  };

  vm.runInNewContext(transpiled.outputText, {
    exports: module.exports,
    module,
    require: moduleRequire,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    AbortController,
    window: options.window ?? {},
  }, { filename: sourcePath });

  return module.exports;
}

const neverFetch = () => new Promise(() => {});
let tauriCalls = 0;

const { builtinNeteaseBackend } = loadTsModule("../src/services/playback/builtinNeteaseBackend.ts", {
  window: {
    fetch: neverFetch,
  },
  requireStubs: {
    "@tauri-apps/plugin-http": {
      fetch: async () => {
        tauriCalls += 1;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ url: "https://tauri.example/audio.mp3" }),
        };
      },
    },
  },
});

const music = { id: "123", source: "wy", name: "Timeout Test", singer: "Tester" };

const winner = await Promise.race([
  builtinNeteaseBackend.resolve({
    primary: music,
    variants: [music],
    qualityPreference: ["320k"],
  }),
  new Promise((resolve) => setTimeout(() => resolve("timeout"), 1500)),
]);

assert.notEqual(
  winner,
  "timeout",
  "builtin netease playback should not hang forever when browser fetch never settles",
);
assert.equal(tauriCalls > 0, true, "builtin netease playback should fall back to Tauri fetch after browser timeout");
assert.equal(winner?.url, "https://tauri.example/audio.mp3");

console.log("builtin playback timeout tests passed");
