const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const mobileRoot = path.resolve(__dirname, "../..");
const mobileRequire = createRequire(path.join(mobileRoot, "package.json"));
const ts = mobileRequire("typescript");

// 转译结果按文件缓存。模块图仍然每次重建（createLoader 的 modules Map 是每个 loader 独立的），
// 但同一份源码不必反复 transpileModule —— 大模块（playerStore.ts 1000+ 行）一次要几百毫秒，
// 而每个用例都会新建 loader，累计就是每个用例几秒，把用例推到自身 runner 超时的边缘。
// 缓存按源码内容校验，源码改了会自动重转，因此不改变任何语义。
const transpiled = new Map();
function transpile(filename, source) {
  const cached = transpiled.get(filename);
  if (cached && cached.source === source) return cached.code;
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  transpiled.set(filename, { source, code });
  return code;
}

// 每次构建独立模块图；仅原生、网络等边界由用例显式替换。
function createLoader(mocks) {
  const modules = new Map();
  function load(relativePath) {
    const filename = path.resolve(mobileRoot, relativePath);
    if (modules.has(filename)) return modules.get(filename).exports;
    const source = fs.readFileSync(filename, "utf8");
    const code = transpile(filename, source);
    const module = { exports: {} };
    modules.set(filename, module);
    function requireDependency(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), `${name}.ts`));
      throw new Error(`Unmocked import ${name} in ${filename}`);
    }
    new Function("require", "module", "exports", code)(requireDependency, module, module.exports);
    return module.exports;
  }
  return load;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

module.exports = { createLoader, deferred, mobileRequire, mobileRoot };
