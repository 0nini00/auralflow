import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcesSettingsSection } from "../src/views/settings/SourcesSettingsSection";
import { useSettingsViewModel, type SourcesSettingsModel } from "../src/views/useSettingsViewModel";
import { useCustomSourceStore } from "../src/stores/customSourceStore";

vi.mock("@/stores/customSourceStore", async () => {
  const { create } = await import("zustand");
  return {
    useCustomSourceStore: create(() => ({
      sources: [],
      featureEnabled: false,
      featureReady: true,
      setFeatureEnabled: vi.fn(),
      importScript: vi.fn(), importFromFile: vi.fn(), removeSource: vi.fn(),
      toggleSource: vi.fn(), moveSource: vi.fn(), testSource: vi.fn(),
      checkSourceUpdate: vi.fn(), checkAllUpdates: vi.fn(), toggleUpdateAlert: vi.fn(),
    })),
  };
});
vi.mock("@/components/CustomSourceUpdateModal", () => ({ openCustomSourceUpdateModal: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({
  loadSettings: vi.fn(async () => ({})), getSongCacheStats: vi.fn(async () => null),
  clearSongCache: vi.fn(), patchSettings: vi.fn(), libraryReset: vi.fn(),
}));
vi.mock("@/stores/themeStore", () => ({ useThemeStore: Object.assign(
  () => ({ accentColor: "#123456", previewAccentColor: vi.fn() }),
  { getState: () => ({ accentColor: "#123456" }) },
) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: { getState: vi.fn() } }));
vi.mock("@/stores/lyricSettingsSync", () => ({ broadcastLyricSettings: vi.fn() }));
vi.mock("@/services/playerEngine", () => ({ playerEngine: { setPauseOnExternalPlayback: vi.fn() } }));
vi.mock("@/services/persistentCache", () => ({ clearPersistentCache: vi.fn() }));
vi.mock("@/services/playback/prefetchService", () => ({ clearPlaybackPrefetchCache: vi.fn() }));
vi.mock("@/services/appBackground", () => ({
  notifyAppBackgroundChanged: vi.fn(), toAppBackgroundImageUrl: () => "",
}));

const source = {
  id: "saved-lx", name: "已保存音源", description: "测试脚本", script: "saved-script",
  enabled: true, allowShowUpdateAlert: true, testStatus: "idle" as const,
  createdAt: 1, updatedAt: 1,
};
const model = (patch: Partial<SourcesSettingsModel> = {}): SourcesSettingsModel => ({
  featureEnabled: false, featureReady: true,
  customSourceFeaturePending: false, customSourceFeatureError: "",
  handleCustomSourceFeatureChange: vi.fn(),
  customScriptText: "", setCustomScriptText: vi.fn(), customSourceStatus: "",
  customSourceAutoCheck: true, customSources: [source],
  removeSource: vi.fn(), toggleSource: vi.fn(), moveSource: vi.fn(), testSource: vi.fn(),
  checkSourceUpdate: vi.fn(), checkAllUpdates: vi.fn(), toggleUpdateAlert: vi.fn(),
  handleCustomSourceAutoCheckToggle: vi.fn(), handleImportCustomSourceFile: vi.fn(),
  handleImportCustomSourceText: vi.fn(), getUpdateStatusMessage: () => "",
  getTestStatusMessage: () => "", getVersionLabel: () => "", getCapabilityTitle: () => "",
  ...patch,
});

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
beforeEach(() => {
  useCustomSourceStore.setState({
    featureEnabled: false, featureReady: true, sources: [source], setFeatureEnabled: vi.fn(),
  });
});

function checkbox() {
  return renderer!.root.findByProps({ id: "custom-source-feature-enabled" });
}
function SettingsHarness() {
  return <SourcesSettingsSection model={useSettingsViewModel()} />;
}
async function mountSettings() {
  await act(async () => { renderer = create(<SettingsHarness />); });
}

describe("LX 音源设置总开关", () => {
  it("关闭时仅保留总开关和保留数据说明，不渲染管理操作", () => {
    const html = renderToStaticMarkup(<SourcesSettingsSection model={model()} />);
    expect(html).toContain("启用 LX 自定义音源");
    expect(html).toContain("保留");
    expect(html).toContain("内置");
    expect(html).toContain("本地");
    expect(html).not.toContain("已保存音源");
    act(() => { renderer = create(<SourcesSettingsSection model={model()} />); });
    expect(checkbox().props.type).toBe("checkbox");
    expect(checkbox().props.checked).toBe(false);
    expect(renderer!.root.findAllByType("button")).toHaveLength(0);
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
  });

  it("开启后展示已保存音源及全部管理区域", () => {
    act(() => { renderer = create(<SourcesSettingsSection model={model({ featureEnabled: true })} />); });
    expect(checkbox().props.checked).toBe(true);
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(1);
    expect(renderer!.root.findAllByType("button").length).toBeGreaterThan(4);
    expect(renderToStaticMarkup(<SourcesSettingsSection model={model({ featureEnabled: true })} />))
      .toContain("已保存音源");
  });

  it.each([
    { featureReady: false, customSourceFeaturePending: false },
    { featureReady: true, customSourceFeaturePending: true },
  ])("恢复或保存期间禁用总开关: %j", (state) => {
    act(() => { renderer = create(<SourcesSettingsSection model={model(state)} />); });
    expect(checkbox().props.disabled).toBe(true);
  });

  it("恢复未完成时即使旧状态为开启，也不展示管理操作", () => {
    act(() => { renderer = create(<SourcesSettingsSection model={model({ featureEnabled: true, featureReady: false })} />); });
    expect(renderer!.root.findAllByType("button")).toHaveLength(0);
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
  });

  it("checkbox 传递用户选择，等待落盘期间禁用且不伪造已保存状态", async () => {
    let finish!: () => void;
    const save = vi.fn((enabled: boolean) => new Promise<void>((resolve) => {
      finish = () => { useCustomSourceStore.setState({ featureEnabled: enabled }); resolve(); };
    }));
    useCustomSourceStore.setState({ setFeatureEnabled: save });
    await mountSettings();
    await act(async () => { checkbox().props.onChange({ target: { checked: true } }); });
    expect(save).toHaveBeenCalledWith(true);
    expect(checkbox().props.disabled).toBe(true);
    expect(checkbox().props.checked).toBe(false);
    await act(async () => { finish(); });
    expect(checkbox().props.disabled).toBe(false);
    expect(checkbox().props.checked).toBe(true);
    expect(useCustomSourceStore.getState().sources).toEqual([source]);
  });

  it("保存失败显示具体错误，允许重试且不隐藏失败", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("磁盘只读")).mockImplementationOnce(async (enabled) => {
      useCustomSourceStore.setState({ featureEnabled: enabled });
    });
    useCustomSourceStore.setState({ setFeatureEnabled: save });
    await mountSettings();
    await act(async () => { checkbox().props.onChange({ target: { checked: true } }); });
    expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toContain("磁盘只读");
    expect(checkbox().props.disabled).toBe(false);
    expect(checkbox().props.checked).toBe(false);
    await act(async () => { checkbox().props.onChange({ target: { checked: true } }); });
    expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(checkbox().props.checked).toBe(true);
  });
});
