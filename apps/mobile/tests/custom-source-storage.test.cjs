const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");
const KEY = "auralflow.mobile.customSources";
const source = id => ({ id, name: id, description: "fixture", script: id, enabled: true, allowShowUpdateAlert: true, testStatus: "idle", createdAt: 1, updatedAt: 1 });

function fixture(options = {}) {
  const memory = new Map([[KEY, JSON.stringify({ sources: [source("old")], customSourceAutoCheck: true })]]);
  const writes = [];
  const invalidated = [];
  const runtime = {
    parseDesktopUserApiInfo: script => ({ name: script, description: "fixture" }),
    invalidateRuntimeCache: id => invalidated.push(id),
    testCustomSourceDeep: async () => ({ ok: true, message: "ok", sources: {} }),
    checkCustomSourceUpdate: async () => ({ sources: {} }),
  };
  const load = createLoader({
    zustand: mobileRequire("zustand"), "react-native-fs": {},
    "@react-native-async-storage/async-storage": {
      getItem: async key => { if (options.read) await options.read(); return memory.get(key) ?? null; },
      setItem: async (key, value) => { if (options.write) await options.write(); writes.push(value); memory.set(key, value); },
      removeItem: async key => memory.delete(key),
    },
    "@/services/customSourceRuntime": runtime,
    "@/services/crossSourceFallbackService": { clearCrossSourceVariantCache() {} },
    "@/services/logger": { logger: { error() {} } },
  });
  return { store: load("src/stores/customSourceStore.ts").useCustomSourceStore, memory, writes, invalidated, runtime };
}

test("音源读取失败不能发布空的就绪状态或允许后续写入", async () => {
  const h = fixture({ read: async () => { throw new Error("read unavailable"); } });
  await assert.rejects(h.store.getState().loadFromStorage(), /read unavailable/);
  assert.equal(h.store.getState().loaded, false);
  await assert.rejects(h.store.getState().importScript("new"), /read unavailable/);
  assert.equal(h.writes.length, 0);
});

for (const operation of ["import", "replace", "toggle", "remove", "setting"]) {
  test(`音源 ${operation} 写入失败拒绝且保留旧内存与磁盘`, async () => {
    const h = fixture({ write: async () => { throw new Error("write unavailable"); } });
    await h.store.getState().loadFromStorage();
    const before = structuredClone(h.store.getState().sources);
    const actions = {
      import: () => h.store.getState().importScript("new"),
      replace: () => h.store.getState().replaceAll([source("new")]),
      toggle: () => h.store.getState().toggleSource("old", false),
      remove: () => h.store.getState().removeSource("old"),
      setting: () => h.store.getState().setCustomSourceAutoCheck(false),
    };
    await assert.rejects(async () => actions[operation](), /write unavailable/);
    assert.deepEqual(h.store.getState().sources, before);
    assert.equal(h.store.getState().customSourceAutoCheck, true);
    assert.equal(h.invalidated.length, 0);
  });
}

test("音源导入等待初始化，并发变更基于上次成功提交", async () => {
  const h = fixture();
  await Promise.all([h.store.getState().importScript("A"), h.store.getState().importScript("B"), h.store.getState().toggleSource("old", false)]);
  assert.deepEqual(h.store.getState().sources.map(item => item.script), ["old", "A", "B"]);
  assert.equal(h.store.getState().sources[0].enabled, false);
  assert.deepEqual(JSON.parse(h.memory.get(KEY)).sources.map(item => item.script), ["old", "A", "B"]);
});

test("音源检测结果和普通编辑在同一持久化边界提交", async () => {
  const h = fixture();
  await h.store.getState().loadFromStorage();
  const pending = deferred();
  h.runtime.testCustomSourceDeep = () => pending.promise;
  const testing = h.store.getState().testSource("old");
  await h.store.getState().toggleSource("old", false);
  pending.resolve({ ok: true, message: "ok", sources: {} });
  await testing;
  assert.equal(h.store.getState().sources[0].enabled, false);
  assert.equal(JSON.parse(h.memory.get(KEY)).sources[0].enabled, false);
});
