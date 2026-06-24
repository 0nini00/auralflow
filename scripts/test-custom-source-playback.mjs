import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));

function createDeferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

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
  }, { filename: sourcePath });

  return module.exports;
}

const slowDeferred = createDeferred();
let slowCalls = 0;
let fastCalls = 0;

const { customSourceBackend } = loadTsModule("../src/services/playback/customSourceBackend.ts", {
  requireStubs: {
    "@/stores/customSourceStore": {
      useCustomSourceStore: {
        getState: () => ({
          sources: [
            { id: "slow-source", name: "Slow Source", enabled: true },
            { id: "fast-source", name: "Fast Source", enabled: true },
          ],
        }),
      },
    },
    "@/services/customSourceRuntime": {
      requestCustomSourceMusicUrl: async (api, music, quality) => {
        if (api.id === "slow-source") {
          slowCalls += 1;
          return slowDeferred.promise;
        }
        fastCalls += 1;
        return {
          url: `https://fast.example/${music.id}/${quality}.mp3`,
          quality,
        };
      },
    },
  },
});

const resolvePromise = customSourceBackend.resolve({
  primary: { id: "track-1", source: "wy", name: "Track 1", singer: "Artist 1" },
  variants: [{ id: "track-1", source: "wy", name: "Track 1", singer: "Artist 1" }],
  qualityPreference: ["320k"],
});

const winner = await Promise.race([
  resolvePromise,
  new Promise((resolve) => setTimeout(() => resolve("timeout"), 120)),
]);

assert.notEqual(
  winner,
  "timeout",
  "custom source playback should not block on the first slow source when a later source can resolve quickly",
);
assert.equal(slowCalls, 1, "slow source should still be attempted once");
assert.equal(fastCalls, 1, "fast source should be attempted in parallel instead of waiting for the slow source to finish");
assert.equal(winner?.resolverName, "Fast Source", "the first successful faster source should win playback resolution");
assert.equal(winner?.url, "https://fast.example/track-1/320k.mp3");

slowDeferred.resolve({ url: "https://slow.example/track-1/320k.mp3", quality: "320k" });

console.log("custom source playback tests passed");
