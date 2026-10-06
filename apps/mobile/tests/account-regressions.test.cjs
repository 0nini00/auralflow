const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");

const COOKIE_KEY = "auralflow.mobile.wy.cookie.v1";
const LEGACY_KEY = "auralflow.mobile.wy.cookie";
const USER_KEY = "auralflow.mobile.wy.user";
const A = { userId: "A", nickname: "Account A", avatarUrl: "https://example.invalid/A.png", vipType: 0 };
const B = { userId: "B", nickname: "Account B", avatarUrl: "https://example.invalid/B.png", vipType: 0 };
const C = { userId: "C", nickname: "Account C", avatarUrl: "https://example.invalid/C.png", vipType: 0 };
const cookie = user => `MUSIC_U=FAKE_${user.userId}`;
const success = user => ({ code: 200, account: { id: user.userId }, profile: user });
const flush = () => new Promise(resolve => setImmediate(resolve));
const observe = promise => promise.then(value => ({ value }), error => ({ error }));

function setup({ legacy = false } = {}) {
  const secure = new Map(legacy ? [] : [[COOKIE_KEY, cookie(A)]]);
  const local = new Map([[USER_KEY, JSON.stringify(A)], ...(legacy ? [[LEGACY_KEY, cookie(A)]] : [])]);
  const requests = [];
  const writes = [];
  const pauses = [];
  async function write(kind, key, value, action) {
    const index = pauses.findIndex(p => p.kind === kind && p.key === key);
    if (index >= 0) {
      const pause = pauses.splice(index, 1)[0];
      pause.started = true;
      await pause.promise;
    }
    writes.push({ kind, key, value });
    action();
  }
  const load = createLoader({
    zustand: mobileRequire("zustand"),
    "@react-native-async-storage/async-storage": {
      getItem: async key => local.get(key) ?? null,
      setItem: (key, value) => write("local.set", key, value, () => local.set(key, value)),
      removeItem: key => write("local.remove", key, null, () => local.delete(key)),
      multiRemove: keys => write("local.clear", USER_KEY, null, () => keys.forEach(key => local.delete(key))),
    },
    "@/services/secureStorageService": {
      getSecureItem: async key => secure.get(key) ?? null,
      setSecureItem: (key, value) => write("secure.set", key, value, () => secure.set(key, value)),
      removeSecureItem: key => write("secure.remove", key, null, () => secure.delete(key)),
    },
    "@/utils/fetchWithTimeout": {
      isTimeoutError: () => false,
      fetchWithTimeout: async (_url, options) => {
        const request = deferred();
        requests.push({ ...request, cookie: options.headers.Cookie });
        const response = await request.promise;
        return { text: async () => JSON.stringify(response) };
      },
    },
    "@/services/weapi": { weapi: async () => ({ params: "", encSecKey: "" }) },
  });
  const api = load("src/services/wyAccountService.ts");
  const store = load("src/stores/accountStore.ts").useAccountStore;
  return {
    api, store, secure, local, requests, writes,
    pause(kind, key) {
      const pause = { ...deferred(), kind, key, started: false };
      pauses.push(pause);
      return pause;
    },
    async respond(index, result) {
      await flush();
      assert.ok(requests[index], `request ${index} must have started`);
      if (result instanceof Error) requests[index].reject(result);
      else requests[index].resolve(result);
      await flush();
    },
    async login(user) {
      const index = requests.length;
      const result = observe(store.getState().login(cookie(user)));
      await this.respond(index, success(user));
      const outcome = await result;
      assert.equal(outcome.error, undefined);
    },
  };
}

function assertAccount(h, user) {
  assert.equal(h.secure.get(COOKIE_KEY), user ? cookie(user) : undefined);
  assert.deepEqual(h.local.has(USER_KEY) ? JSON.parse(h.local.get(USER_KEY)) : null, user);
  assert.deepEqual(h.store.getState().user, user);
  assert.equal(h.store.getState().isLoggedIn, Boolean(user));
  assert.equal(h.store.getState().loading, false);
  assert.equal(h.store.getState().error, null);
}

// 将临时复现中“确认被污染”的两条断言改为正确行为；补齐网络失败分支。
for (const [name, response] of [
  ["expired", { code: 301 }],
  ["success", success({ ...A, nickname: "Renamed A" })],
  ["network failure", new Error("offline")],
]) {
  test(`late A ${name} must preserve newly logged-in B`, async () => {
    const h = setup();
    const slowA = h.store.getState().checkStatus();
    await flush();
    const fastA = h.store.getState().checkStatus();
    await h.respond(1, success(A));
    await fastA;
    await h.store.getState().logout();
    await h.login(B);
    const before = h.writes.length;
    await h.respond(0, response);
    await slowA;
    assertAccount(h, B);
    assert.equal(h.writes.length, before, "stale check must not write storage");
  });

  test(`late A ${name} must not undo logout`, async () => {
    const h = setup();
    const check = h.store.getState().checkStatus();
    await flush();
    await h.store.getState().logout();
    const before = h.writes.length;
    await h.respond(0, response);
    await check;
    assertAccount(h, null);
    assert.equal(h.writes.length, before);
  });

  test(`older check ${name} must not replace a newer check result`, async () => {
    const h = setup();
    const older = h.store.getState().checkStatus();
    await flush();
    const newer = h.store.getState().checkStatus();
    const freshA = { ...A, nickname: "Latest A" };
    await h.respond(1, success(freshA));
    await newer;
    const before = h.writes.length;
    await h.respond(0, response);
    await older;
    assertAccount(h, freshA);
    assert.equal(h.writes.length, before);
  });
}

