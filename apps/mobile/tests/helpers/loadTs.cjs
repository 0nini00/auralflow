const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const mobileRoot = path.resolve(__dirname, "../..");
const coreRoot = path.resolve(mobileRoot, "../..", "packages/core");
const CORE_ENTRY = path.join(coreRoot, "src", "index.ts");
const mobileRequire = createRequire(path.join(mobileRoot, "package.json"));
// core 自己的依赖（tr46）装在 core 包里，从移动端解析不到，单独开一个 require。
const coreRequire = createRequire(path.join(coreRoot, "package.json"));
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

/** 导入名解析成源码文件：先试同名 .ts，再试目录下的 index.ts（core 里有 `./sources` 这种目录导入）。 */
function resolveSourceFile(base, request) {
  const target = path.resolve(base, request);
  for (const candidate of [`${target}.ts`, path.join(target, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`找不到模块 ${request}（基准目录 ${base}）`);
}

// 每次构建独立模块图；仅原生、网络等边界由用例显式替换。
// `@lx/core` 是双端共享的应用代码，按真实源码加载（与用例里 `createLoader({})("../../packages/core/src/x.ts")`
// 的写法一致）：不这样，每次把逻辑搬进 core 都会让引用它的移动模块在单测里加载失败。
function createLoader(mocks) {
  const modules = new Map();
  function loadFile(filename) {
    const resolved = path.resolve(filename);
    if (modules.has(resolved)) return modules.get(resolved).exports;
    const source = fs.readFileSync(resolved, "utf8");
    const code = transpile(resolved, source);
    const module = { exports: {} };
    modules.set(resolved, module);
    function requireDependency(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === "@lx/core") return loadFile(CORE_ENTRY);
      if (resolved.startsWith(`${coreRoot}${path.sep}`) && !name.startsWith(".")) return coreRequire(name);
      if (name.startsWith("@/")) return loadFile(resolveSourceFile(mobileRoot, `src/${name.slice(2)}`));
      if (name.startsWith(".")) return loadFile(resolveSourceFile(path.dirname(resolved), name));
      throw new Error(`Unmocked import ${name} in ${resolved}`);
    }
    new Function("require", "module", "exports", code)(requireDependency, module, module.exports);
    return module.exports;
  }
  return (relativePath) => loadFile(path.resolve(mobileRoot, relativePath));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

module.exports = { createLoader, deferred, mobileRequire, mobileRoot };
