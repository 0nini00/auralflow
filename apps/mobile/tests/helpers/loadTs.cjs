const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const mobileRoot = path.resolve(__dirname, "../..");
const mobileRequire = createRequire(path.join(mobileRoot, "package.json"));
const ts = mobileRequire("typescript");

// 每次构建独立模块图；仅原生、网络等边界由用例显式替换。
function createLoader(mocks) {
  const modules = new Map();
  function load(relativePath) {
    const filename = path.resolve(mobileRoot, relativePath);
    if (modules.has(filename)) return modules.get(filename).exports;
    const source = fs.readFileSync(filename, "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;
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
