const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

/** 最小 zustand mock：只实现 store 需要的 create/getState/setState。 */
function createZustandMock() {
  return {
    create: (initializer) => {
      let state;
      const listeners = new Set();
      const set = (partial) => {
        const next = typeof partial === "function" ? partial(state) : partial;
        state = { ...state, ...next };
        listeners.forEach((listener) => listener(state));
      };
      const get = () => state;
      state = initializer(set, get);
      const useStore = (selector) => (selector ? selector(state) : state);
      useStore.getState = get;
      useStore.setState = set;
      useStore.subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      return useStore;
    },
  };
}

const loadStore = () =>
  createLoader({ zustand: createZustandMock() })("src/stores/settingsCategoryStore.ts")
    .useSettingsCategoryStore;

test("设置分类记录来源：我的直达返回我的，设置首页进入返回首页", () => {
  const store = loadStore();
  const initial = store.getState();
  assert.equal(initial.category, "SettingsHome");
  assert.equal(initial.fromSettingsHome, false);

  // 我的 → 外观：直达二级页，返回应 pop 回「我的」
  initial.requestCategory("Appearance");
  let state = store.getState();
  assert.equal(state.category, "Appearance");
  assert.equal(state.fromSettingsHome, false);

  // 顶栏/系统返回：回到设置首页（不是 pop），来源标记清零
  state.resetToHome();
  state = store.getState();
  assert.equal(state.category, "SettingsHome");
  assert.equal(state.fromSettingsHome, false);

  // 全部设置 → 账号：从设置首页进入，返回先回设置首页
  state.requestCategory("Account", { fromSettingsHome: true });
  state = store.getState();
  assert.equal(state.category, "Account");
  assert.equal(state.fromSettingsHome, true);

  state.resetToHome();
  state = store.getState();
  assert.equal(state.category, "SettingsHome");
  assert.equal(state.fromSettingsHome, false);
});

test("设置分类每次请求都会递增 navId，重复点同一分类也重挂载", () => {
  const store = loadStore();
  const before = store.getState().navId;

  store.getState().requestCategory("Playback");
  const first = store.getState();
  assert.equal(first.category, "Playback");
  assert.equal(first.navId, before + 1);

  store.getState().requestCategory("Playback", { fromSettingsHome: true });
  const second = store.getState();
  assert.equal(second.category, "Playback");
  assert.equal(second.navId, first.navId + 1);
  assert.equal(second.fromSettingsHome, true);
});
