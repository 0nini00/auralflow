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
    URL,
    console,
    TextEncoder,
    TextDecoder,
    ...(options.context ?? {}),
  }, { filename: sourcePath });

  return module.exports;
}

const localScript = `/*
 * @name 测试音源
 * @description 本地版本
 * @author tester
 * @homepage https://github.com/example/source/blob/main/user-api.js
 * @version 1.0.0
 */
lx.send(lx.EVENT_NAMES.inited, { sources: { wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } });
`;

const newerRemoteScript = `/*
 * @name 测试音源
 * @description 远端版本
 * @author tester
 * @homepage https://github.com/example/source/blob/main/user-api.js
 * @version 1.1.0
 */
`;

const sameRemoteScript = localScript.replace("本地版本", "远端同版本");
const delayedUpdateScript = `/*
 * @name 延迟更新音源
 * @description 模拟移动端兼容更新提示
 * @author tester
 * @homepage
 * @version 1.0.0
 */
lx.send(lx.EVENT_NAMES.inited, { sources: { wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } });
setTimeout(() => {
  lx.send(lx.EVENT_NAMES.updateAlert, {
    log: '发现新版本 1.1.0',
    updateUrl: 'https://example.com/source.js',
  });
}, 3000);
`;
const xinghaiLikeScript = `/*!
 * @name 星海音乐源
 * @description GDAPI | 聚合 | ChKSz API
 * @version v2.3.4
 * @author 万去了了
 * @homepage https://zrcdy.dpdns.org/
 * @lastUpdate 2026-06-06
 */
const { EVENT_NAMES, request, send } = globalThis.lx;
const UPDATE_CONFIG = {
  versionApiUrl: 'https://zrcdy.dpdns.org/lx/version.php',
  latestScriptUrl: 'https://zrcdy.dpdns.org/lx/vers.php',
  currentVersion: 'v2.3.4',
};
function httpFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    request(url, options, (err, resp) => {
      if (err) return reject(err);
      resolve({ statusCode: resp.statusCode, body: resp.body });
    });
  });
}
function compareVersions(remote, local) {
  const toParts = (value) => String(value).replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = toParts(remote);
  const b = toParts(local);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return true;
    if ((a[index] || 0) < (b[index] || 0)) return false;
  }
  return false;
}
send(EVENT_NAMES.inited, { sources: { wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } });
setTimeout(async () => {
  const resp = await httpFetch(UPDATE_CONFIG.versionApiUrl, { timeout: 10000, headers: { 'User-Agent': 'LX-Music-Mobile' } });
  if (resp.statusCode !== 200) return;
  const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
  if (compareVersions(data.version, UPDATE_CONFIG.currentVersion)) {
    send(EVENT_NAMES.updateAlert, {
      log: \`发现新版本 \${data.version}\\n\${data.changelog || ''}\`,
      updateUrl: data.update_url || UPDATE_CONFIG.latestScriptUrl,
    });
  }
}, 3000);
`;
const requests = [];
let remoteScript = newerRemoteScript;
const xinghaiVersionPayload = {
  version: "v3.2.6",
  changelog: "1,优化wy，tx源。2,眼瞎了,2和3都搞反了「无语」，所以导致差太大了\nG1联通双月卡29元220G+100分钟【发全国】➡ https://zrcdy.dpdns.org/h/1.html",
};

const scaledSetTimeout = (handler, timeout = 0, ...args) => setTimeout(handler, Math.ceil(timeout / 100), ...args);

const runtime = loadTsModule("../src/services/customSourceRuntime.ts", {
  requireStubs: {
    "@tauri-apps/plugin-http": {
      fetch: async (url) => {
        requests.push(String(url));
        if (String(url).includes("zrcdy.dpdns.org/lx/version.php")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: { forEach: () => {} },
            text: async () => JSON.stringify(xinghaiVersionPayload),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { forEach: () => {} },
          text: async () => remoteScript,
        };
      },
    },
    "@/utils/compression": {
      inflateBytes: async () => new Uint8Array(),
      deflateBytes: async () => new Uint8Array(),
      zlibFormatFromOptions: () => "deflate",
    },
  },
  context: {
    setTimeout: scaledSetTimeout,
    clearTimeout,
    AbortController,
    window: {
      setTimeout: scaledSetTimeout,
      clearTimeout,
    },
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    crypto: { getRandomValues: (bytes) => bytes.fill(1) },
  },
});

assert.equal(typeof runtime.checkCustomSourceRemoteUpdate, "function", "runtime should export remote custom source update checks");

