import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCustomSourceUpdatePatch,
  normalizeCustomSourceForStore,
  patchCustomSource,
  stripCustomSourceTransientState,
  type CustomSourceItem,
} from "./model";

const NOW = 1_700_000_000_000;

function item(overrides: Partial<CustomSourceItem> = {}): CustomSourceItem {
  return {
    id: "a",
    name: "旧名",
    description: "旧描述",
    script: "// 没有头部注释",
    enabled: true,
    allowShowUpdateAlert: true,
    testStatus: "idle",
    updateStatus: "idle",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("patchCustomSource", () => {
  it("只改命中的条目并刷新 updatedAt，不修改入参", () => {
    const sources = [item({ id: "a" }), item({ id: "b" })];
    const next = patchCustomSource(sources, "b", { enabled: false });
    expect(next[0]).toBe(sources[0]);
    expect(next[1]).toMatchObject({ id: "b", enabled: false, updatedAt: NOW });
    expect(sources[1]).toMatchObject({ enabled: true, updatedAt: 1 });
  });
});

describe("buildCustomSourceUpdatePatch", () => {
  it("没有提示时记为最新并清掉上次的提示字段", () => {
    expect(buildCustomSourceUpdatePatch()).toEqual({
      updateStatus: "latest",
      updateMessage: undefined,
      updateLog: undefined,
      updateUrl: undefined,
      updateCheckedAt: NOW,
    });
  });

  it("有提示时记为可更新并带上日志与地址", () => {
    expect(buildCustomSourceUpdatePatch({ log: "新版本", updateUrl: "https://example.com/a.js" })).toEqual({
      updateStatus: "available",
      updateMessage: "发现更新",
      updateLog: "新版本",
      updateUrl: "https://example.com/a.js",
      updateCheckedAt: NOW,
    });
  });
});

describe("normalizeCustomSourceForStore", () => {
  it("以脚本头部为准重算展示字段，头部没写的可选字段清空", () => {
    const script = "/*\n * @name 新名\n * @version 2.0.0\n */";
    expect(normalizeCustomSourceForStore(item({ script, author: "旧作者", homepage: "https://old.example.com" }))).toMatchObject({
      name: "新名",
      description: "旧描述",
      author: undefined,
      homepage: undefined,
      version: "2.0.0",
    });
  });

  it("头部无法解析的条目保留原字段", () => {
    expect(normalizeCustomSourceForStore(item({ author: "作者" }))).toMatchObject({ name: "旧名", author: "作者" });
  });

  it("进行中的测试与更新检查复位成 idle，已有结论保留", () => {
    expect(
      normalizeCustomSourceForStore(
        item({ testStatus: "testing", testMessage: "测试中...", updateStatus: "checking", updateMessage: "检测中..." }),
      ),
    ).toMatchObject({ testStatus: "idle", testMessage: undefined, updateStatus: "idle", updateMessage: undefined });
    expect(
      normalizeCustomSourceForStore(
        item({ testStatus: "failed", testMessage: "取链失败", updateStatus: "available", updateMessage: "发现更新" }),
      ),
    ).toMatchObject({ testStatus: "failed", testMessage: "取链失败", updateStatus: "available", updateMessage: "发现更新" });
  });

  it("旧数据缺少的字段补默认值", () => {
    const legacy = { ...item(), testStatus: undefined, updateStatus: undefined, allowShowUpdateAlert: undefined };
    expect(normalizeCustomSourceForStore(legacy as unknown as CustomSourceItem)).toMatchObject({
      testStatus: "idle",
      updateStatus: "idle",
      allowShowUpdateAlert: true,
    });
  });
});

describe("stripCustomSourceTransientState", () => {
  it("测试结果不落盘，进行中的更新检查落盘为 idle", () => {
    const [stripped] = stripCustomSourceTransientState([
      item({ testStatus: "ok", testMessage: "初始化正常", updateStatus: "checking", updateMessage: "检测中..." }),
    ]);
    expect(stripped).toMatchObject({ testStatus: "idle", testMessage: undefined, updateStatus: "idle", updateMessage: undefined });
  });

  it("已得出结论的更新状态保留，供下次启动节流", () => {
    const [stripped] = stripCustomSourceTransientState([
      item({ updateStatus: "failed", updateMessage: "远端音源脚本为空", updateCheckedAt: 42 }),
    ]);
    expect(stripped).toMatchObject({ updateStatus: "failed", updateMessage: "远端音源脚本为空", updateCheckedAt: 42 });
  });
});
