const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const test = require("node:test");
const { createLoader, deferred, mobileRequire, mobileRoot } = require("./helpers/loadTs.cjs");
const desktopRequire = createRequire(path.resolve(mobileRoot, "../../desktop/package.json"));
const React = desktopRequire("react");
const { create, act } = desktopRequire("react-test-renderer");
const ts = mobileRequire("typescript");

function loadDispatch(overrides = {}) {
  const source = fs.readFileSync(path.join(mobileRoot, "App.tsx"), "utf8");
  const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dispatch = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "dispatchMobileIntent");
  assert.ok(dispatch, "App 必须将外部音频接入播放，并保留音源确认入口");
  const calls = [];
  const song = { id: "file", source: "local", name: "外部歌曲", url: "content://files/1" };
  const dependencies = {
    navigationRef: { navigate: (...args) => calls.push(["navigate", ...args]) },
    Alert: { alert: (...args) => calls.push(["alert", ...args]) },
    importSourceFromIntent: uri => calls.push(["import", uri]),
    readLocalAudioFile: async uri => { calls.push(["read", uri]); return song; },
    playQueue: async (...args) => calls.push(["play", ...args]),
    ...overrides,
  };
  const code = ts.transpileModule(dispatch.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function(...Object.keys(dependencies), `${code}; return dispatchMobileIntent;`)(...Object.values(dependencies));
  return { calls, song, dispatch: (intent, isCurrent = () => true) => run(intent, isCurrent) };
}

test("外部音频读取后走现有播放队列并打开播放器", async () => {
  const h = loadDispatch();
  await h.dispatch({ type: "playAudio", uri: h.song.url });
  assert.deepEqual(h.calls, [["read", h.song.url], ["play", [h.song], 0], ["navigate", "Player"]]);
});

test("外部音源只有点击导入才写入，取消后允许再次打开", async () => {
  const h = loadDispatch();
  const intent = { type: "importSource", uri: "content://files/source", fileName: "音源.js" };
  await h.dispatch(intent);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "alert");
  assert.match(h.calls[0][2], /音源.js/);
  const buttons = h.calls[0][3];
  assert.equal(buttons.find(button => button.text === "取消").style, "cancel");
  await h.dispatch(intent);
  assert.equal(h.calls.filter(call => call[0] === "alert").length, 2);
  buttons.find(button => button.text === "导入").onPress();
  assert.deepEqual(h.calls.at(-1), ["import", intent.uri]);
});

test("读取或播放失败拒绝且不导航到虚假的播放成功页面", async () => {
  for (const name of ["readLocalAudioFile", "playQueue"]) {
    const error = new Error("文件无法播放");
    const h = loadDispatch({ [name]: async () => { throw error; } });
    await assert.rejects(h.dispatch({ type: "playAudio", uri: h.song.url }), actual => actual === error);
    assert.equal(h.calls.some(call => call[0] === "navigate"), false);
  }
});

test("新请求接管后旧音频读取完成不得开始播放或覆盖导航", async () => {
  const pending = deferred();
  const started = deferred();
  const h = loadDispatch({ readLocalAudioFile: async () => { started.resolve(); return pending.promise; } });
  const { createMobileLinkController } = createLoader({})("src/services/mobileLinkController.ts");
  const controller = createMobileLinkController({
    resolve: async value => value === "old" ? { type: "playAudio", uri: "content://files/old" } : { type: "search", keyword: "new" },
    dispatch: h.dispatch,
    onError: error => assert.fail(error.message),
  });
  await controller.setReady(true);
  const old = controller.receive("old");
  await started.promise;
  await controller.receive("new");
  pending.resolve(h.song);
  await old;
  assert.deepEqual(h.calls, [["navigate", "MainTabs", { screen: "SearchTab", params: { initialKeyword: "new" } }]]);
});

test("播放提交期间新请求接管后，旧完成不得跳回播放器", async () => {
  const pending = deferred();
  const started = deferred();
  let current = true;
  const h = loadDispatch({ playQueue: async () => { started.resolve(); await pending.promise; } });
  const old = h.dispatch({ type: "playAudio", uri: h.song.url }, () => current);
  await started.promise;
  current = false;
  pending.resolve();
  await old;
  assert.equal(h.calls.some(call => call[0] === "navigate"), false);
});

function hookFixture(t) {
  const filename = path.join(mobileRoot, "src/hooks/useMobileDeepLinks.ts");
  assert.ok(fs.existsSync(filename), "冷启动和热启动文件打开需要接入同一个就绪入口");
  const initial = deferred();
  const dispatches = [];
  const errors = [];
  let listener;
  const load = createLoader({
    react: React,
    "react-native": {
      Linking: { getInitialURL: () => initial.promise, addEventListener: (_name, callback) => {
        listener = callback; return { remove: () => { listener = null; } };
      } },
      Alert: { alert: (...args) => errors.push(args) },
    },
    "@/services/externalFileService": { resolveMobileLink: async uri => ({ type: "playAudio", uri }) },
  });
  const { useMobileDeepLinks } = load(filename);
  const dispatch = intent => dispatches.push(intent);
  function Probe({ ready }) { useMobileDeepLinks(ready, dispatch); return null; }
  let root;
  act(() => { root = create(React.createElement(Probe, { ready: false })); });
  t.after(() => act(() => root.unmount()));
  return {
    dispatches, errors,
    async ready() { await act(async () => root.update(React.createElement(Probe, { ready: true }))); },
    async initial(uri) { await act(async () => { initial.resolve(uri); await initial.promise; }); },
    async event(uri) { await act(async () => listener({ url: uri })); },
  };
}

test("初始文件等待就绪后打开，热启动可以重复打开同一个 URI", async t => {
  const h = hookFixture(t);
  await h.initial("content://files/1");
  assert.deepEqual(h.dispatches, []);
  await h.ready();
  assert.equal(h.dispatches.length, 1);
  await h.event("content://files/1");
  assert.equal(h.dispatches.length, 2);
});

test("热启动 URL 早于初始 URL 返回时不得被旧文件覆盖", async t => {
  const h = hookFixture(t);
  await h.event("content://files/new");
  await h.initial("content://files/old");
  await h.ready();
  assert.deepEqual(h.dispatches, [{ type: "playAudio", uri: "content://files/new" }]);
});