const source = {
  id: "source-1",
  name: "测试音源",
  description: "本地版本",
  script: localScript,
  enabled: true,
  allowShowUpdateAlert: true,
  author: "tester",
  homepage: "https://github.com/example/source/blob/main/user-api.js",
  version: "1.0.0",
  testStatus: "idle",
  updateStatus: "idle",
  createdAt: 1,
  updatedAt: 1,
};

const update = await runtime.checkCustomSourceRemoteUpdate(source);
assert.equal(update?.updateUrl, "https://raw.githubusercontent.com/example/source/main/user-api.js");
assert.match(update?.log ?? "", /1\.0\.0.*1\.1\.0|1\.1\.0.*1\.0\.0/, "newer remote version should be reported");
assert.deepEqual(
  requests,
  ["https://raw.githubusercontent.com/example/source/main/user-api.js"],
  "GitHub blob homepage should be fetched through the raw URL",
);

remoteScript = sameRemoteScript;
const latest = await runtime.checkCustomSourceRemoteUpdate(source);
assert.equal(latest, undefined, "same remote version should not be reported as an update");

const delayedSource = {
  ...source,
  id: "source-delayed",
  name: "延迟更新音源",
  script: delayedUpdateScript,
  homepage: "",
  version: "1.0.0",
};
const delayedUpdate = await runtime.checkCustomSourceUpdate(delayedSource);
assert.equal(
  delayedUpdate.updateAlert?.log,
  "发现新版本 1.1.0",
  "custom sources that emit updateAlert about 3 seconds after init should be detected",
);

const xinghaiUpdate = await runtime.checkCustomSourceUpdate({
  ...source,
  id: "source-xinghai",
  name: "星海音乐源",
  script: xinghaiLikeScript,
  homepage: "https://zrcdy.dpdns.org/",
  version: "v2.3.4",
});
assert.match(
  xinghaiUpdate.updateAlert?.log ?? "",
  /发现新版本 v3\.2\.6/,
  "Xinghai-style sources should surface the version returned by version.php",
);
assert.equal(
  xinghaiUpdate.updateAlert?.updateUrl,
  "https://zrcdy.dpdns.org/lx/vers.php",
  "Xinghai-style sources should fall back to latestScriptUrl when version.php does not return update_url",
);
assert.match(
  xinghaiUpdate.updateAlert?.log ?? "",
  /https:\/\/zrcdy\.dpdns\.org\/h\/1\.html/,
  "Xinghai-style sources should keep changelog links in the update log without treating them as the update button URL",
);

const storeSource = readFileSync(resolve(__dirname, "../src/stores/customSourceStore.ts"), "utf8");
assert.match(
  storeSource,
  /checkCustomSourceUpdate/,
  "store checkSourceUpdate should use the combined runtime + remote update checker",
);

const appSource = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8");
assert.match(
  appSource,
  /customSourcePersistence\.ready/,
  "startup update checks should wait for custom source persistence hydration",
);

const rustModelsSource = readFileSync(resolve(__dirname, "../src-tauri/src/models.rs"), "utf8");
assert.match(
  rustModelsSource,
  /custom_source_auto_check:\s*true/,
  "custom source auto-check should be enabled by default",
);

const settingsSource = readFileSync(resolve(__dirname, "../src/views/SettingsView.tsx"), "utf8");
assert.match(
  settingsSource,
  /openCustomSourceUpdateModal\(source\.id\)/,
  "settings view should open the custom source update popup instead of skipping straight to the browser",
);

const appWithModalSource = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8");
assert.match(
  appWithModalSource,
  /CustomSourceUpdateModal/,
  "main app should render a global custom source update popup",
);

const updateModalSource = readFileSync(resolve(__dirname, "../src/components/CustomSourceUpdateModal.tsx"), "utf8");
assert.match(
  updateModalSource,
  /export function openCustomSourceUpdateModal/,
  "custom source update popup should expose a manual open helper for settings actions",
);
assert.match(
  updateModalSource,
  /updateStatus === ["']available["']/,
  "custom source update popup should only show sources with available updates",
);
assert.match(
  updateModalSource,
  /allowShowUpdateAlert !== false/,
  "custom source update popup should respect the per-source update alert toggle",
);
assert.match(
  updateModalSource,
  /open\(source\.updateUrl\)/,
  "custom source update popup should open the update URL reported by the source",
);
assert.match(
  updateModalSource,
  /自定义源【\{source\.name\}】发现新版本：/,
  "custom source update popup should show the LX-style source update heading",
);
assert.match(
  updateModalSource,
  /打开更新地址/,
  "custom source update popup should keep the LX-style open update address action",
);

console.log("custom source update tests passed");
