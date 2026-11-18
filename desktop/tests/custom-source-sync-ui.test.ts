import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ featureEnabled: false, featureReady: true }));
vi.mock("@lx/tauri-bridge", () => ({ patchSettings: vi.fn() }));
vi.mock("../src/stores/customSourceStore", () => ({
  useCustomSourceStore: (selector: (state: typeof fixture) => unknown) => selector(fixture),
}));
import { SyncSettingsSection } from "../src/views/settings/SyncSettingsSection";
import { seedSettings } from "./helpers/settingsFixture";

// 用客户端渲染而不是 renderToStaticMarkup：服务端渲染读的是 store 的初始状态（设置未加载）。
let renderer: ReactTestRenderer | undefined;
function text(node: ReactTestInstance | string): string { return typeof node === "string" ? node : node.children.map(text).join(""); }
function render(): string {
  act(() => { renderer = create(createElement(SyncSettingsSection)); });
  return text(renderer!.root);
}
function isDisabled(label: string): boolean {
  const button = renderer!.root.findAllByType("button").find((node) => text(node) === label);
  expect(button, `缺少按钮：${label}`).toBeDefined();
  return button!.props.disabled === true;
}

beforeEach(() => {
  fixture.featureEnabled = false; fixture.featureReady = true;
  seedSettings({ webdavAutoSyncPlaylists: false });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe("WebDAV 同步设置的音源开关隔离", () => {
  it("关闭时禁用音源按钮，保留 WebDAV 与歌单按钮并解释数据保留", () => {
    const content = render();
    for (const label of ["上传音源", "下载音源"]) expect(isDisabled(label)).toBe(true);
    for (const label of ["测试连接", "上传歌单历史", "下载歌单历史"]) expect(isDisabled(label)).toBe(false);
    expect(content).toContain("WebDAV 地址");
    expect(content).toContain("启动时自动同步歌单历史");
    expect(content).toContain("LX 自定义音源已停用");
    expect(content).toContain("本地及云端音源数据保留");
    expect(content).toContain("已发送的远端请求无法撤回");
  });

  it("恢复未完成时音源按钮不可用，但歌单同步仍可用", () => {
    fixture.featureEnabled = true;
    fixture.featureReady = false;
    const content = render();
    expect(isDisabled("上传音源")).toBe(true);
    expect(isDisabled("下载音源")).toBe(true);
    expect(isDisabled("上传歌单历史")).toBe(false);
    expect(content).toContain("正在恢复 LX 自定义音源状态");
  });

  it("恢复完成且开启时音源按钮可用", () => {
    fixture.featureEnabled = true;
    render();
    expect(isDisabled("上传音源")).toBe(false);
    expect(isDisabled("下载音源")).toBe(false);
  });
});
