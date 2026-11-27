// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopLyricSettingsSection } from "../src/views/settings/DesktopLyricSettingsSection";
import { SyncSettingsSection } from "../src/views/settings/SyncSettingsSection";
import { __resetSettingsStoreForTests, useSettingsStore, type AppSettings } from "../src/stores/settingsStore";
import { seedSettings } from "./helpers/settingsFixture";

const deps = vi.hoisted(() => ({ loadSettings: vi.fn(), patchSettings: vi.fn(), isLyricWindowOpen: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ ...deps, setLyricWindowPinned: vi.fn() }));
vi.mock("@/services/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/utils/desktopLyricToggle", () => ({ toggleDesktopLyricFromPlayer: vi.fn() }));
vi.mock("@/stores/customSourceStore", () => ({
  useCustomSourceStore: (select: (state: { featureEnabled: boolean; featureReady: boolean }) => unknown) =>
    select({ featureEnabled: true, featureReady: true }),
}));

const settings = {
  webdavUrl: "https://example.invalid/dav", webdavUsername: "test-user", webdavPassword: "synthetic-password",
  webdavAutoSyncPlaylists: false, lyricPinned: false, lyricPauseHide: false, lyricFontSize: 26,
  lyricShowNextLine: true, lyricSingleLine: false, lyricMaxLineNum: 2, lyricShowTranslation: true,
  lyricShowRomanization: false, lyricShowRuby: false, lyricAlign: "center", lyricLineGap: 8,
  lyricFontWeight: 600, lyricActiveColor: "#ffffff", lyricNextColor: "#aaaaaa", lyricShadowColor: "#000000",
  lyricTextOpacity: 0.7, lyricBackgroundOpacity: 0.5, lyricTextPositionX: -10, lyricTextPositionY: 15,
  lyricHoverHide: false, lyricEnableAnimation: true, lyricAnimationIntensity: "normal", lyricManualOffsetMs: 150,
} satisfies Partial<AppSettings>;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  __resetSettingsStoreForTests();
  seedSettings(settings);
  deps.isLyricWindowOpen.mockResolvedValue(false);
  deps.patchSettings.mockImplementation(async (patch: object) => ({ ...useSettingsStore.getState().settings, ...patch }));
  deps.loadSettings.mockImplementation(async () => useSettingsStore.getState().settings);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(children: ReactNode) {
  await act(async () => root.render(children));
}

async function selectTab(name: string) {
  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .filter(tab => tab.textContent === name);
  expect(tabs.length).toBeGreaterThan(0);
  await act(async () => { tabs.forEach(tab => tab.click()); });
}

function labelledInput(labelText: string, within: ParentNode = container): HTMLInputElement {
  const label = Array.from(within.querySelectorAll<HTMLLabelElement>("label"))
    .find(candidate => candidate.textContent?.trim() === labelText);
  expect(label, `${labelText}必须有可见label`).toBeDefined();
  expect(label!.control, `${labelText}必须关联实际输入控件`).toBeInstanceOf(HTMLInputElement);
  const input = label!.control as HTMLInputElement;
  expect(input.id).not.toBe("");
  expect(Array.from(input.labels ?? [])).toContain(label);
  return input;
}

async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("WebDAV三个可见标签关联各自字段，多实例ID不冲突", async () => {
  await mount(<><SyncSettingsSection /><SyncSettingsSection /></>);
  const sections = container.querySelectorAll("section");
  const ids = new Set<string>();
  for (const section of sections) {
    for (const [label, value] of [["WebDAV 地址", settings.webdavUrl], ["用户名", settings.webdavUsername], ["密码", settings.webdavPassword]]) {
      const input = labelledInput(label, section);
      expect(input.value).toBe(value);
      expect(ids.has(input.id)).toBe(false);
      ids.add(input.id);
    }
    expect(labelledInput("密码", section).type).toBe("password");
  }
  expect(ids.size).toBe(6);
  expect(deps.patchSettings).not.toHaveBeenCalled();
});

it("桌面歌词七个排版滑块关联可见名称并播报数值单位", async () => {
  await mount(<DesktopLyricSettingsSection />);
  await selectTab("排版");
  for (const [label, spokenValue] of [
    ["字号", "26px"], ["偏移校准", "+150ms"], ["行距", "8px"], ["行数", "2行"],
    ["透明", "70%"], ["横向", "-10%"], ["纵向", "15%"],
  ]) {
    const input = labelledInput(label);
    expect(input.type).toBe("range");
    expect(input.getAttribute("aria-valuetext")).toBe(spokenValue);
  }
  await inputValue(labelledInput("字号"), "31");
  expect(deps.patchSettings).toHaveBeenLastCalledWith({ lyricFontSize: 31 });
  expect(labelledInput("字号").getAttribute("aria-valuetext")).toBe("31px");
  await inputValue(labelledInput("偏移校准"), "-250");
  expect(deps.patchSettings).toHaveBeenLastCalledWith({ lyricManualOffsetMs: -250 });
  expect(labelledInput("偏移校准").getAttribute("aria-valuetext")).toBe("-250ms");
  await inputValue(labelledInput("透明"), "0.8");
  expect(deps.patchSettings).toHaveBeenLastCalledWith({ lyricTextOpacity: 0.8 });
  expect(labelledInput("透明").getAttribute("aria-valuetext")).toBe("80%");
});

it("背景滑块播报百分比，单行模式仍禁用行数并播报一行", async () => {
  await mount(<DesktopLyricSettingsSection />);
  await selectTab("颜色与背景");
  expect(labelledInput("背景").getAttribute("aria-valuetext")).toBe("50%");
  await inputValue(labelledInput("背景"), "0.65");
  expect(deps.patchSettings).toHaveBeenLastCalledWith({ lyricBackgroundOpacity: 0.65 });
  expect(labelledInput("背景").getAttribute("aria-valuetext")).toBe("65%");
  act(() => seedSettings({ ...settings, lyricSingleLine: true, lyricMaxLineNum: 4 }));
  await selectTab("排版");
  const lineCount = labelledInput("行数");
  expect(lineCount.disabled).toBe(true);
  expect(lineCount.getAttribute("aria-valuetext")).toBe("1行");
  expect(useSettingsStore.getState().settings!.lyricMaxLineNum).toBe(4);
});

it("歌词滑块多实例关联稳定，切换页签不产生重复ID", async () => {
  await mount(<><DesktopLyricSettingsSection /><DesktopLyricSettingsSection /></>);
  await selectTab("排版");
  const sections = Array.from(container.querySelectorAll("section"));
  const originalIds = sections.map(section => labelledInput("字号", section).id);
  expect(new Set(originalIds).size).toBe(2);
  await selectTab("颜色与背景");
  expect(new Set(sections.map(section => labelledInput("背景", section).id)).size).toBe(2);
  await selectTab("排版");
  expect(sections.map(section => labelledInput("字号", section).id)).toEqual(originalIds);
  const rangeIds = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="range"]'), input => input.id);
  expect(new Set(rangeIds).size).toBe(14);
});

it("桌面歌词基础开关均具备与可见行标题一致的名称", async () => {
  await mount(<DesktopLyricSettingsSection />);
  const switches = container.querySelectorAll<HTMLInputElement>('input[role="switch"]');
  expect(switches.length).toBe(9);
  for (const input of switches) {
    const visibleLabel = input.closest(".af-setting-row")!.querySelector(".af-setting-row-label")!.textContent;
    expect(input.getAttribute("aria-label")).toBe(visibleLabel);
  }
});
