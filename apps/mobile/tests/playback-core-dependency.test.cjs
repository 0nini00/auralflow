const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { mobileRequire, mobileRoot } = require("./helpers/loadTs.cjs");

// 播放核心的依赖方向：playerStore 在下，playerService（编排）与 player/*（原生事件）在上。
// 这里按源码的真实导入边检查，而不是按某次加载是否碰巧成功：
// 动态 import() 与 require() 同样算边——用它们绕开静态环正是要禁止的写法。
const ts = mobileRequire("typescript");
const srcRoot = path.join(mobileRoot, "src");
const rel = (file) => path.relative(srcRoot, file).replace(/\\/g, "/");

function resolveImport(from, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((file) => fs.existsSync(file)) ?? null;
}

/** 运行期导入边：跳过 `import type` 与全部成员都是 type 的导入（编译后不存在）。 */
function runtimeImports(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const specifiers = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : null;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null;
      const typeOnly = node.isTypeOnly === true || clause?.isTypeOnly === true
        || (clause != null && !clause.name && named != null && named.length > 0 && named.every((element) => element.isTypeOnly));
      if (!typeOnly && node.moduleSpecifier) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers.map((specifier) => resolveImport(file, specifier)).filter(Boolean);
}

/** 从 entry 出发可达的全部模块，值为到达它的导入链（报错时直接给出是哪条边）。 */
function reachable(entry) {
  const chains = new Map([[entry, [entry]]]);
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.shift();
    for (const dependency of runtimeImports(file)) {
      if (chains.has(dependency)) continue;
      chains.set(dependency, [...chains.get(file), dependency]);
      pending.push(dependency);
    }
  }
  return chains;
}

const STORE = path.join(srcRoot, "stores/playerStore.ts");
const UPPER_LAYERS = ["services/playerService.ts", "services/cacheService.ts", "player/playbackService.ts", "player/playerListeners.ts"];

test("playerStore 不依赖播放编排与原生事件层（含动态 import）", () => {
  const chains = reachable(STORE);
  for (const upper of UPPER_LAYERS) {
    const chain = chains.get(path.join(srcRoot, upper));
    assert.equal(chain, undefined, `playerStore 不应到达 ${upper}：${(chain ?? []).map(rel).join(" -> ")}`);
  }
});

test("playerStore 依赖的模块都不反向导入 playerStore", () => {
  for (const [file, chain] of reachable(STORE)) {
    if (file === STORE) continue;
    assert.equal(runtimeImports(file).includes(STORE), false, `导入环：${[...chain, STORE].map(rel).join(" -> ")}`);
  }
});

test("上层模块确实建立在 playerStore 之上（检查本身没有因解析失败而空转）", () => {
  for (const upper of ["services/playerService.ts", "player/playbackService.ts", "player/playerListeners.ts"]) {
    assert.ok(reachable(path.join(srcRoot, upper)).has(STORE), `${upper} 应依赖 playerStore`);
  }
});