test("older completion must not release loading while the newest check is pending", async () => {
  const h = setup();
  const older = h.store.getState().checkStatus();
  await flush();
  const newer = h.store.getState().checkStatus();
  await h.respond(0, success(A));
  await older;
  assert.equal(h.store.getState().loading, true);
  await h.respond(1, success(A));
  await newer;
  assertAccount(h, A);
});

test("logout invalidates an in-flight login before it can persist", async () => {
  const h = setup();
  const login = observe(h.store.getState().login(cookie(B)));
  await flush();
  await h.store.getState().logout();
  await h.respond(0, success(B));
  const result = await login;
  assertAccount(h, null);
  assert.ok(result.error, "superseded login must not report success");
});

test("an older login cannot overwrite a newer successful login", async () => {
  const h = setup();
  const older = observe(h.store.getState().login(cookie(B)));
  await flush();
  await h.login(C);
  await h.respond(0, success(B));
  const result = await older;
  assertAccount(h, C);
  assert.ok(result.error);
});

test("a check during login observes the pending login instead of invalidating it", async () => {
  const h = setup();
  const login = observe(h.store.getState().login(cookie(B)));
  await flush();
  const check = h.store.getState().checkStatus();
  await flush();
  assert.equal(h.requests.length, 1, "must not validate the old persisted account during login");
  await h.respond(0, success(B));
  assert.equal((await login).error, undefined);
  await check;
  assertAccount(h, B);
});

for (const kind of ["logout", "expired check", "profile check", "login"]) {
  test(`pending ${kind} persistence cannot run after a newer login commit`, async () => {
    const h = setup();
    const clearing = kind === "logout" || kind === "expired check";
    const pause = h.pause(clearing ? "secure.remove" : "local.set", clearing ? COOKIE_KEY : USER_KEY);
    let old;
    if (kind === "logout") old = observe(h.store.getState().logout());
    else if (kind === "login") {
      old = observe(h.store.getState().login(cookie(B)));
      await h.respond(0, success(B));
    } else {
      old = observe(h.store.getState().checkStatus());
      await h.respond(0, clearing ? { code: 301 } : success({ ...A, nickname: "Renamed A" }));
    }
    await flush();
    assert.equal(pause.started, true);
    // 登录写到一半时再退出，覆盖 Cookie/user 两步写与退出的竞争。
    const logout = kind === "login" ? observe(h.store.getState().logout()) : null;
    const index = h.requests.length;
    const newer = observe(h.store.getState().login(cookie(C)));
    await h.respond(index, success(C));
    assert.notEqual(h.secure.get(COOKIE_KEY), cookie(C), "new credentials must wait for old persistence");
    pause.resolve();
    await old;
    if (logout) await logout;
    assert.equal((await newer).error, undefined);
    assertAccount(h, C);
  });
}

test("legacy cookie migration is serialized with logout and relogin", async () => {
  const h = setup({ legacy: true });
  const pause = h.pause("secure.set", COOKIE_KEY);
  const read = h.api.getWyCookie();
  await flush();
  assert.equal(pause.started, true);
  const logout = observe(h.store.getState().logout());
  const login = observe(h.store.getState().login(cookie(B)));
  await h.respond(0, success(B));
  pause.resolve();
  await read;
  await logout;
  assert.equal((await login).error, undefined);
  assertAccount(h, B);
  assert.equal(h.local.has(LEGACY_KEY), false);
});

test("profile persistence errors are surfaced, and do not poison later storage work", async () => {
  const h = setup();
  const pause = h.pause("local.set", USER_KEY);
  const check = h.store.getState().checkStatus();
  await h.respond(0, success({ ...A, nickname: "Renamed A" }));
  assert.equal(pause.started, true);
  pause.reject(new Error("profile write failed"));
  await check;
  assert.match(h.store.getState().error ?? "", /profile write failed/);
  await h.login(B);
  assertAccount(h, B);
});

for (const [name, response, expected] of [
  ["success", success(A), A],
  ["network failure", new Error("offline"), A],
  ["expiration", { code: 301 }, null],
]) {
  test(`current check preserves normal ${name} behavior`, async () => {
    const h = setup();
    const check = h.store.getState().checkStatus();
    await h.respond(0, response);
    await check;
    assertAccount(h, expected);
  });
}
