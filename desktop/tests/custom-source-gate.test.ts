import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 门禁的夹具：store 只留门禁读的两个布尔值，customSourceAccess 用真实实现接上去，
 * 这样测到的是真正的令牌语义，而不是另一份手写判定。
 */
const fixture = vi.hoisted(() => ({
  state: { featureReady: true, featureEnabled: true },
  persistence: { ready: Promise.resolve() as Promise<void> },
}));

vi.mock("@/stores/customSourceStore", async () => {
  const { createCustomSourceAccess } = await import("../src/services/customSourceAccess");
  return {
    useCustomSourceStore: { getState: () => fixture.state },
    customSourcePersistence: fixture.persistence,
    customSourceAccess: createCustomSourceAccess(() => fixture.state.featureReady && fixture.state.featureEnabled),
  };
});

import {
  CustomSourceDisabledError,
  canReuseCustomSourceResult,
  requireCustomSourceOperation,
  usesCustomSourceRuntime,
} from "../src/services/customSourceAccess";
import {
  openCustomSourceAccess,
  requireCustomSourceAccess,
  snapshotCustomSourceAccess,
} from "../src/services/customSourceGate";
import { customSourceAccess } from "../src/stores/customSourceStore";

/** 模拟 setFeatureEnabled：先让旧令牌失效，再发布新状态。 */
function toggle(enabled: boolean) {
  customSourceAccess.invalidate();
  fixture.state.featureEnabled = enabled;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  fixture.state.featureReady = true;
  fixture.state.featureEnabled = true;
  fixture.persistence.ready = Promise.resolve();
});

describe("openCustomSourceAccess：功能关着也要继续干活的调用方", () => {
  it("启用时给出有效令牌，未启用时给出 undefined 而不是抛错", async () => {
    const operation = await openCustomSourceAccess();
    expect(operation?.isActive()).toBe(true);

    toggle(false);
    await expect(openCustomSourceAccess()).resolves.toBeUndefined();
  });

  it("已恢复时令牌在调用的同步段里取得：调用后立刻 off→on，本次操作属于旧生命周期", async () => {
    const pending = openCustomSourceAccess();
    toggle(false);
    toggle(true);

    const operation = await pending;
    expect(operation).toBeDefined();
    expect(operation!.isActive()).toBe(false);
    expect(() => operation!.assertActive()).toThrow(CustomSourceDisabledError);
  });

  it("恢复完成前不做判定：不把「还没读到设置」当成「用户关掉了」", async () => {
    const hydration = deferred();
    fixture.state.featureReady = false;
    fixture.state.featureEnabled = false;
    fixture.persistence.ready = hydration.promise;

    let settled = false;
    const pending = openCustomSourceAccess().then((operation) => { settled = true; return operation; });
    await Promise.resolve();
    expect(settled).toBe(false);

    fixture.state.featureReady = true;
    fixture.state.featureEnabled = true;
    hydration.resolve();
    expect((await pending)?.isActive()).toBe(true);
  });

  it("恢复失败（featureReady 仍为 false）视为未启用", async () => {
    fixture.state.featureReady = false;
    await expect(openCustomSourceAccess()).resolves.toBeUndefined();
  });
});

describe("requireCustomSourceAccess：只为 LX 服务的调用方", () => {
  it("启用时给出令牌", async () => {
    expect((await requireCustomSourceAccess()).isActive()).toBe(true);
  });

  it("未启用时以 CustomSourceDisabledError 拒绝（是拒绝，不是同步抛出）", async () => {
    toggle(false);
    const pending = requireCustomSourceAccess();
    await expect(pending).rejects.toBeInstanceOf(CustomSourceDisabledError);
  });
});

describe("snapshotCustomSourceAccess：代际与令牌同一时刻", () => {
  it("功能关着时没有令牌但仍有代际，能发现期间被重新打开", async () => {
    toggle(false);
    const snapshot = await snapshotCustomSourceAccess();
    expect(snapshot.operation).toBeUndefined();
    expect(snapshot.version).toBe(customSourceAccess.version);

    toggle(true);
    expect(customSourceAccess.version).not.toBe(snapshot.version);
  });

  it("调用后立刻换代：快照里的代际与令牌都停在旧的一代", async () => {
    const versionAtCall = customSourceAccess.version;
    const pending = snapshotCustomSourceAccess();
    toggle(true);

    const snapshot = await pending;
    expect(snapshot.version).toBe(versionAtCall);
    expect(snapshot.operation?.isActive()).toBe(false);
  });
});

describe("拿到结果之后的两种检查", () => {
  it("只有 customSource / hiddenSource 走 LX 运行时", () => {
    expect(usesCustomSourceRuntime("customSource")).toBe(true);
    expect(usesCustomSourceRuntime("hiddenSource")).toBe(true);
    expect(usesCustomSourceRuntime("builtinNetease")).toBe(false);
    expect(usesCustomSourceRuntime("builtinProvider")).toBe(false);
    expect(usesCustomSourceRuntime(undefined)).toBe(false);
  });

  it("内置源结果不受开关约束：不要求令牌，也始终可复用", () => {
    toggle(false);
    expect(requireCustomSourceOperation("builtinNetease", undefined)).toBeUndefined();
    expect(canReuseCustomSourceResult("builtinProvider", undefined)).toBe(true);
  });

  it.each(["customSource", "hiddenSource"] as const)("%s 结果没有令牌：强制检查抛错，复用检查为否", (backend) => {
    expect(() => requireCustomSourceOperation(backend, undefined)).toThrow(CustomSourceDisabledError);
    expect(canReuseCustomSourceResult(backend, undefined)).toBe(false);
  });

  it.each(["customSource", "hiddenSource"] as const)("%s 结果的令牌有效时返回同一个令牌，失效后拒绝", async (backend) => {
    const operation = await requireCustomSourceAccess();
    expect(requireCustomSourceOperation(backend, operation)).toBe(operation);
    expect(canReuseCustomSourceResult(backend, operation)).toBe(true);

    toggle(false);
    expect(() => requireCustomSourceOperation(backend, operation)).toThrow(CustomSourceDisabledError);
    expect(canReuseCustomSourceResult(backend, operation)).toBe(false);
  });
});
