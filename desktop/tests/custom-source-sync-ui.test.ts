import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ featureEnabled: false, featureReady: true }));
vi.mock("@lx/tauri-bridge", () => ({ loadSettings: vi.fn(), patchSettings: vi.fn() }));
vi.mock("../src/stores/customSourceStore", () => ({
  useCustomSourceStore: (selector: (state: typeof fixture) => unknown) => selector(fixture),
}));
import { SyncSettingsSection } from "../src/views/settings/SyncSettingsSection";

function buttonAttributes(markup: string, label: string): string {
  const button = markup.match(new RegExp(`<button([^>]*)>${label}</button>`));
  expect(button, `缺少按钮：${label}`).not.toBeNull();
  return button![1];
}

beforeEach(() => { fixture.featureEnabled = false; fixture.featureReady = true; });

describe("WebDAV 同步设置的音源开关隔离", () => {
  it("关闭时禁用音源按钮，保留 WebDAV 与歌单按钮并解释数据保留", () => {
    const markup = renderToStaticMarkup(createElement(SyncSettingsSection));
    for (const label of ["上传音源", "下载音源"]) {
      expect(buttonAttributes(markup, label)).toContain("disabled");
    }
    for (const label of ["测试连接", "上传歌单历史", "下载歌单历史"]) {
      expect(buttonAttributes(markup, label)).not.toContain("disabled");
    }
    expect(markup).toContain("WebDAV 地址");
    expect(markup).toContain("启动时自动同步歌单历史");
    expect(markup).toContain("LX 自定义音源已停用");
    expect(markup).toContain("本地及云端音源数据保留");
    expect(markup).toContain("已发送的远端请求无法撤回");
  });

  it("恢复未完成时音源按钮不可用，但歌单同步仍可用", () => {
    fixture.featureEnabled = true;
    fixture.featureReady = false;
    const markup = renderToStaticMarkup(createElement(SyncSettingsSection));
    expect(buttonAttributes(markup, "上传音源")).toContain("disabled");
    expect(buttonAttributes(markup, "下载音源")).toContain("disabled");
    expect(buttonAttributes(markup, "上传歌单历史")).not.toContain("disabled");
    expect(markup).toContain("正在恢复 LX 自定义音源状态");
  });

  it("恢复完成且开启时音源按钮可用", () => {
    fixture.featureEnabled = true;
    const markup = renderToStaticMarkup(createElement(SyncSettingsSection));
    expect(buttonAttributes(markup, "上传音源")).not.toContain("disabled");
    expect(buttonAttributes(markup, "下载音源")).not.toContain("disabled");
  });
});
