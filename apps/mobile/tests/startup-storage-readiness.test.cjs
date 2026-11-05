const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { mobileRequire } = require("./helpers/loadTs.cjs");
const ts = mobileRequire("typescript");
const source = fs.readFileSync(path.join(__dirname, "../App.tsx"), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let expression;
function visit(node) {
  if (ts.isVoidExpression(node) && node.getText(ast).includes("Promise.allSettled") && node.getText(ast).includes("loadLocalPlaylists()")) expression = node.expression.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(expression, "必须执行真实 App 启动恢复表达式");
const runStartup = new Function("loadLocalPlaylists", "loadFavorites", "loadHistory", "loadLocalSongs", "loadDownloads", "setLocalDataReady", "console", "cancelled", "backgroundLabels", `return ${expression};`);

for (const failedIndex of [-1, 0, 1, 2, 3, 4]) {
  test(`启动数据恢复 ${failedIndex < 0 ? "全部成功" : "第 " + failedIndex + " 项失败"} 时准确发布同步就绪状态`, async () => {
    const updates = [];
    const errors = [];
    const tasks = Array.from({ length: 5 }, (_, index) => async () => {
      if (index === failedIndex) throw new Error("read unavailable");
    });
    await runStartup(...tasks, value => updates.push(value), { error: (...args) => errors.push(args) }, false, ["lists", "favorites", "history", "local", "downloads"]);
    assert.deepEqual(updates, [failedIndex < 0]);
    assert.equal(errors.length, failedIndex < 0 ? 0 : 1);
  });
}
